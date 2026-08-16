// ═══════════════════════════════════════════════════════════════════════════
// الباب الثاني إلى الخادم الموثوق — نفس الدماغ، استضافة أخرى
// ═══════════════════════════════════════════════════════════════════════════
// Cloud Functions require the Blaze plan, and a Blaze plan requires a billing
// account that is not available to everyone everywhere. This is the same
// trusted server reachable without one: a plain HTTP endpoint that can live on
// Vercel — where this app's frontend already is — or anywhere Node runs.
//
// It contains NO accounting and NO authorization logic. Both live in
// `functions/src/handlers.js`, which this and `functions/index.js` share. If
// you are looking for who may reverse an entry, it is not here, and that is
// the point: one copy cannot drift from another that does not exist.
//
// ── الأمان مطابق، لا مقارب ──
//   • Identity comes from a Firebase ID token verified with the Admin SDK.
//     `verifyIdToken` checks the signature, the issuer, the audience and the
//     expiry — the same verification Cloud Functions performs before `onCall`
//     ever runs. A forged or expired token cannot pass it.
//   • The ROLE is then re-read from `users/{uid}` server-side by `dispatch`,
//     never taken from the token. Unchanged from the callable path.
//   • The Admin SDK bypasses Firestore rules, which is exactly why this file
//     never touches Firestore directly. Everything goes through `dispatch`.
//
// ── ما يحتاجه للتشغيل ──
//   FIREBASE_SERVICE_ACCOUNT   محتوى مفتاح الخدمة JSON كاملاً
// وعلى Vercel: Settings ← Environment Variables. المفتاح لا يدخل المستودع.
// ═══════════════════════════════════════════════════════════════════════════

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

import { dispatch, HANDLER_NAMES } from '../functions/src/handlers.js';

/**
 * A refusal the operator must be able to tell apart from a bug.
 *
 * A missing key and a wrong key fail at different moments and need different
 * fixes, so they say different things — and neither is «internal error», which
 * would send someone reading application logs for a configuration problem.
 */
function serviceAccount() {
  const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT ?? '').trim();
  if (!raw) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT غير مضبوط. أضِف محتوى ملف مفتاح الخدمة JSON كاملاً '
      + 'في متغيّرات البيئة على المستضيف.',
    );
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT ليس JSON صالحاً — ألصق محتوى الملف كاملاً من { إلى }.',
    );
  }
}

/**
 * Emulators issue their own unsigned tokens and accept any project, so a real
 * service-account key is neither needed nor usable there.
 *
 * The condition is the emulator's own environment variables, which the
 * Firebase tooling sets and which are never present on a deployed host. So
 * this cannot silently disable credentials in production: without those
 * variables the key is still required, and a missing one still refuses.
 *
 * Without this branch, this file would be the one part of the trusted server
 * that could not be tested end to end — and it is about to become the path
 * every posting takes.
 */
const usingEmulators = () => Boolean(
  process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST,
);

let cached = null;
function admin() {
  if (cached) return cached;
  // Serverless reuses a warm instance, so initializing twice is a real
  // possibility rather than a theoretical one.
  const app = getApps().length
    ? getApps()[0]
    : initializeApp(usingEmulators()
      ? { projectId: process.env.GCLOUD_PROJECT || 'demo-sweater' }
      : { credential: cert(serviceAccount()) });
  cached = { db: getFirestore(app), auth: getAuth(app) };
  return cached;
}

/** Test-only: serverless caches a warm app, a suite needs a cold one. */
export function __resetAdmin() {
  cached = null;
}

/** The code vocabulary is the callables'; this maps it to HTTP. */
const STATUS = {
  'unauthenticated': 401,
  'permission-denied': 403,
  'not-found': 404,
  'already-exists': 409,
  'invalid-argument': 400,
  'failed-precondition': 412,
  'internal': 500,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { code: 'invalid-argument', message: 'POST فقط.' } });
  }

  let db;
  let auth;
  try {
    ({ db, auth } = admin());
  } catch (e) {
    // Configuration, not a caller error — 503, and say which variable.
    return res.status(503).json({ error: { code: 'internal', message: e.message } });
  }

  // ── الهوية ──
  // Bearer only. A token in the body or a query string would be logged by
  // every proxy between here and the browser.
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    return res.status(401).json({
      error: { code: 'unauthenticated', message: 'تسجيل الدخول مطلوب.' },
    });
  }

  let decoded;
  try {
    decoded = await auth.verifyIdToken(token);
  } catch {
    return res.status(401).json({
      error: { code: 'unauthenticated', message: 'انتهت الجلسة أو التوكن غير صالح — سجّل الدخول من جديد.' },
    });
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const name = String(body?.name ?? '');
  if (!HANDLER_NAMES.includes(name)) {
    return res.status(404).json({
      error: { code: 'not-found', message: `عملية غير معروفة: ${name || '(بلا اسم)'}` },
    });
  }

  try {
    const result = await dispatch(db, FieldValue, name, body?.data, {
      uid: decoded.uid,
      token: decoded,
    });
    return res.status(200).json({ result });
  } catch (e) {
    return res.status(STATUS[e.code] || 500).json({
      error: { code: e.code || 'internal', message: e.message, details: e.details || null },
    });
  }
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
