import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { initializeApp as initClient, deleteApp as deleteClient } from 'firebase/app';
import { getAuth as clientAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, setDoc, collection } from 'firebase/firestore';
import handler, { __resetAdmin } from '../../api/ledger.js';
import { currentEligibilityMonth, ELIGIBILITY_COL } from '../src/partnerWorkerEligibility.js';

const enabled = process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST;
const suite = enabled ? describe : describe.skip;
const month = currentEligibilityMonth();
const tokens = {};
let app; let db; let client; let rules;
const post = async (name, data, role = 'admin') => {
  const res = { statusCode: null, body: null, setHeader() {}, status(n) { this.statusCode = n; return this; }, json(value) { this.body = value; return this; } };
  await handler({ method: 'POST', headers: tokens[role] ? { authorization: `Bearer ${tokens[role]}` } : {}, body: { name, data } }, res);
  return res;
};
const change = { partnerId: 'hadi', periodKey: month, eligibleWorkers: 5, expectedRevision: 0, reason: 'اختبار معزول للسفر' };

suite('أهلية البايكرز — HTTP حقيقي ومعاملات وقواعد الإنتاج', () => {
  beforeAll(async () => {
    if (!String(process.env.GCLOUD_PROJECT || '').startsWith('demo-')) throw new Error('Tests require an isolated demo project');
    __resetAdmin();
    app = initializeApp({ projectId: process.env.GCLOUD_PROJECT }, 'eligibility-server-test');
    db = getFirestore(app);
    client = initClient({ apiKey: 'fake-test-key', projectId: process.env.GCLOUD_PROJECT }, 'eligibility-client-test');
    const auth = clientAuth(client);
    connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
    for (const role of ['admin', 'operator', 'partner', 'accountant']) {
      const email = `eligibility-${role}@sweater.test`;
      const rec = await getAuth(app).createUser({ email, password: 'isolated-password-123' }).catch(() => getAuth(app).getUserByEmail(email));
      await db.collection('users').doc(rec.uid).set({ role });
      const cred = await signInWithEmailAndPassword(auth, email, 'isolated-password-123');
      tokens[role] = await cred.user.getIdToken();
    }
    const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
    rules = await initializeTestEnvironment({ projectId: 'demo-sweater-eligibility-rules', firestore: { host, port: Number(port), rules: readFileSync('firestore.rules', 'utf8') } });
    await rules.withSecurityRulesDisabled(async ctx => {
      for (const role of ['admin', 'operator', 'partner', 'accountant']) await setDoc(doc(ctx.firestore(), 'users', role), { role });
      await setDoc(doc(ctx.firestore(), ELIGIBILITY_COL, 'hadi'), { revision: 1, changes: { [month]: { eligibleWorkers: 5, reason: 'PRIVATE' } } });
      await setDoc(doc(ctx.firestore(), ELIGIBILITY_COL, 'hadi', 'audit', 'event'), { reason: 'PRIVATE' });
    });
  }, 120000);
  beforeEach(async () => {
    await db.recursiveDelete(db.collection(ELIGIBILITY_COL));
    await db.recursiveDelete(db.collection('partners'));
    await db.recursiveDelete(db.collection('accounting_periods'));
    for (const id of ['hadi', 'ali', 'mohammed']) await db.collection('partners').doc(id).set({ workers_count: 10 });
  }, 30000);
  afterAll(async () => { await rules?.cleanup(); if (client) await deleteClient(client); if (app) await deleteApp(app); __resetAdmin(); });

  it('الأدمن يحفظ ثم يقرأ إعداداً دائماً وسجل تدقيق منفصلاً بلا تعديل الملكية أو الدفاتر', async () => {
    const save = await post('partnerEligibilitySet', change);
    expect(save.statusCode).toBe(200);
    expect(save.body.result.revision).toBe(1);
    const read = await post('partnerEligibilityGet', { partnerId: 'hadi' });
    expect(read.statusCode).toBe(200);
    expect(read.body.result.current).toMatchObject({ originalWorkers: 10, eligibleWorkers: 5, suspendedWorkers: 5 });
    expect((await db.collection('partners').doc('hadi').get()).data()).toEqual({ workers_count: 10 });
    expect((await db.collection(ELIGIBILITY_COL).doc('hadi').collection('audit').get()).size).toBe(1);
    expect((await db.collection('journal_entries').get()).size).toBe(0);
    expect((await db.collection('partner_payments').get()).size).toBe(0);
  });
  it('طلبان متزامنان بالنسخة نفسها لا يكتبان فوق بعضهما', async () => {
    const results = await Promise.all([post('partnerEligibilitySet', change), post('partnerEligibilitySet', { ...change, eligibleWorkers: 7 })]);
    expect(results.map(r => r.statusCode).sort()).toEqual([200, 412]);
    expect((await db.collection(ELIGIBILITY_COL).doc('hadi').collection('audit').get()).size).toBe(1);
  });
  it('التغيير في فترة مقفلة يُرفض دون حفظ أو تدقيق وهمي', async () => {
    await db.collection('accounting_periods').doc(month).set({ status: 'closed' });
    expect((await post('partnerEligibilitySet', change)).statusCode).toBe(412);
    expect((await db.collection(ELIGIBILITY_COL).doc('hadi').get()).exists).toBe(false);
  });
  it.each(['partner', 'operator', 'accountant', 'anonymous'])('الدور %s لا يقرأ ولا يحفظ حتى لو أرسل role=admin', async role => {
    for (const name of ['partnerEligibilityGet', 'partnerEligibilitySet']) {
      expect((await post(name, { ...change, role: 'admin' }, role)).statusCode).toBe(role === 'anonymous' ? 401 : 403);
    }
    expect((await db.collection(ELIGIBILITY_COL).get()).size).toBe(0);
  });
  it.each(['admin', 'operator', 'partner', 'accountant', 'anonymous'])('قواعد الإنتاج تمنع عميل %s من قراءة الإعدادات أو السبب أو التدقيق أو كتابتها', async role => {
    const direct = role === 'anonymous' ? rules.unauthenticatedContext().firestore() : rules.authenticatedContext(role).firestore();
    await assertFails(getDoc(doc(direct, ELIGIBILITY_COL, 'hadi')));
    await assertFails(getDocs(collection(direct, ELIGIBILITY_COL)));
    await assertFails(getDoc(doc(direct, ELIGIBILITY_COL, 'hadi', 'audit', 'event')));
    await assertFails(setDoc(doc(direct, ELIGIBILITY_COL, 'hadi'), { changes: { [month]: { eligibleWorkers: 10 } } }));
  });
});
