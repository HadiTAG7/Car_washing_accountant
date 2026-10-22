// طبقة المتصفح على Supabase المحلي، عبر supabase-js الحقيقي: الدخول، القراءة،
// الاستعلام، الكتابة، الدمج الذري، الدفعات، الرفض — والتوكن يقبله الخادم.
// التشغيل: npx supabase start && npm run test:supabase
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { tableFor } from '../../schema/registry.js';
import { writeDocument, readDocuments } from '../../../../../server/db/rows.js';
import { decodeDocument, plainTimestamp } from '../../schema/codec.js';
import { available, resetDb, asOwner, closeDb, db } from '../../__tests__/supabaseTestDb.js';
import { __setSupabaseClient } from '../client.js';
import {
  getFirestore, collection, doc, query, where, orderBy, limit, documentId, getDoc, getDocs, getCountFromServer,
  setDoc, addDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp, deleteField, Timestamp,
} from '../firestore.js';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from '../auth.js';
import { verifySupabaseToken, supabaseAuth } from '../../../../../server/db/backend.js';
import { trialBalance, trialBalanceFromSums, balanceSheet, balanceSheetFromTrialBalance } from '../../../accounting/reports.js';
import { fetchPostedLineSums } from '../../../accounting/ledgerSums.js';
import { createStore } from '../../../../../server/db/pgstore/index.js';

const up = await available();
const d = up ? describe : describe.skip;

function localEnv() {
  const out = execFileSync('npx', ['supabase', 'status', '-o', 'env'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return Object.fromEntries(out.split('\n').map(l => /^([A-Z_]+)="?(.*?)"?$/.exec(l.trim())).filter(Boolean).map(m => [m[1], m[2]]));
}

const PASSWORD = 'Shim-test-password-1';
const fs = getFirestore();
let env; let admin; let auth; const uid = {};
const put = (c, collectionName, id, data) => writeDocument(c, tableFor(collectionName).table, id, data, { mode: 'replace' });

async function signInAs(name) {
  if (auth.currentUser) await signOut(auth);
  await signInWithEmailAndPassword(auth, `${name}@sweater.test`, PASSWORD);
}
/** The same document as the server reads it (pgstore's decoder over the row). */
async function serverRead(collectionName, id) {
  const table = tableFor(collectionName).table;
  const [found] = await readDocuments(db(), table, { makeTimestamp: plainTimestamp }, { where: 'where id = $1', params: [id] });
  return found?.data;
}
const plain = v => JSON.parse(JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && 'seconds' in x && 'nanoseconds' in x ? { s: x.seconds, n: x.nanoseconds } : x)));

