// ═══════════════════════════════════════════════════════════════════════════
// المطالبة بأول مدير — كسر الحلقة المسدودة، مرةً واحدة إلى الأبد
// ═══════════════════════════════════════════════════════════════════════════
// Signing in is not membership. The rules read it from a document:
//
//     isMember()  =  exists(users/<uid>)  ||  exists(app_admins/<uid>)
//
// An account created in the Auth console has neither, so every read is refused
// — and it cannot fix itself, by design: creating `users/{uid}` needs
// `isAdmin()`, `isAdmin()` needs one of those two documents, and `app_admins`
// is closed to every client because privilege escalation would otherwise be
// one browser write away.
//
// That deadlock is correct on an installed system and useless on an empty one.
// A fresh project has no admin, so nobody can make one, so the app is bricked
// until someone runs a script with a service-account key — which is a real
// obstacle for the person whose app it is.
//
// So: a FIRST-RUN claim. The very first authenticated caller may take the
// admin role, and only while the directory is COMPLETELY empty — no `users`
// document, no `app_admins` document. The moment one exists, this refuses
// forever and the ordinary rules take over.
//
// ── حدود ما يفتحه هذا، مقولةً صراحةً ──
// Between the day this is deployed and the first claim, anyone who can obtain
// an authenticated account in the project could claim it. That window is the
// price of a self-service bootstrap, it is the same trade every self-hosted
// tool makes (Grafana, Jenkins, Sonarr), and it closes the instant the owner
// clicks the button. `scripts/bootstrap-admin.mjs` remains the zero-window
// alternative for anyone who prefers a service-account key.
// ═══════════════════════════════════════════════════════════════════════════

const COL = {
  USERS: 'users',
  ADMINS: 'app_admins',
  AUDIT: 'audit_logs',
};

/** A refusal the caller is meant to read, not a bug. */
export class BootstrapError extends Error {
  constructor(message, { code = 'failed-precondition' } = {}) {
    super(message);
    this.name = 'BootstrapError';
    this.code = code;
  }
}

/**
 * Is this installation still unclaimed?
 *
 * Read transactionally by the claim itself; exported so a caller can ask
 * WITHOUT claiming — the app uses it to decide whether to offer the button at
 * all, rather than offering one that will fail.
 */
export async function directoryIsEmpty(db, tx = null) {
  const users = db.collection(COL.USERS).limit(1);
  const admins = db.collection(COL.ADMINS).limit(1);
  const [u, a] = tx
    ? await Promise.all([tx.get(users), tx.get(admins)])
    : await Promise.all([users.get(), admins.get()]);
  return u.empty && a.empty;
}

/**
 * Claims the admin role for the calling account — once, on an empty directory.
 *
 * Everything is inside one transaction, and the emptiness check is a
 * TRANSACTIONAL QUERY: Firestore counts it in the read set, so two people
 * clicking at the same moment cannot both succeed — the second aborts, retries,
 * sees the first's document and is refused.
 *
 * `uid` and `email` come from the verified token at the callable boundary and
 * are never read from the payload.
 */
export async function claimFirstAdmin(db, FieldValue, { uid, email = null } = {}, {
  onBeforeCommit = null,
} = {}) {
  const id = String(uid ?? '').trim();
  if (!id) throw new BootstrapError('تسجيل الدخول مطلوب.', { code: 'unauthenticated' });

  return db.runTransaction(async (tx) => {
    const empty = await directoryIsEmpty(db, tx);
    if (onBeforeCommit) await onBeforeCommit();
    if (!empty) {
      throw new BootstrapError(
        'النظام مُهيَّأ بالفعل — يوجد مستخدم مسجَّل، فلا يمكن المطالبة بدور المدير من هنا. '
        + 'اطلب من المدير الحالي إضافة حسابك، أو استخدم سكربت التهيئة باعتماد إداري.',
        { code: 'already-exists' },
      );
    }

    tx.set(db.collection(COL.USERS).doc(id), {
      email: email ? String(email).trim().toLowerCase() : null,
      role: 'admin',
      bootstrappedAt: FieldValue.serverTimestamp(),
      bootstrappedBy: 'first-run-claim',
    });
    // `app_admins` is the belt: `isAdmin()` accepts either, so an admin whose
    // `users` document is later edited by hand still gets in.
    tx.set(db.collection(COL.ADMINS).doc(id), {
      email: email ? String(email).trim().toLowerCase() : null,
      bootstrappedAt: FieldValue.serverTimestamp(),
    });
    tx.set(db.collection(COL.AUDIT).doc(), {
      action: 'bootstrap-first-admin',
      collectionName: COL.USERS,
      documentId: id,
      userId: id,
      before: { users: 0, appAdmins: 0 },
      after: { role: 'admin', email: email || null },
      note: 'المطالبة بأول مدير على نظام فارغ — هذا الباب يُغلق بعدها إلى الأبد',
      at: FieldValue.serverTimestamp(),
      atIso: new Date().toISOString(),
    });
    return { uid: id, role: 'admin', claimed: true };
  });
}
