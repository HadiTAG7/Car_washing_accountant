import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { initializeApp as initializeClient, deleteApp as deleteClient } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { operationsReports } from '../operationsReports.js';
import { createOperationsReportsHandler } from '../operationsReportsHttp.js';
import { operationsFixture } from './operationsFixture.js';
import { operationsSubmission } from '../../src/lib/operationsReportPublication.js';

const local = /^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '');
describe.skipIf(!local)('operations reports real SDK/auth/rules — demo only', () => {
  let app, db, environment, client, adminAuth;
  const tokens = {}, projectId = 'demo-sweater-operations', paths = new Set(), users = ['ops-admin', 'ops-partner', 'ops-accountant', 'ops-supervisor', 'ops-operator'];
  const roles = ['admin', 'partner', 'accountant', 'supervisor', 'operator'], auth = { uid: 'ops-admin' }, report = operationsFixture();
  const remember = r => { paths.add(`operations_reports/${r.reportId}`); paths.add(`operations_reports/${r.reportId}/revisions/${String(r.revision).padStart(6, '0')}`); return r; };
  const save = (r, caller = auth) => operationsReports(db, caller, { action: 'save', report: remember(r), expectedRevision: r.revision - 1 });
  beforeAll(async () => {
    if (!local || process.env.GCLOUD_PROJECT !== projectId || !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '')) throw new Error('Explicit isolated demo Firestore and auth required.');
    app = initializeApp({ projectId }, 'operations-report-emulator'); db = getFirestore(app); adminAuth = getAdminAuth(app);
    const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
    environment = await initializeTestEnvironment({ projectId, firestore: { host, port: Number(port), rules: readFileSync('firestore.rules', 'utf8') } });
    client = initializeClient({ projectId, apiKey: 'demo-operations-key', authDomain: 'localhost' }, 'operations-report-client');
    const clientAuth = getAuth(client); connectAuthEmulator(clientAuth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
    for (let n = 0; n < users.length; n++) {
      const uid = users[n], email = `${uid}@example.test`; paths.add(`users/${uid}`);
      await db.doc(`users/${uid}`).set({ role: roles[n] }); await adminAuth.createUser({ uid, email, password: 'synthetic-test-only-123' });
      tokens[uid] = await (await signInWithEmailAndPassword(clientAuth, email, 'synthetic-test-only-123')).user.getIdToken();
    }
  }, 60000);
  afterAll(async () => {
    if (adminAuth) await Promise.all(users.map(uid => adminAuth.deleteUser(uid).catch(() => {})));
    if (client) await deleteClient(client); if (db) { await Promise.all([...paths].map(path => db.doc(path).delete())); await db.terminate(); }
    if (environment) await environment.cleanup(); if (app) await deleteApp(app);
  });
  it('persists and reloads exact snapshots, replays idempotently and retains corrected history', async () => {
    expect(await save(report)).toMatchObject({ revision: 1, duplicate: false }); expect(await save(report)).toMatchObject({ duplicate: true });
    const corrected = { ...report, revision: 2, correctionReason: 'تصحيح معزول', summary: 'ملخص التصحيح في الاختبار' };
    await save(corrected);
    const after = await operationsReports(db, auth, { action: 'read', reportId: report.reportId });
    expect(operationsSubmission(after.report)).toEqual(corrected); expect(after.history).toHaveLength(2); expect(after.savedAt).toBeTruthy();
    expect(operationsSubmission((await operationsReports(db, auth, { action: 'read', reportId: report.reportId, revision: 1 })).report)).toEqual(report);
    await expect(save({ ...report, summary: 'استبدال غير مسموح' })).rejects.toMatchObject({ code: 'already-exists' });
    await expect(save({ ...corrected, revision: 4 })).rejects.toMatchObject({ code: 'failed-precondition' });
  });
  it('serializes conflicting concurrent writers without replacing the winner', async () => {
    const r = operationsFixture({ round: 'concurrency' });
    const outcomes = await Promise.allSettled([r, { ...r, summary: 'محتوى متعارض معزول' }].map(value => save(value)));
    expect(outcomes.filter(x => x.status === 'fulfilled')).toHaveLength(1); expect(outcomes.filter(x => x.status === 'rejected')).toHaveLength(1);
    expect((await db.doc(`operations_reports/${r.reportId}`).get()).data().revision).toBe(1);
  });
  it('preserves unknown historical service dates and original authors without replacing them with archival time', async () => {
    const r = operationsFixture({ archiveMode: 'historical_imported', sourceRole: 12, sourceLabel: 'مدير العمليات — الرقم التاريخي12',
      round: 'historic-null', serviceDateRiyadh: null, period: { from: null, to: null }, cutAtRiyadh: null, issuedAtRiyadh: null,
      historicalImported: { originalSourceRole: 12, originalSourceRef: 'OLD-THREAD-REPORT', originalReportDate: '2026-10-18', sourceSha256: 'b'.repeat(64),
        evidenceThroughDate: '2026-10-18', cutPrecision: 'date_only', timeNote: 'نطاق الخدمة غير معروف والوقت مفقود؛ لا تاريخ بديل.' } });
    await save(r); const after = await operationsReports(db, auth, { action: 'read', reportId: r.reportId });
    expect(operationsSubmission(after.report)).toEqual(r); expect(after.report.period.from).toBeNull(); expect(after.report.cutAtRiyadh).toBeNull();
    expect(after.report.sourceRole).toBe(12); expect(after.savedAt).not.toBeNull();
  });
  it.each(users.slice(1))('denies current %s on service list/read/save', async uid => {
    for (const input of [{ action: 'list' }, { action: 'read', reportId: report.reportId }, { action: 'save', report, expectedRevision: 0 }])
      await expect(operationsReports(db, { uid }, input)).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it.each([...users, null])('default production rules deny direct SDK reads/lists/writes including %s', async uid => {
    const store = uid ? environment.authenticatedContext(uid).firestore() : environment.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(store, 'operations_reports', report.reportId)));
    await assertFails(getDocs(collection(store, 'operations_reports')));
    await assertFails(setDoc(doc(store, 'operations_reports', 'attack'), { summary: 'ممنوع' }));
    await assertFails(getDoc(doc(store, 'operations_reports', report.reportId, 'revisions', '000001')));
  });
  it('verifies actual demo tokens through HTTP, reads back, and rejects forged or nonadmin identities', async () => {
    const handler = createOperationsReportsHandler(() => ({ db, auth: adminAuth }));
    const invoke = async (body, uid = 'ops-admin') => {
      const res = { setHeader() {}, status(n) { this.code = n; return this; }, json(value) { this.body = value; return this; } };
      await handler({ method: 'POST', headers: { authorization: `Bearer ${tokens[uid] || 'FORGED'}` }, body }, res); return res;
    };
    const r = remember(operationsFixture({ round: 'http' }));
    expect((await invoke({ action: 'save', report: r, expectedRevision: 0 })).body.result).toMatchObject({ duplicate: false });
    expect(operationsSubmission((await invoke({ action: 'read', reportId: r.reportId })).body.result.report)).toEqual(r);
    expect((await invoke({ action: 'save', report: r, expectedRevision: 0 })).body.result.duplicate).toBe(true);
    for (const uid of users.slice(1)) expect((await invoke({ action: 'read', reportId: r.reportId }, uid)).code).toBe(403);
    expect((await invoke({ action: 'list' }, 'forged')).code).toBe(401);
  });
});
