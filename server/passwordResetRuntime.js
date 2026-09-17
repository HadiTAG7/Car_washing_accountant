// تطبيق Admin مستقلّ لمسار إعادة التعيين.
//
// اسمٌ خاص به لا التطبيق الافتراضي: `api/ledger.js` يحجز الافتراضي، ومسار
// إعادة التعيين قد يُنشر وحده أو يُختبر وحده. نسخةٌ باسمها تمنع تصادم
// التهيئة على نسخة Vercel الدافئة.

import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const APP_NAME = 'password-reset-vercel';

const usingEmulators = () => Boolean(
  process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST,
);

function serviceAccount() {
  const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT ?? '').trim();
  if (!raw) throw new Error('password-reset-service-account-missing');
  try { return JSON.parse(raw); }
  catch { throw new Error('password-reset-service-account-invalid'); }
}

export function getPasswordResetRuntime() {
  let app = getApps().find((candidate) => candidate.name === APP_NAME);
  if (!app) {
    app = initializeApp(usingEmulators()
      ? { projectId: process.env.GCLOUD_PROJECT || 'demo-sweater' }
      : { credential: cert(serviceAccount()) }, APP_NAME);
  }
  return { auth: getAuth(app), db: getFirestore(app), FieldValue };
}
