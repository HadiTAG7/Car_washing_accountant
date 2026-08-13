#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// تهيئة أول مدير — the one step no client can perform
// ═══════════════════════════════════════════════════════════════════════════
// Firebase Auth and this app's user directory are two different things.
// Creating an account in the Auth console makes someone able to SIGN IN; it
// does not make them a member. Membership is a document:
//
//     isMember()  =  exists(users/<uid>)  ||  exists(app_admins/<uid>)
//
// An account with neither is refused EVERY read — while the UI, which never
// consults a role, still renders the full admin sidebar. That combination is
// exactly «I am logged in as the admin and every page says I have no
// permissions».
//
// And it cannot fix itself, by design:
//
//   • `users/{uid}` create requires `isAdmin()`;
//   • `isAdmin()` requires one of those two documents;
//   • `app_admins/{uid}` is `allow write: if false` for every client, because
//     privilege escalation would otherwise be one browser write away.
//
// So the FIRST admin is provisioned out of band, with credentials a browser
// never has. That is this script. It is idempotent: running it again on an
// account that is already an admin changes nothing and says so.
//
//   npm run bootstrap:admin -- <email>
//
// Credentials, in the order the Admin SDK looks for them:
//   • GOOGLE_APPLICATION_CREDENTIALS → a service-account JSON key, or
//   • `gcloud auth application-default login` on this machine.
// And the project id from FIREBASE_PROJECT_ID / GOOGLE_CLOUD_PROJECT, or
// `--project <id>`.
// ═══════════════════════════════════════════════════════════════════════════

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const ROLES = ['admin', 'accountant', 'operator', 'partner'];

function parseArgs(argv) {
  const out = { email: '', role: 'admin', project: '' };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--project') { out.project = argv[i + 1] || ''; i += 1; continue; }
    if (a === '--role') { out.role = argv[i + 1] || 'admin'; i += 1; continue; }
    rest.push(a);
  }
  out.email = (rest[0] || '').trim().toLowerCase();
  return out;
}

function die(message) {
  process.stderr.write(`\n✗ ${message}\n\n`);
  process.exit(1);
}

const { email, role, project } = parseArgs(process.argv.slice(2));

if (!email) {
  die('البريد الإلكتروني مطلوب.\n\n  npm run bootstrap:admin -- admin@example.com\n'
    + '  npm run bootstrap:admin -- someone@example.com --role accountant');
}
if (!ROLES.includes(role)) {
  die(`دور غير معروف: ${role}. المسموح: ${ROLES.join('، ')}.`);
}

const projectId = project
  || process.env.FIREBASE_PROJECT_ID
  || process.env.GOOGLE_CLOUD_PROJECT
  || process.env.GCLOUD_PROJECT;
if (!projectId) {
  die('معرّف المشروع مطلوب — مرّره بـ --project أو اضبط FIREBASE_PROJECT_ID.');
}

let app;
try {
  app = initializeApp({ credential: applicationDefault(), projectId });
} catch (e) {
  die(`تعذّرت المصادقة مع Firebase: ${e.message}\n\n`
    + 'هيّئ اعتماداً إدارياً أولاً:\n'
    + '  export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json\n'
    + '  أو: gcloud auth application-default login');
}

const auth = getAuth(app);
const db = getFirestore(app);

let user;
try {
  user = await auth.getUserByEmail(email);
} catch (e) {
  if (e.code === 'auth/user-not-found') {
    die(`لا يوجد حساب مصادقة بهذا البريد: ${email}\n\n`
      + 'أنشئه أولاً من Firebase Console ← Authentication ← Users، ثم أعد تشغيل هذا الأمر.');
  }
  die(`تعذّر البحث عن الحساب: ${e.message}`);
}

const uid = user.uid;
const userRef = db.collection('users').doc(uid);
const adminRef = db.collection('app_admins').doc(uid);

const [userSnap, adminSnap] = await Promise.all([userRef.get(), adminRef.get()]);
const before = {
  users: userSnap.exists ? (userSnap.data().role || '(بلا دور)') : '(غير موجود)',
  appAdmins: adminSnap.exists ? 'موجود' : '(غير موجود)',
};

await userRef.set({
  email,
  role,
  bootstrappedAt: FieldValue.serverTimestamp(),
}, { merge: true });

// `app_admins` is the belt: `isAdmin()` accepts either, so an admin whose
// `users` document is later edited by hand still gets in. Only written for the
// admin role — an accountant or an operator is not one.
if (role === 'admin') {
  await adminRef.set({ email, bootstrappedAt: FieldValue.serverTimestamp() }, { merge: true });
} else if (adminSnap.exists) {
  // Demoting: the admin marker must go with the role, or the demotion is
  // cosmetic.
  await adminRef.delete();
}

const after = (await userRef.get()).data();
process.stdout.write([
  '',
  '✓ تمّت التهيئة',
  `  البريد        : ${email}`,
  `  المعرّف (uid)  : ${uid}`,
  `  المشروع       : ${projectId}`,
  `  users/<uid>   : ${before.users} ← ${after.role}`,
  `  app_admins    : ${before.appAdmins} ← ${role === 'admin' ? 'موجود' : '(محذوف)'}`,
  '',
  'حدّث الصفحة في المتصفح — القراءات التي كانت تُرفض ستعمل الآن.',
  '',
].join('\n'));

process.exit(0);