d('طبقة المتصفح على Supabase', () => {
  beforeAll(async () => {
    env = localEnv();
    admin = createClient(env.API_URL, env.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    __setSupabaseClient(createClient(env.API_URL, env.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } }));
    auth = getAuth();
  }, 60_000);
  beforeEach(async () => {
    if (auth.currentUser) await signOut(auth);
    await resetDb();
    for (const [name, role] of [['operator', 'operator'], ['accountant', 'accountant'], ['partner', 'partner']]) {
      const { data, error } = await admin.auth.admin.createUser({ email: `${name}@sweater.test`, password: PASSWORD, email_confirm: true });
      if (error) throw error;
      uid[name] = data.user.id;
      await asOwner(c => put(c, 'users', data.user.id, { email: `${name}@sweater.test`, role }));
    }
    await asOwner(async (c) => {
      for (const [code, type, nb] of [['1100', 'asset', 'debit'], ['4000', 'revenue', 'credit']]) {
        await put(c, 'chart_of_accounts', code, { code, nameArabic: code, accountType: type, normalBalance: nb, active: true });
      }
    });
  }, 60_000);
  afterAll(async () => { if (auth?.currentUser) await signOut(auth); await resetDb(); await closeDb(); });

  it('الدخول: كلمة خاطئة مرفوضة برمز Firebase، والصحيحة تعطي المستخدم وتوكناً يقبله الخادم', async () => {
    await expect(signInWithEmailAndPassword(auth, 'operator@sweater.test', 'wrong-password')).rejects.toMatchObject({ code: 'auth/invalid-credential' });
    const seen = [];
    const stop = onAuthStateChanged(auth, u => seen.push(u?.uid ?? null));
    await signInAs('operator');
    expect(auth.currentUser.uid).toBe(uid.operator);
    const token = await auth.currentUser.getIdToken();
    const serverEnv = { SUPABASE_URL: env.API_URL, SUPABASE_JWT_SECRET: env.JWT_SECRET };
    expect((await verifySupabaseToken(token, serverEnv)).sub).toBe(uid.operator);
    const store = createStore({ connectionString: env.DB_URL, role: 'ledger_server' });
    try {
      const verifier = supabaseAuth(store, serverEnv);
      expect((await verifier.verifyIdToken(token, true)).uid).toBe(uid.operator);
      await signOut(auth);
      // Signed out: the same, still unexpired token is refused at once.
      await expect(verifier.verifyIdToken(token, true)).rejects.toThrow('session-revoked');
    } finally { await store.close(); stop(); }
    expect(seen).toContain(uid.operator);
  });

  it('الكتابة والقراءة: المستند كما كُتب، وكما يقرؤه الخادم حرفاً بحرف', async () => {
    await signInAs('operator');
    const ref = doc(fs, 'washes', 'w1');
    const data = {
      wash_date: '2026-10-05', quantity: 2, price: 57.5, status: 'مكتملة', biker_id: null,
      notes_extra: { tags: ['a', 'b'], nested: { n: 1.25 } }, created_at: Timestamp.fromMillis(1760000000123),
    };
    await setDoc(ref, data);
    const snap = await getDoc(ref);
    expect(snap.exists()).toBe(true);
    expect(plain(snap.data())).toEqual(plain(data));
    expect(snap.data().created_at).toBeInstanceOf(Timestamp);
    expect(plain(await serverRead('washes', 'w1'))).toEqual(plain(snap.data()));
    expect((await getDoc(doc(fs, 'washes', 'missing'))).exists()).toBe(false);
  });

  it('التعديل: حقوله فقط، deleteField يحذف، وserverTimestamp من القاعدة', async () => {
    await signInAs('operator');
    const ref = doc(fs, 'washes', 'w1');
    await setDoc(ref, { wash_date: '2026-10-05', price: 20, status: 'مكتملة', note: 'x' });
    const before = Date.now();
    await updateDoc(ref, { price: 25, note: deleteField(), updated_at: serverTimestamp() });
    const after = (await getDoc(ref)).data();
    expect(after).toMatchObject({ wash_date: '2026-10-05', price: 25, status: 'مكتملة' });
    expect(after).not.toHaveProperty('note');
    expect(Math.abs(after.updated_at.toMillis() - before)).toBeLessThan(60_000);
    await expect(updateDoc(doc(fs, 'washes', 'nope'), { price: 1 })).rejects.toMatchObject({ code: 'not-found' });
  });

  it('الاستعلامات: حدود الشهر، الترتيب، الحد، المعرّفات، null، والعدّ', async () => {
    await signInAs('operator');
    const W = collection(fs, 'washes');
    for (const [id, date, price] of [['a', '2026-09-30', 10], ['b', '2026-10-01', 20], ['c', '2026-10-15', 30], ['d', '2026-10-31', 40], ['e', '2026-11-01', 50]]) {
      await setDoc(doc(W, id), { wash_date: date, price, biker_id: id === 'c' ? null : 'b1' });
    }
    const ids = s => s.docs.map(x => x.id);
    expect(ids(await getDocs(query(W, where('wash_date', '>=', '2026-10'), where('wash_date', '<', '2026-11'))))).toEqual(['b', 'c', 'd']);
    expect(ids(await getDocs(query(W, orderBy('price', 'desc'), limit(2))))).toEqual(['e', 'd']);
    expect(ids(await getDocs(query(W, where(documentId(), 'in', ['d', 'a', 'zz']))))).toEqual(['a', 'd']);
    expect(ids(await getDocs(query(W, where('biker_id', '==', null))))).toEqual(['c']);
    expect((await getCountFromServer(query(W, where('wash_date', '>=', '2026-10-01')))).data().count).toBe(4);
    await setDoc(doc(W, 'f'), { wash_date: '2026-10-02', price: 5 }); // no biker_id at all
    expect(ids(await getDocs(query(W, where('biker_id', '!=', null))))).toEqual(['a', 'b', 'd', 'e']);
    // A filter of another type matches nothing, as in Firestore.
    expect(ids(await getDocs(query(W, where('price', '==', '20'))))).toEqual([]);
  });

  it('الدمج ذري: دمجان متزامنان على مستند واحد يبقيان كلاهما', async () => {
    await signInAs('accountant');
    const ref = doc(fs, 'app_settings', 'company');
    await setDoc(ref, { value: { name: 'سويتر', address: 'الرياض' } });
    await Promise.all([
      setDoc(ref, { value: { vatNumber: '300000000000003' } }, { merge: true }),
      setDoc(ref, { updatedBy: 'u-acc' }, { merge: true }),
    ]);
    expect((await getDoc(ref)).data()).toEqual({ value: { name: 'سويتر', address: 'الرياض', vatNumber: '300000000000003' }, updatedBy: 'u-acc' });
  });

  it('الدفعة: كل عملياتها بترتيبها أو لا شيء', async () => {
    await signInAs('operator');
    const ref = doc(fs, 'washes', 'w1');
    await setDoc(ref, { wash_date: '2026-10-05', price: 10 });
    const b = writeBatch(fs);
    b.set(ref, { price: 11, status: 'x' }, { merge: true });
    b.update(ref, { price: 12 });
    b.set(doc(fs, 'washes', 'w2'), { wash_date: '2026-10-06', price: 5 });
    await b.commit();
    expect((await getDoc(ref)).data()).toMatchObject({ price: 12, status: 'x' });
    expect((await getDoc(doc(fs, 'washes', 'w2'))).exists()).toBe(true);

    const bad = writeBatch(fs);
    bad.set(doc(fs, 'washes', 'w3'), { wash_date: '2026-10-07', price: 1 });
    bad.set(doc(fs, 'journal_entries', 'je-x'), { status: 'posted' }); // never from the browser
    await expect(bad.commit()).rejects.toMatchObject({ code: 'permission-denied' });
    expect((await getDoc(doc(fs, 'washes', 'w3'))).exists()).toBe(false);
  });

  it('الغسلة المرحّلة: التعديل والحذف مرفوضان برمز permission-denied', async () => {
    await signInAs('operator');
    await setDoc(doc(fs, 'washes', 'w1'), { wash_date: '2026-10-05', price: 20 });
    await asOwner(async (c) => {
      await put(c, 'journal_entries', 'e1', { entryDate: '2026-10-05', periodKey: '2026-10', status: 'posted', sourceType: 'wash', sourceId: 'w1', entryNumber: 1,
        lines: [{ accountId: '1100', debit: 20, credit: 0, description: '' }, { accountId: '4000', debit: 0, credit: 20, description: '' }], totalDebit: 20, totalCredit: 20 });
      await put(c, 'posting_locks', 'wash__w1', { kind: 'wash', sourceId: 'w1', entryId: 'e1' });
    });
    await expect(updateDoc(doc(fs, 'washes', 'w1'), { price: 99 })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(deleteDoc(doc(fs, 'washes', 'w1'))).rejects.toMatchObject({ code: 'permission-denied' });
    expect((await getDoc(doc(fs, 'washes', 'w1'))).data().price).toBe(20);
  });

  it('القيود بسطورها للمحاسب كما يقرؤها الخادم؛ والشريك لا يرى شيئاً', async () => {
    const entry = { entryDate: '2026-10-05', periodKey: '2026-10', status: 'posted', sourceType: 'manual', entryNumber: 3, description: 'قيد',
      lines: [{ accountId: '1100', debit: 75.5, credit: 0, description: 'نقد' }, { accountId: '4000', debit: 0, credit: 75.5, description: 'إيراد' }],
      totalDebit: 75.5, totalCredit: 75.5, createdAt: Timestamp.fromMillis(1760000000000) };
    await asOwner(c => put(c, 'journal_entries', 'e3', entry));
    await signInAs('accountant');
    const snap = await getDoc(doc(fs, 'journal_entries', 'e3'));
    expect(plain(snap.data())).toEqual(plain(entry));
    const { rows } = await db().query(`select * from public.journal_entries where id = 'e3'`);
    const lines = (await db().query(`select * from public.journal_entry_lines where entry_id = 'e3'`)).rows;
    expect(plain(decodeDocument(tableFor('journal_entries').table, rows[0], lines, { makeTimestamp: plainTimestamp }))).toEqual(plain(snap.data()));
    await signInAs('partner');
    expect((await getDocs(collection(fs, 'journal_entries'))).size).toBe(0);
  });

  it('ميزان المراجعة من مجاميع القاعدة = ميزان المحرك من القيود نفسها، لكل نافذة تاريخ', async () => {
    // Random balanced entries in whole halalas, mixed statuses and dates.
    let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const accounts = ['1100', '4000'];
    await asOwner(async (c) => {
      for (const [code, type, nb] of [['1010', 'asset', 'debit'], ['2100', 'liability', 'credit'], ['5000', 'expense', 'debit']]) {
        accounts.push(code); await put(c, 'chart_of_accounts', code, { code, nameArabic: code, accountType: type, normalBalance: nb, active: true });
      }
      for (let i = 0; i < 120; i += 1) {
        const day = `2026-${String(8 + Math.floor(rnd() * 4)).padStart(2, '0')}-${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}`;
        const n = 2 + Math.floor(rnd() * 3); const lines = []; let total = 0;
        for (let k = 0; k < n - 1; k += 1) {
          const amount = Math.round(rnd() * 100000) / 100 + 0.01; total = Math.round((total + amount) * 100) / 100;
          lines.push({ accountId: accounts[Math.floor(rnd() * accounts.length)], debit: amount, credit: 0, description: '' });
        }
        lines.push({ accountId: accounts[Math.floor(rnd() * accounts.length)], debit: 0, credit: total, description: '' });
        const status = rnd() < 0.8 ? 'posted' : rnd() < 0.5 ? 'reversed' : 'draft';
        await put(c, 'journal_entries', `e${String(i).padStart(3, '0')}`, { entryDate: day, periodKey: day.slice(0, 7), status, sourceType: 'manual',
          entryNumber: i + 1, lines, totalDebit: total, totalCredit: total });
      }
    });
    await signInAs('accountant');
    const chart = (await getDocs(collection(fs, 'chart_of_accounts'))).docs.map(x => ({ id: x.id, ...x.data() }));
    const entries = (await getDocs(collection(fs, 'journal_entries'))).docs.map(x => ({ id: x.id, ...x.data() }));
    const lines = entries.flatMap(e => (e.lines || []).map((l, i) => ({ ...l, entryId: e.id, id: `${e.id}:${i}` })));
    for (const [from, to] of [[null, null], ['2026-09-01', '2026-09-30'], [null, '2026-10-15'], ['2026-10-16', null], ['2026-12-01', null]]) {
      const engine = trialBalance(chart, entries, lines, { from, to });
      const sql = trialBalanceFromSums(chart, await fetchPostedLineSums({ from, to }));
      expect(sql).toEqual(engine);
    }
    // The balance sheet over the same sums, with fees on revenue and on profit.
    const feeRules = [{ key: 'mgmt', label: 'إدارة', basis: 'profit', rate: 0.1, effectiveFrom: '2026-09-01' }, { key: 'platform', label: 'منصة', basis: 'revenue', rate: 0.025, effectiveFrom: null }];
    for (const asOf of [null, '2026-08-31', '2026-10-15', '2026-11-30']) {
      const engine = balanceSheet(chart, entries, lines, { asOf, feeRules });
      const sql = balanceSheetFromTrialBalance(chart, trialBalanceFromSums(chart, await fetchPostedLineSums({ to: asOf })), { asOf, feeRules });
      expect(sql).toEqual(engine);
    }
  });

  it('addDoc يعطي معرّفاً بشكل Firestore', async () => {
    await signInAs('operator');
    const ref = await addDoc(collection(fs, 'washes'), { wash_date: '2026-10-05', price: 1 });
    expect(ref.id).toMatch(/^[A-Za-z0-9]{20}$/);
    expect((await getDoc(ref)).exists()).toBe(true);
  });
});
