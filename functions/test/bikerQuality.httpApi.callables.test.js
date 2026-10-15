import { beforeAll, afterAll, expect, it, describe } from 'vitest';
import { initializeApp as initAdmin, deleteApp as deleteAdmin } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth as adminAuth } from 'firebase-admin/auth';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import handler from '../../api/biker-quality-reports.js';
import { QUALITY_COLLECTION, qualityReportId } from '../../server/bikerQualityReports.js';
import { manualReviewId } from '../../server/bikerQualityManual.js';

const enabled = process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST;
const projectId = process.env.GCLOUD_PROJECT || 'demo-sweater';
const suite = enabled ? describe : describe.skip;
let db, auth, adminApp, client;
const tokens = {}, users = {};
const report = () => ({ bikerUID: 'quality-demo-worker', periodKey: '2026-10', from: '2026-10-01', to: '2026-10-13',
  rulesVersion: 'cqo-20261014-v1', sourceReadDate: '2026-10-14', improvement: 'Review measured exception; no assumed cause.',
  samples: [{ washId: 'quality-demo-wash', serviceDate: '2026-10-12', start: '2026-10-12T10:00:00+03:00',
    end: '2026-10-12T11:00:00+03:00', sourceHash: 'a'.repeat(64) }] });
const read = { bikerUID: 'quality-demo-worker', periodKey: '2026-10', rulesVersion: 'cqo-20261014-v1' };
const v2 = () => ({ ...report(), to: '2026-10-14', sourceReadDate: '2026-10-15', rulesVersion: 'cqo-20261015-v2', snapshotAt: '2026-10-15T09:00:00Z',
  sourceIdentity: { externalId: '1984', sspId: '1320' }, evidence: { ratings: [{ from: '2026-10-10', to: '2026-10-10',
    wash: { mean: 3, n: 2 }, behavior: { mean: 4, n: 2 }, source: { reference: 'Isolated source evidence', hash: 'b'.repeat(64), readDate: '2026-10-15' } }] } });
