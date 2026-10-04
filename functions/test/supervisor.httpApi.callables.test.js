import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initializeApp as initAdmin, deleteApp as deleteAdmin } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import handler, { __resetAdmin } from '../../api/ledger.js';
import { HANDLER_NAMES } from '../src/handlers.js';
import { SUPERVISOR_READ_HANDLERS } from '../../src/lib/supervisorAccess.js';
import { supervisorFixture } from './fixtures/supervisor.js';
const enabled = process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST;
const run = enabled ? describe : describe.skip;
const PROJECT = 'demo-sweater';
let app, client, db, auth, functions, tokens = {};
function post(name, data, token) {
  const res = { setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  return handler({ method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: { name, data } }, res).then(() => res);
}
run('supervisor real authenticated HTTP and Functions journeys', () => {
  beforeAll(async () => {
    __resetAdmin(); app = initAdmin({ projectId: PROJECT }); db = getFirestore(app);
    client = initializeApp({ apiKey: 'fake-api-key', projectId: PROJECT }, 'supervisor-client'); auth = getAuth(client);
    connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
    functions = getFunctions(client, 'us-central1');
    // firebase.test.json pins the Functions port; emulators:exec does not
    // export FUNCTIONS_EMULATOR_HOST (same setup as callables.test.js).
    connectFunctionsEmulator(functions, '127.0.0.1', 5001);
    for (const role of ['supervisor', 'admin', 'accountant', 'operator', 'partner']) {
      const email = `supervisor-test-${role}@sweater.test`;
      const user = await getAdminAuth(app).createUser({ email, password: 'test-only-password' }).catch(() => getAdminAuth(app).getUserByEmail(email));
      await db.collection('users').doc(user.uid).set({ role });
      if (role === 'supervisor') {
        await db.collection('app_admins').doc(user.uid).set({ note: 'legacy-marker' });
        await getAdminAuth(app).setCustomUserClaims(user.uid, { admin: true, role: 'admin' });
      }
      const credential = await signInWithEmailAndPassword(auth, email, 'test-only-password'); tokens[role] = await credential.user.getIdToken();
    }
    for (const [name, rows] of Object.entries(supervisorFixture())) {
      const existing = await db.collection(name).get(); await Promise.all(existing.docs.map(d => d.ref.delete()));
      for (const { id, ...data } of rows) await db.collection(name).doc(id).set(data);
    }
    await signInWithEmailAndPassword(auth, 'supervisor-test-supervisor@sweater.test', 'test-only-password');
  }, 120000);
  afterAll(async () => { __resetAdmin(); if (client) await deleteApp(client); if (app) await deleteAdmin(app); });
  it('reads curated report through both transports, without payment/identity fields', async () => {
    const http = await post('supervisorOverview', { periodKey: '2026-08' }, tokens.supervisor);
    expect(http.statusCode).toBe(200); expect(http.body.result.share.referenceAmount).toBe(40);
    const callable = await httpsCallable(functions, 'supervisorOverview')({ periodKey: '2026-08' });
    expect(callable.data.share).toEqual(http.body.result.share);
    expect(JSON.stringify(callable.data)).not.toMatch(/private-phone|private-id|salary/);
    const records = await post('supervisorRecords', { collection: 'bikers' }, tokens.supervisor);
    expect(records.statusCode).toBe(200); expect(JSON.stringify(records.body)).not.toMatch(/private-phone|private-id|salary/);
    expect((await post('authBootstrapStatus', {}, tokens.supervisor)).statusCode).toBe(200);
    expect((await httpsCallable(functions, 'authBootstrapStatus')({})).data.unclaimed).toBe(false);
  });
  it.each(['accountant', 'operator', 'partner'])('cannot impersonate supervisor from %s', async role => {
    const res = await post('supervisorOverview', { periodKey: '2026-08', role: 'supervisor' }, tokens[role]);
    expect(res.statusCode).toBe(403);
  });
  it('denies anonymous and invalid tokens', async () => {
    expect((await post('supervisorOverview', { periodKey: '2026-08' }, null)).statusCode).toBe(401);
    expect((await post('supervisorOverview', { periodKey: '2026-08' }, 'fake')).statusCode).toBe(401);
  });
  it.each(HANDLER_NAMES.filter(n => !SUPERVISOR_READ_HANDLERS.includes(n)))('refuses non-allowlisted operation %s via HTTP and Functions', async name => {
    const res = await post(name, { role: 'admin', apply: true }, tokens.supervisor);
    expect(res.statusCode).toBe(403); expect(res.body.error.code).toBe('permission-denied');
    await expect(httpsCallable(functions, name)({ role: 'admin', apply: true })).rejects.toMatchObject({ code: 'functions/permission-denied' });
  });
  it('all refusals leave financial sources unchanged', async () => {
    expect((await db.collection('journal_entries').get()).size).toBe(2);
    expect((await db.collection('washes').doc('w1').get()).data().quantity).toBe(10);
    expect((await db.collection('fee_rules').get()).size).toBe(0);
  });
});
