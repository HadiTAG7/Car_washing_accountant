/**
 * المطالبة بأول مدير — باب يُفتح مرة ويُغلق إلى الأبد
 * ═══════════════════════════════════════════════════════════════════════════
 * The rules make membership a document, and they refuse an account that has
 * none. Correct on an installed system, and a brick wall on a fresh one:
 *
 *   • creating `users/{uid}` needs `isAdmin()`;
 *   • `isAdmin()` needs `users/<uid>` or `app_admins/<uid>`;
 *   • `app_admins` is `allow write: if false` for every client.
 *
 * So a brand-new project has no admin, nobody can make one, and the app is
 * unusable until someone runs a script with a service-account key. This is the
 * escape hatch, and what matters is that it is exactly ONE escape: it works
 * only while the directory is completely empty, and the emptiness test is a
 * TRANSACTIONAL query so two simultaneous clicks cannot both succeed.
 *
 * Run: npm run test:functions
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { claimFirstAdmin, directoryIsEmpty, BootstrapError } from '../src/bootstrapAdmin.js';

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const d = EMU ? describe : describe.skip;

let app, db;

async function wipe() {
  for (const c of ['users', 'app_admins', 'audit_logs']) {
    const snap = await db.collection(c).get();
    await Promise.all(snap.docs.map((s) => s.ref.delete()));
  }
}
const userDoc = async (uid) => (await db.collection('users').doc(uid).get()).data();
const adminDoc = async (uid) => (await db.collection('app_admins').doc(uid).get()).exists;
const audits = async () => (await db.collection('audit_logs')
  .where('action', '==', 'bootstrap-first-admin').get()).docs.map((x) => x.data());

/** Fires its body once, however many times the transaction retries. */
function once(fn) {
  let done = false; let runs = 0;
  const wrapped = async () => {
    runs += 1;
    if (done) return;
    done = true;
    await fn();
  };
  wrapped.runs = () => runs;
  return wrapped;
}

d('المطالبة بأول مدير', () => {
  beforeAll(async () => {
    app = initializeApp({ projectId: 'demo-sweater-bootstrap' }, 'bootstrap-test');
    db = getFirestore(app);
  }, 60_000);
  afterAll(async () => { if (app) await deleteApp(app); });
  beforeEach(async () => { await wipe(); }, 60_000);

  it('نظام فارغ: أول متصل يصير مديراً، ويُكتب المستندان وسجل التدقيق', async () => {
    expect(await directoryIsEmpty(db)).toBe(true);

    const res = await claimFirstAdmin(db, FieldValue, { uid: 'u1', email: 'Owner@Example.COM ' });
    expect(res).toMatchObject({ uid: 'u1', role: 'admin', claimed: true });

    expect(await userDoc('u1')).toMatchObject({ role: 'admin', email: 'owner@example.com' });
    expect(await adminDoc('u1')).toBe(true);
    const [rec] = await audits();
    expect(rec).toMatchObject({ userId: 'u1', documentId: 'u1' });
    expect(rec.before).toMatchObject({ users: 0, appAdmins: 0 });
    expect(rec.after).toMatchObject({ role: 'admin' });
  }, 60_000);

  it('وبعدها يُغلق الباب: أي مطالبة ثانية تُرفض', async () => {
    await claimFirstAdmin(db, FieldValue, { uid: 'u1', email: 'a@x.com' });
    expect(await directoryIsEmpty(db)).toBe(false);

    await expect(claimFirstAdmin(db, FieldValue, { uid: 'attacker', email: 'b@x.com' }))
      .rejects.toThrow(/مُهيَّأ بالفعل/);
    // …ولا حتى من نفس الحساب.
    await expect(claimFirstAdmin(db, FieldValue, { uid: 'u1', email: 'a@x.com' }))
      .rejects.toThrow(/مُهيَّأ بالفعل/);

    expect((await db.collection('users').get()).size).toBe(1);
    expect(await audits()).toHaveLength(1);
  }, 60_000);

  it('ووجود مستخدم واحد — بأي دور — يكفي لإغلاقه', async () => {
    // An install provisioned by the script, or one that already has staff:
    // the door was never open for a stranger to walk through.
    await db.collection('users').doc('someone').set({ email: 's@x.com', role: 'operator' });
    expect(await directoryIsEmpty(db)).toBe(false);
    await expect(claimFirstAdmin(db, FieldValue, { uid: 'stranger', email: 'z@x.com' }))
      .rejects.toThrow(/مُهيَّأ بالفعل/);
    expect((await db.collection('app_admins').get()).size).toBe(0);
  }, 60_000);

  it('و`app_admins` وحدها تكفي لإغلاقه كذلك', async () => {
    await db.collection('app_admins').doc('boss').set({ email: 'b@x.com' });
    expect(await directoryIsEmpty(db)).toBe(false);
    await expect(claimFirstAdmin(db, FieldValue, { uid: 'stranger' }))
      .rejects.toThrow(/مُهيَّأ بالفعل/);
  }, 60_000);

  it('ونقرتان متزامنتان تعطيان مديراً واحداً لا اثنين', async () => {
    // The emptiness test is a TRANSACTIONAL query, so it is in the read set:
    // a document appearing between the read and the commit aborts the
    // transaction, and the retry sees it and refuses.
    const race = once(() => db.collection('users').doc('faster').set({
      email: 'f@x.com', role: 'admin',
    }));
    await expect(claimFirstAdmin(db, FieldValue, { uid: 'slower' }, { onBeforeCommit: race }))
      .rejects.toThrow(/مُهيَّأ بالفعل/);

    expect(race.runs()).toBeGreaterThan(1);
    expect((await db.collection('users').get()).docs.map((x) => x.id)).toEqual(['faster']);
    expect(await audits()).toHaveLength(0);
  }, 90_000);

  it('وبالتوازي الحقيقي: واحدة تنجح والأخرى تُرفض', async () => {
    const results = await Promise.allSettled([
      claimFirstAdmin(db, FieldValue, { uid: 'a', email: 'a@x.com' }),
      claimFirstAdmin(db, FieldValue, { uid: 'b', email: 'b@x.com' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect((await db.collection('users').get()).size).toBe(1);
    expect(await audits()).toHaveLength(1);
  }, 90_000);

  it('وبلا هوية لا مطالبة', async () => {
    await expect(claimFirstAdmin(db, FieldValue, {})).rejects.toThrow(/تسجيل الدخول مطلوب/);
    await expect(claimFirstAdmin(db, FieldValue, { uid: '  ' })).rejects.toThrow(/تسجيل الدخول مطلوب/);
    expect((await db.collection('users').get()).size).toBe(0);
  }, 60_000);

  it('والرفض من نوع يقرأه المستدعي', () => {
    expect(new BootstrapError('x').code).toBe('failed-precondition');
    expect(new BootstrapError('x', { code: 'already-exists' }).code).toBe('already-exists');
  });
});