const v2Ids = () => [qualityReportId(v2()), qualityReportId({ ...v2(), snapshotAt: '2026-10-15T09:01:00Z' })];
const v3 = () => ({ ...v2(), rulesVersion: 'cqo-20261015-v3', snapshotAt: '2026-10-15T09:02:00Z', evidence: { ...v2().evidence,
  productivity: { completed: [{ washId: 'quality-demo-wash', serviceDate: '2026-10-12' }], source: v2().evidence.ratings[0].source, coverage: 'complete-period' },
  updates: { coverage: 'complete-period', reviews: [{ washId: 'quality-demo-wash', serviceDate: '2026-10-12', appointmentId: 'quality-booking',
    readStatus: 'read', arrival: '2026-10-12T09:55:00+03:00', start: report().samples[0].start, end: report().samples[0].end, source: v2().evidence.ratings[0].source }] },
} });
async function request(operation, data, token, method = 'POST') {
  const res = { headers: {}, statusCode: null, body: null,
    setHeader(key, value) { this.headers[key] = value; }, status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; } };
  await handler({ method, headers: token ? { authorization: `Bearer ${token}` } : {}, body: { operation, data } }, res);
  return res;
}
suite('Admin private quality HTTP: verified Firebase identity and unchanged membership policy', () => {
  beforeAll(async () => {
    if (!projectId.startsWith('demo-')) throw new Error('Demo project only');
    adminApp = initAdmin({ projectId }, 'quality-api-test');
    db = getFirestore(adminApp); auth = adminAuth(adminApp);
    client = initializeApp({ apiKey: 'fake', projectId }, 'quality-client');
    const clientAuth = getAuth(client);
    connectAuthEmulator(clientAuth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
    for (const role of ['admin', 'accountant', 'partner', 'operator', 'supervisor', 'unknown']) {
      const email = `quality-${role}@sweater.test`;
      const user = await auth.createUser({ email, password: 'quality-demo-only-123' }).catch(() => auth.getUserByEmail(email));
      users[role] = user.uid;
      await db.collection('users').doc(user.uid).set({ role });
      const credential = await signInWithEmailAndPassword(clientAuth, email, 'quality-demo-only-123');
      tokens[role] = await credential.user.getIdToken();
    }
    await db.collection('bikers').doc(read.bikerUID).set({ name: 'Dummy worker', start_date: '2026-08-01', driver_external_id: '1984' });
    await db.collection('washes').doc('quality-demo-wash').set({ biker_id: read.bikerUID, wash_date: '2026-10-12', quantity: 1, status: 'completed', ssp_booking_id: 'quality-booking' });
    await db.collection(QUALITY_COLLECTION).doc(qualityReportId(report())).delete();
    for (const id of v2Ids()) await db.collection(QUALITY_COLLECTION).doc(id).delete();
    await db.collection(QUALITY_COLLECTION).doc(qualityReportId(v3())).delete();
    await db.collection(QUALITY_COLLECTION).doc(manualReviewId(read.bikerUID, read.periodKey)).delete();
  });
  afterAll(async () => {
    if (db) {
      await db.collection(QUALITY_COLLECTION).doc(qualityReportId(report())).delete();
      for (const id of v2Ids()) await db.collection(QUALITY_COLLECTION).doc(id).delete();
      await db.collection(QUALITY_COLLECTION).doc(qualityReportId(v3())).delete();
      await db.collection(QUALITY_COLLECTION).doc(manualReviewId(read.bikerUID, read.periodKey)).delete();
      await db.collection('bikers').doc(read.bikerUID).delete();
      await db.collection('washes').doc('quality-demo-wash').delete();
      for (const uid of Object.values(users)) { await db.collection('users').doc(uid).delete(); await auth.deleteUser(uid); }
    }
    if (client) await deleteApp(client);
    if (adminApp) await deleteAdmin(adminApp);
  });
  it('refuses missing/forged identity and unsupported method', async () => {
    expect((await request('read', read)).statusCode).toBe(401);
    expect((await request('read', read, 'forged-admin-token')).statusCode).toBe(401);
    expect((await request('read', read, tokens.admin, 'GET')).statusCode).toBe(405);
  });
  it.each(['partner', 'accountant', 'operator', 'supervisor', 'unknown'])('refuses read, write and worker existence probing for %s', async role => {
    expect((await request('read', { ...read, bikerUID: 'non-existent' }, tokens[role])).statusCode).toBe(403);
    expect((await request('save', { reports: [report()] }, tokens[role])).statusCode).toBe(403);
    expect((await request('read', { ...read, rulesVersion: 'all-approved', includeSource: true }, tokens[role])).statusCode).toBe(403);
    expect((await request('save', { reports: [v2()] }, tokens[role])).statusCode).toBe(403);
    expect((await request('save', { reports: [v3()] }, tokens[role])).statusCode).toBe(403);
    for (const op of ['manual-note', 'manual-correct', 'manual-confirm']) expect((await request(op, { bikerUID: 'non-existent' }, tokens[role])).statusCode).toBe(403);
  });
  it('saves and reads by UID/month/version; retry is idempotent; no invented final score', async () => {
    const saved = await request('save', { reports: [report()] }, tokens.admin);
    expect(saved.statusCode).toBe(200);
    expect(saved.body.result).toMatchObject({ created: 1, unchanged: 0 });
    const stored = await request('read', read, tokens.admin);
    expect(stored.statusCode).toBe(200);
    expect(stored.headers['Cache-Control']).toBe('private, no-store');
    expect(stored.body.result.reports).toHaveLength(1);
    expect(stored.body.result.reports[0]).toMatchObject({ bikerUID: read.bikerUID, finalScore: null, status: 'incomplete', duration: { points: 8, n: 1 } });
    expect((await request('read', { ...read, periodKey: '2026-09' }, tokens.admin)).body.result.reports).toEqual([]);
    expect((await request('read', { ...read, bikerUID: 'other-worker' }, tokens.admin)).body.result.reports).toEqual([]);
    expect((await request('save', { reports: [report()] }, tokens.admin)).body.result).toMatchObject({ created: 0, unchanged: 1 });
    expect((await request('save', { reports: [{ ...report(), improvement: 'Changed report' }] }, tokens.admin)).statusCode).toBe(409);
  });
  it('rejects wrong worker links and nonexistent roster UID atomically', async () => {
    const wrong = { ...report(), bikerUID: 'quality-missing-worker' };
    expect((await request('save', { reports: [wrong] }, tokens.admin)).statusCode).toBe(412);
    await db.collection('washes').doc('quality-demo-wash').update({ biker_id: 'other-worker' });
    expect((await request('save', { reports: [report()] }, tokens.admin)).statusCode).toBe(412);
    await db.collection('washes').doc('quality-demo-wash').update({ biker_id: read.bikerUID });
  });
  it('persists and reads separate immutable v2 snapshots alongside unchanged v1, with current external identity validation', async () => {
    const old = (await db.collection(QUALITY_COLLECTION).doc(qualityReportId(report())).get()).data();
    const first = await request('save', { reports: [v2()] }, tokens.admin);
    expect(first.statusCode).toBe(200); expect(first.body.result.created).toBe(1);
    expect((await request('save', { reports: [v2()] }, tokens.admin)).body.result).toMatchObject({ created: 0, unchanged: 1 });
    expect((await request('save', { reports: [{ ...v2(), improvement: 'Changed' }] }, tokens.admin)).statusCode).toBe(409);
    expect((await request('save', { reports: [{ ...v2(), snapshotAt: '2026-10-15T09:01:00Z' }] }, tokens.admin)).statusCode).toBe(200);
    const got = await request('read', { ...read, rulesVersion: 'all-approved' }, tokens.admin);
    expect(got.body.result.reports).toHaveLength(3);
    expect(got.body.result.reports[0]).toMatchObject({ rulesVersion: 'cqo-20261015-v2', availablePoints: 42, availableWeight: 60, finalScore: null });
    expect(got.body.result.reports[0].components.find(c => c.key === 'washQuality')).toMatchObject({ points: 18, n: 2, approximate: true });
    expect((await db.collection(QUALITY_COLLECTION).doc(qualityReportId(report())).get()).data()).toEqual(old);
    expect((await request('save', { reports: [{ ...v2(), sourceIdentity: { externalId: 'other', sspId: '1320' } }] }, tokens.admin)).statusCode).toBe(412);
    expect((await request('read', { ...read, periodKey: '2026-09', rulesVersion: 'all-approved' }, tokens.admin)).body.result.reports).toEqual([]);
    expect((await request('read', { ...read, bikerUID: 'other-worker', rulesVersion: 'all-approved' }, tokens.admin)).body.result.reports).toEqual([]);
  });
  it.each(['مكتملة', 'completed', 'complete'])('accepts canonical stored completion %s and refuses in-progress rows', async status => {
    await db.collection('washes').doc('quality-demo-wash').update({ status });
    expect((await request('save', { reports: [report()] }, tokens.admin)).statusCode).toBe(200);
    await db.collection('washes').doc('quality-demo-wash').update({ status: 'قيد التنفيذ' });
    expect((await request('save', { reports: [report()] }, tokens.admin)).statusCode).toBe(412);
    await db.collection('washes').doc('quality-demo-wash').update({ status: 'completed' });
  });
  it('persists v3 with canonical coverage and private read-only source context, not invented completion', async () => {
    const saved = await request('save', { reports: [v3()] }, tokens.admin);
    expect(saved.statusCode).toBe(200); expect(saved.body.result.created).toBe(1);
    const again = await request('save', { reports: [v3()] }, tokens.admin);
    expect(again.body.result).toMatchObject({ created: 0, unchanged: 1 });
    const got = await request('read', { ...read, rulesVersion: 'cqo-20261015-v3', includeSource: true }, tokens.admin);
    expect(got.statusCode).toBe(200);
    expect(got.body.result.reports[0]).toMatchObject({ availablePoints: 53.25, availableWeight: 80, finalScore: null,
      coverage: { canonicalCompleted: 1, durationMeasured: 1, durationMissing: 0 } });
    expect(got.body.result.source).toMatchObject({ available: true, bikerUID: read.bikerUID, externalId: '1984',
      eligible: [{ washId: 'quality-demo-wash', serviceDate: '2026-10-12', sspBookingId: 'quality-booking' }] });
    expect(JSON.stringify(got.body.result.source)).not.toMatch(/salary|price|payment|iqama|phone/);
    expect((await request('read', { ...read, bikerUID: 'other-worker', rulesVersion: 'all-approved', includeSource: true }, tokens.admin)).body.result.source.available).toBe(false);
  });
  it('persists manual notes, confirms explicit review, audits correction and preserves the old v3 snapshot', async () => {
    const old = (await db.collection(QUALITY_COLLECTION).doc(qualityReportId(v3())).get()).data();
    const scope = { bikerUID: read.bikerUID, periodKey: read.periodKey, from: '2026-10-01', to: '2026-10-14' };
    const note = { ...scope, revision: 0, requestId: 'manual-demo-note', washId: 'quality-demo-wash', stages: ['arrival', 'start'], note: 'Isolated review only' };
    const query = { ...read, rulesVersion: 'all-approved', includeSource: true };
    expect((await request('manual-note', { ...note, washId: 'another-workers-wash' }, tokens.admin)).statusCode).toBe(412);
    const first = await request('manual-note', note, tokens.admin);
    expect(first.statusCode).toBe(200); expect(first.body.result.revision).toBe(1);
    expect((await request('manual-note', note, tokens.admin)).body.result.unchanged).toBe(true);
    expect((await request('manual-note', { ...note, revision: 1, requestId: 'duplicate-demo' }, tokens.admin)).statusCode).toBe(409);
    let got = await request('read', query, tokens.admin);
    expect(got.body.result.manual.notes[0]).toMatchObject({ washId: note.washId, stages: ['arrival', 'start'], source: 'admin-manual' });
    expect(got.body.result.manual.component.points).toBeNull();
    const confirmation = { ...scope, revision: 1, requestId: 'manual-demo-confirm', cohortHash: got.body.result.manual.cohortHash, acknowledged: true, noCases: false };
    expect((await request('manual-confirm', confirmation, tokens.admin)).statusCode).toBe(200);
    got = await request('read', query, tokens.admin);
    expect(got.body.result.manual.component).toMatchObject({ n: 1, affected: 1, points: 0 });
    expect((await request('manual-correct', { ...note, stages: [], revision: 2, requestId: 'manual-demo-correct', correctionReason: 'Verified isolated correction' }, tokens.admin)).statusCode).toBe(200);
    got = await request('read', query, tokens.admin);
    expect(got.body.result.manual.component.points).toBeNull();
    expect(got.body.result.manual.history).toHaveLength(3);
    expect((await request('manual-confirm', { ...confirmation, revision: 3, requestId: 'manual-demo-zero', noCases: true }, tokens.admin)).statusCode).toBe(200);
    expect((await request('read', query, tokens.admin)).body.result.manual.component.points).toBe(10);
    expect((await db.collection(QUALITY_COLLECTION).doc(qualityReportId(v3())).get()).data()).toEqual(old);
    expect((await db.collection('washes').doc('quality-demo-wash').get()).data().status).toBe('completed');
  });
  it('re-reads revoked role even with the same previously valid admin token', async () => {
    await db.collection('users').doc(users.admin).update({ role: 'partner' });
    expect((await request('read', read, tokens.admin)).statusCode).toBe(403);
    expect((await request('save', { reports: [report()] }, tokens.admin)).statusCode).toBe(403);
    expect((await request('manual-note', {}, tokens.admin)).statusCode).toBe(403);
    await db.collection('users').doc(users.admin).update({ role: 'admin' });
  });
});
