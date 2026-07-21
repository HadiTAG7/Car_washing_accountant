// ═══════════════════════════════════════════════════════════════════════════
// Firebase client — the app's backend (Firestore + Auth + Storage).
//
// Reads VITE_FIREBASE_* from the Vite env. If any required var is missing we
// export nulls and flag `isFirebaseConfigured=false` so the app renders an
// explicit setup screen instead of calling a nonexistent backend (demo mode).
//
// The apiKey here is a PUBLIC client identifier, not a secret — access is
// enforced by Firestore/Storage security rules, not by hiding the key.
// ═══════════════════════════════════════════════════════════════════════════

import { initializeApp, getApps, getApp, deleteApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import {
  getAuth, createUserWithEmailAndPassword, signOut as fbSignOut,
} from 'firebase/auth';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import {
  collection, query, where, getDocs, doc, setDoc, serverTimestamp,
} from 'firebase/firestore';

function readEnv(name) {
  const raw = import.meta.env[name];
  return raw == null ? '' : String(raw).trim();
}

export const firebaseConfig = {
  apiKey:            readEnv('VITE_FIREBASE_API_KEY'),
  authDomain:        readEnv('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId:         readEnv('VITE_FIREBASE_PROJECT_ID'),
  storageBucket:     readEnv('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: readEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId:             readEnv('VITE_FIREBASE_APP_ID'),
};

const REQUIRED = ['apiKey', 'authDomain', 'projectId', 'appId'];
export const missingEnvNames = REQUIRED
  .filter((k) => !firebaseConfig[k])
  .map((k) => `VITE_FIREBASE_${k.replace(/([A-Z])/g, '_$1').toUpperCase()}`);

export const isFirebaseConfigured = missingEnvNames.length === 0;

// SECURE BY DEFAULT: auth required unless VITE_REQUIRE_AUTH=false.
export const requireAuth =
  String(import.meta.env.VITE_REQUIRE_AUTH || '').trim() !== 'false';

export const app = isFirebaseConfigured
  ? (getApps().length ? getApp() : initializeApp(firebaseConfig))
  : null;
export const db      = app ? getFirestore(app) : null;
export const auth    = app ? getAuth(app) : null;
export const storage = app ? getStorage(app) : null;

export function maskedProjectRef() {
  return firebaseConfig.projectId || '';
}

// ── Arabic error mapping (Firestore / Storage / Auth codes) ──────────────
export function describeBackendError(error) {
  if (!error) return '';
  const raw  = error.message || String(error);
  const code = String(error.code || '').toLowerCase();
  const tail = raw ? ` — ${raw}` : '';
  if (code.includes('permission-denied') || code.includes('unauthorized')) {
    return 'تم رفض الطلب بواسطة قواعد الأمان — تأكد من صلاحيات حسابك.' + tail;
  }
  if (code.includes('unavailable') || raw.toLowerCase().includes('failed to fetch') || raw.toLowerCase().includes('network')) {
    return 'تعذّر الاتصال بـ Firebase — تحقق من اتصالك بالإنترنت ثم أعد المحاولة.' + tail;
  }
  if (code.includes('not-found')) {
    return 'العنصر المطلوب غير موجود.' + tail;
  }
  if (code.includes('already-exists')) {
    return 'هذا السجل موجود مسبقاً.' + tail;
  }
  if (code.includes('unauthenticated')) {
    return 'انتهت الجلسة — أعد تسجيل الدخول.' + tail;
  }
  return raw;
}

// Loose email validator — one '@', dot in the domain.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidEmail(value) {
  return EMAIL_RE.test(String(value || '').trim());
}

/**
 * Resolve a user's uid from their email via the `users` directory
 * collection (doc id = uid, fields { email, role }). Every account the
 * app provisions is recorded there, so this replaces Supabase's
 * `get_user_id_by_email` RPC. Returns the uid or null.
 */
export async function lookupUserIdByEmail(email) {
  if (!isFirebaseConfigured) return null;
  const trimmed = String(email || '').trim().toLowerCase();
  if (!trimmed) return null;
  const snap = await getDocs(
    query(collection(db, 'users'), where('email', '==', trimmed)),
  );
  return snap.empty ? null : snap.docs[0].id;
}

// 20-char password mixing classes, avoiding look-alikes (I/l/O/0).
function generateStrongPassword(length = 20) {
  const upper = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%^&*';
  const all = upper + lower + digits + symbols;
  const bytes = new Uint8Array(length);
  (globalThis.crypto || window.crypto).getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) out += all[bytes[i] % all.length];
  const pick = (set, idx) => set[bytes[idx] % set.length];
  return pick(upper, 0) + pick(lower, 1) + pick(digits, 2) + pick(symbols, 3) + out.slice(4);
}

/**
 * Provision a brand-new partner account WITHOUT disturbing the admin's
 * session. Firebase's createUserWithEmailAndPassword signs the caller in
 * as the new user on the primary auth instance — so we run it on an
 * isolated secondary app that we delete immediately after, leaving the
 * admin's session untouched. The new uid is recorded in `users` so it
 * can later be resolved by email.
 *
 * Firebase email/password signup needs no email confirmation, so
 * `emailConfirmRequired` is always false (kept for API parity with the
 * modals that consume it).
 */
export async function createPartnerUser(email) {
  if (!isFirebaseConfigured) {
    throw new Error('Firebase غير مُهيّأ — لا يمكن إنشاء حسابات في وضع العرض التجريبي.');
  }
  const trimmed = String(email || '').trim().toLowerCase();
  if (!trimmed) throw new Error('البريد الإلكتروني مطلوب.');

  const secondary = initializeApp(firebaseConfig, `provisioner-${Date.now()}`);
  try {
    const secondaryAuth = getAuth(secondary);
    const password = generateStrongPassword(20);
    const cred = await createUserWithEmailAndPassword(secondaryAuth, trimmed, password);
    const uid = cred.user.uid;
    // Record in the directory so email→uid lookups resolve it later.
    await setDoc(doc(db, 'users', uid), {
      email: trimmed, role: 'partner', created_at: serverTimestamp(),
    });
    await fbSignOut(secondaryAuth).catch(() => {});
    return { userId: uid, password, emailConfirmRequired: false };
  } finally {
    await deleteApp(secondary).catch(() => {});
  }
}

// ── Invoice/receipt upload → Firebase Storage ────────────────────────────
const INVOICE_MAX_BYTES = 10 * 1024 * 1024;
function isAllowedInvoiceType(file) {
  const t = String(file?.type || '');
  return t.startsWith('image/') || t === 'application/pdf';
}

/**
 * Upload an invoice/receipt to Storage under `invoices/<folder>/...` and
 * return its download URL (stored in *_entries.invoice_url). Client-side
 * type/size pre-checks mirror the Storage rules for a friendly message.
 * The key carries a timestamp + random UUID slice so same-name uploads
 * in the same millisecond can't collide.
 */
export async function uploadInvoiceFile(file, folder = 'misc') {
  if (!isFirebaseConfigured) {
    throw new Error('Firebase غير مُهيّأ — لا يمكن رفع الملفات في وضع العرض التجريبي.');
  }
  if (!file) throw new Error('لا يوجد ملف.');
  if (!isAllowedInvoiceType(file)) {
    throw new Error('نوع الملف غير مدعوم — يُقبل فقط صور الفواتير (JPG/PNG...) أو ملفات PDF.');
  }
  if (file.size > INVOICE_MAX_BYTES) {
    throw new Error('حجم الملف يتجاوز الحد الأقصى المسموح (10 ميجابايت).');
  }
  const safeName = String(file.name || 'file').replace(/[^\w.-]/g, '_').slice(-60);
  const rand = (globalThis.crypto || window.crypto).randomUUID().slice(0, 8);
  const stamp = `${Date.now().toString(36)}-${rand}`;
  const objectRef = ref(storage, `invoices/${folder}/${stamp}-${safeName}`);
  await uploadBytes(objectRef, file, { contentType: file.type });
  return getDownloadURL(objectRef);
}
