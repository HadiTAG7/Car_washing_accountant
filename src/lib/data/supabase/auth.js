// ═══════════════════════════════════════════════════════════════════════════
// تسجيل الدخول: نفس دوال firebase/auth التي يستعملها الموقع، فوق Supabase Auth
// ═══════════════════════════════════════════════════════════════════════════
// المستخدم يظهر للموقع بنفس الشكل: { uid, email, getIdToken() } — والتوكن هنا
// توكن Supabase، يتحقق منه /api/ledger بمفاتيح المشروع العامة.
//
// استعادة كلمة المرور: رسالة Supabase (عبر SMTP المشروع) تحمل رابطاً إلى
//   /update-password?oobCode={{ .TokenHash }}&email={{ .Email }}
// فتبقى شاشة UpdatePasswordScreen كما هي. الرمز لا يُستهلك عند فتح الصفحة
// (ماسحات الروابط في البريد تفتحها أحياناً) بل عند ضغط «حفظ» فقط.
// ═══════════════════════════════════════════════════════════════════════════
import { getSupabase, isolatedClient } from './client.js';

export class AuthError extends Error {
  constructor(code, message) { super(message); this.code = code; this.name = 'FirebaseError'; }
}
// Messages stay Supabase's own (authErrors.js already translates them); the
// code is set where a caller branches on it.
function toAuthError(error) {
  const msg = error?.message || String(error);
  let code = 'auth/internal-error';
  if (/invalid login credentials/i.test(msg)) code = 'auth/invalid-credential';
  else if (/rate limit|too many/i.test(msg)) code = 'auth/too-many-requests';
  else if (/banned|disabled/i.test(msg)) code = 'auth/user-disabled';
  else if (/expired|invalid.*(otp|token|link)/i.test(msg)) code = 'auth/expired-action-code';
  else if (/already registered|already exists/i.test(msg)) code = 'auth/email-already-in-use';
  else if (/password should|weak password/i.test(msg)) code = 'auth/weak-password';
  return new AuthError(code, msg);
}

function toUser(sbUser, client) {
  if (!sbUser) return null;
  return {
    uid: sbUser.id,
    email: sbUser.email ?? null,
    emailVerified: Boolean(sbUser.email_confirmed_at),
    displayName: sbUser.user_metadata?.display_name ?? null,
    providerData: [],
    metadata: { creationTime: sbUser.created_at, lastSignInTime: sbUser.last_sign_in_at },
    async getIdToken() {
      const { data } = await client.auth.getSession();
      if (!data.session) throw new AuthError('auth/user-token-expired', 'انتهت الجلسة؛ سجّل الدخول من جديد.');
      return data.session.access_token;
    },
  };
}

function makeAuth(client) {
  const auth = { type: 'auth', client, currentUser: null, _ready: null };
  auth._ready = client.auth.getSession().then(({ data }) => { auth.currentUser = toUser(data.session?.user, client); });
  client.auth.onAuthStateChange((_event, session) => { auth.currentUser = toUser(session?.user, client); });
  return auth;
}
let primary = null;
const secondaries = new WeakMap();
export function getAuth(app) {
  if (app && app.name && app.name !== '[DEFAULT]') {
    if (!secondaries.has(app)) secondaries.set(app, makeAuth(isolatedClient()));
    return secondaries.get(app);
  }
  return (primary ||= makeAuth(getSupabase()));
}
export function connectAuthEmulator() { /* not applicable */ }

export function onAuthStateChanged(auth, callback) {
  let last;
  const emit = (user) => {
    const key = user?.uid ?? null;
    if (key === last) return;
    last = key; callback(user);
  };
  auth._ready.then(() => emit(auth.currentUser));
  const { data } = auth.client.auth.onAuthStateChange((event, session) => {
    if (event === 'INITIAL_SESSION') return;
    auth.currentUser = toUser(session?.user, auth.client);
    emit(auth.currentUser);
  });
  return () => data.subscription.unsubscribe();
}

export async function signInWithEmailAndPassword(auth, email, password) {
  const { data, error } = await auth.client.auth.signInWithPassword({ email: String(email).trim(), password });
  if (error) throw toAuthError(error);
  auth.currentUser = toUser(data.user, auth.client);
  return { user: auth.currentUser };
}
export async function signOut(auth) {
  const { error } = await auth.client.auth.signOut();
  if (error && !/session/i.test(error.message)) throw toAuthError(error);
  auth.currentUser = null;
}
export async function createUserWithEmailAndPassword(auth, email, password) {
  const { data, error } = await auth.client.auth.signUp({ email, password });
  if (error) throw toAuthError(error);
  if (!data.user) throw new AuthError('auth/internal-error', 'لم يُنشأ الحساب.');
  return { user: toUser(data.user, auth.client) };
}

export async function sendPasswordResetEmail(auth, email, settings) {
  const origin = settings?.url || (typeof window !== 'undefined' ? window.location.origin : '');
  const { error } = await auth.client.auth.resetPasswordForEmail(String(email).trim(), { redirectTo: `${origin}/update-password` });
  if (error) throw toAuthError(error);
}
/** The link's email, without spending the one-time token. */
export async function verifyPasswordResetCode(_auth, code) {
  const email = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('email') : null;
  if (!code || !email) throw new AuthError('auth/invalid-action-code', 'Email link is invalid or has expired');
  return email;
}
/** Spends the token, sets the password, and leaves the user signed out (as Firebase does). */
export async function confirmPasswordReset(auth, code, newPassword) {
  const { error } = await auth.client.auth.verifyOtp({ token_hash: code, type: 'recovery' });
  if (error) throw toAuthError(error);
  const { error: updateError } = await auth.client.auth.updateUser({ password: newPassword });
  if (updateError) throw toAuthError(updateError);
  await auth.client.auth.signOut().catch(() => {});
  auth.currentUser = null;
}
export async function updatePassword(user, newPassword) {
  const client = getAuth().client;
  const { error } = await client.auth.updateUser({ password: newPassword });
  if (error) throw toAuthError(error);
  return user;
}
