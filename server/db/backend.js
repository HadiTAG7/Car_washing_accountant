// ═══════════════════════════════════════════════════════════════════════════
// مصدر البيانات للخادم: DATA_SOURCE=firebase (الافتراضي) أو supabase
// ═══════════════════════════════════════════════════════════════════════════
// كل مسار خادم يبني `{ db, auth, FieldValue }` ثم يمرّرها لنفس الدوال. على
// Supabase تأتي من هنا: `db` هو pgstore (واجهة Firestore فوق Postgres) بالدور
// المحدود ledger_server — لا service_role ولا تجاوز للـRLS — و`auth` يتحقق
// من توكن Supabase ثم من أن الجلسة ما زالت حيّة، كما يفعل
// `verifyIdToken(token, true)` في Firebase.
//
// ── متغيّرات البيئة على Supabase ──
//   DATA_SOURCE=supabase
//   LEDGER_DB_URL         اتصال Postgres بحساب ledger_server (كلمة مروره خارج git)
//   LEDGER_DB_CA          شهادة Supabase الجذرية PEM (اختياري؛ للتحقق الكامل من TLS)
//   SUPABASE_URL          https://<ref>.supabase.co — مُصدِر التوكن ومفاتيحه العامة
//   SUPABASE_JWT_SECRET   فقط إن كان المشروع ما زال يوقّع بـHS256
// ═══════════════════════════════════════════════════════════════════════════

import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';
import { createStore, FieldValue } from './pgstore/index.js';

export const dataSource = (env = process.env) => (String(env.DATA_SOURCE || '').trim() === 'supabase' ? 'supabase' : 'firebase');
export const onSupabase = (env = process.env) => dataSource(env) === 'supabase';

/** Configuration, not a bug: names the variable so whoever owns the host can fix it. */
export class BackendConfigError extends Error {
  constructor(message) { super(message); this.name = 'BackendConfigError'; this.code = 'configuration'; }
}

const required = (env, name) => {
  const v = String(env[name] ?? '').trim();
  if (!v) throw new BackendConfigError(`${name} غير مضبوط — مطلوب مع DATA_SOURCE=supabase.`);
  return v;
};

// ── التحقق من التوكن ──
// المفاتيح العامة (ES256/RS256) من JWKS المشروع؛ وHS256 فقط بسرّ صريح، فلا
// يُقبل توكن متماثل التوقيع على مسار المفاتيح العامة ولا العكس.
const jwksCache = new Map();
export async function verifySupabaseToken(token, env = process.env) {
  const issuer = `${required(env, 'SUPABASE_URL').replace(/\/+$/, '')}/auth/v1`;
  const options = { issuer, audience: 'authenticated' };
  const { alg } = decodeProtectedHeader(token);
  let payload;
  if (alg === 'HS256') {
    const secret = String(env.SUPABASE_JWT_SECRET ?? '');
    if (!secret) throw new Error('hs256-without-secret');
    ({ payload } = await jwtVerify(token, new TextEncoder().encode(secret), { ...options, algorithms: ['HS256'] }));
  } else {
    if (!jwksCache.has(issuer)) jwksCache.set(issuer, createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)));
    ({ payload } = await jwtVerify(token, jwksCache.get(issuer), { ...options, algorithms: ['ES256', 'RS256'] }));
  }
  if (payload.role !== 'authenticated' || typeof payload.sub !== 'string' || !payload.sub) throw new Error('not-a-user-token');
  return payload;
}

/** The `auth` half of a runtime: the same `verifyIdToken(token, checkRevoked)` the handlers call. */
export function supabaseAuth(db, env = process.env) {
  return {
    async verifyIdToken(token, checkRevoked = false) {
      const payload = await verifySupabaseToken(token, env);
      // Signed out, banned, deleted or expired session → refused now, not at
      // the token's expiry; Firebase's checkRevoked does the same.
      if (checkRevoked && !(await db.sessionIsLive(payload.sub, payload.session_id))) throw new Error('session-revoked');
      return { ...payload, uid: payload.sub, email: payload.email ?? null };
    },
    generatePasswordResetLink() {
      throw new BackendConfigError('على Supabase يُرسل رابط إعادة التعيين من Supabase Auth نفسه.');
    },
  };
}

// One pool per warm instance, shared by every route.
let runtime = null;
export function supabaseRuntime(env = process.env) {
  if (runtime) return runtime;
  const connectionString = required(env, 'LEDGER_DB_URL');
  const ca = String(env.LEDGER_DB_CA ?? '').trim();
  // SET LOCAL ROLE on every transaction as well: even a wrongly pasted owner
  // URL runs as the restricted role.
  const db = createStore({ connectionString, role: 'ledger_server', max: 3, ssl: ca ? { ca, rejectUnauthorized: true } : undefined });
  runtime = { db, auth: supabaseAuth(db, env), FieldValue };
  return runtime;
}

/** Test-only: a cold instance. */
export async function __resetSupabaseRuntime() {
  const r = runtime; runtime = null;
  if (r) await r.db.close().catch(() => {});
}
