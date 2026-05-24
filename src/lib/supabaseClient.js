// ═══════════════════════════════════════════════════════════════════════════
// Supabase client
//
// Reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from the Vite env. Env
// values are trimmed (defensive against trailing whitespace/newlines from
// .env files or CI dashboards) and the URL is validated for shape — common
// causes of "TypeError: Failed to fetch" are whitespace in the value or a
// project ref that doesn't resolve.
//
// If either variable is missing we export `supabase=null` and flag
// `isSupabaseConfigured=false` so the app can render an explicit setup
// screen instead of silently calling a nonexistent host.
// ═══════════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js';

function readEnv(name) {
  const raw = import.meta.env[name];
  return raw == null ? '' : String(raw).trim();
}

const rawUrl     = readEnv('VITE_SUPABASE_URL');
const rawAnonKey = readEnv('VITE_SUPABASE_ANON_KEY');

// Strip a trailing slash so any path concatenation downstream is clean.
export const supabaseUrl     = rawUrl.replace(/\/+$/, '');
export const supabaseAnonKey = rawAnonKey;

export const missingEnv = {
  url:     supabaseUrl.length === 0,
  anonKey: supabaseAnonKey.length === 0,
};
export const missingEnvNames = [
  missingEnv.url     && 'VITE_SUPABASE_URL',
  missingEnv.anonKey && 'VITE_SUPABASE_ANON_KEY',
].filter(Boolean);

export const isSupabaseConfigured = missingEnvNames.length === 0;

// Best-effort URL shape check — accepts the standard *.supabase.co/.in hosts
// and any explicit http(s) URL (self-hosted Supabase). Only used to print a
// diagnostic warning; we still attempt the connection.
export const urlLooksValid =
  isSupabaseConfigured && /^https?:\/\/[^\s]+$/i.test(supabaseUrl);

export const requireAuth =
  String(import.meta.env.VITE_REQUIRE_AUTH || '').trim() === 'true';

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

// Mask the URL for display in the UI / logs (keeps protocol + project ref
// visible but hides nothing sensitive — Supabase URLs are public anyway).
export function maskedSupabaseUrl() {
  if (!supabaseUrl) return '';
  return supabaseUrl;
}

// Translate raw fetch / Supabase errors into an actionable Arabic hint so
// the UI banner can give users something to act on rather than just
// "Failed to fetch". The original message is always appended so the
// developer can see exactly which column / constraint the DB complained
// about — earlier versions masked it entirely, which made schema-cache
// bugs nearly impossible to diagnose from the UI alone.
export function describeSupabaseError(error) {
  if (!error) return '';
  const raw = error.message || error.error_description || String(error);
  const msg = raw.toLowerCase();
  const tail = raw ? ` — ${raw}` : '';
  if (msg.includes('failed to fetch') || msg.includes('networkerror')) {
    return (
      'تعذّر الاتصال بـ Supabase. تحقّق من قيمة VITE_SUPABASE_URL ' +
      '(يجب أن تبدأ بـ https:// وتنتهي بـ .supabase.co بدون مسافات أو علامات اقتباس)، ' +
      'ومن أن المشروع نشط، وأن المتصفح غير محجوب من الوصول للنطاق.' + tail
    );
  }
  if (msg.includes('invalid api key') || msg.includes('jwt')) {
    return 'قيمة VITE_SUPABASE_ANON_KEY غير صحيحة أو منتهية الصلاحية. أعد نسخها من إعدادات Supabase API.' + tail;
  }
  if (msg.includes('schema cache') || msg.includes("could not find the")) {
    // Try to surface the specific column / table the cache is missing so
    // the user knows exactly what to migrate.
    const colMatch = raw.match(/['"`]([^'"`]+)['"`]\s*column/i) || raw.match(/column\s+['"`]?([^'"`\s]+)/i);
    const which = colMatch ? colMatch[1] : null;
    return (
      'ذاكرة مخطط Supabase لا تجد عموداً مطلوباً' +
      (which ? ` ("${which}")` : '') + '. ' +
      'افتح Supabase → SQL Editor ونفّذ ملف الـ migration الموجود في ' +
      'supabase/migrations/ ثم: notify pgrst, \'reload schema\';' + tail
    );
  }
  if (msg.includes('row-level security') || msg.includes('permission denied') || msg.includes('rls')) {
    return 'تم رفض الطلب بواسطة سياسات RLS. تأكد من تطبيق سياسات الصلاحيات الموجودة في schema.sql.' + tail;
  }
  if (msg.includes('duplicate key') || msg.includes('unique constraint')) {
    return 'هذا السجل موجود مسبقاً (تكرار في المفتاح الفريد).' + tail;
  }
  if (msg.includes('violates check constraint')) {
    return 'القيمة المُرسلة لا تستوفي أحد القيود (check constraint) في قاعدة البيانات.' + tail;
  }
  return raw;
}

if (typeof window !== 'undefined') {
  if (!isSupabaseConfigured) {
    console.error(
      `[supabase] Missing env variable(s): ${missingEnvNames.join(', ')}. ` +
      'Add them to .env.local (then restart `npm run dev`) or to your ' +
      'Vercel project Environment Variables.',
    );
  } else if (!urlLooksValid) {
    console.warn(
      `[supabase] VITE_SUPABASE_URL "${supabaseUrl}" does not look like a valid URL. ` +
      'Expected format: https://your-project-ref.supabase.co (no quotes, no trailing whitespace).',
    );
  } else {
    console.info(`[supabase] Connected to ${supabaseUrl}`);
  }
}

// Loose email validator — one '@', dot in the domain. Matches what
// browsers accept for type="email" and keeps the modal in sync with
// what the RPC will actually resolve. Empty input is treated as
// "not provided", NOT "invalid".
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidEmail(value) {
  return EMAIL_RE.test(String(value || '').trim());
}

/**
 * Resolve a Supabase auth user's id from their email via the
 * `get_user_id_by_email` RPC. Returns:
 *   - the matched UUID string when the email exists in auth.users
 *   - `null` when no user matches OR when Supabase isn't configured
 *     (demo mode — the caller decides whether to treat that as "skip"
 *     or "not registered").
 *
 * Throws the raw Supabase error when the RPC itself fails so the
 * calling modal can surface a real diagnostic rather than a vague
 * "not registered" message.
 */
export async function lookupUserIdByEmail(email) {
  if (!isSupabaseConfigured) return null;
  const trimmed = String(email || '').trim();
  if (!trimmed) return null;
  const { data, error } = await supabase.rpc('get_user_id_by_email', {
    email_search: trimmed,
  });
  if (error) {
    console.error('🔥 Real Supabase Error (rpc.get_user_id_by_email):', error, 'email:', trimmed);
    throw error;
  }
  return data || null;
}

/**
 * Provision a brand-new Supabase auth user via the standard `signUp`
 * API, but on an isolated client instance so the admin's existing
 * session is NOT replaced.
 *
 * Why an isolated client: `auth.signUp` returns a session for the new
 * user, and the SDK normally writes that session into the configured
 * storage (overwriting the admin's session in localStorage). We avoid
 * that by giving this second client a no-op storage adapter +
 * `persistSession: false`, so the signUp's side-effect dies inside
 * the ephemeral runtime and the main `supabase` client keeps the
 * admin logged in.
 *
 * Returns `{ userId, password, emailConfirmRequired }`:
 *   - userId — the new auth.users.id (always present on signUp success)
 *   - password — the random temporary password we generated, so the
 *     calling modal can display it to the admin to relay to the partner
 *   - emailConfirmRequired — `true` when Supabase's project setting
 *     "Confirm email" is on. The partner will need to click the
 *     verification email before they can sign in.
 *
 * Throws on:
 *   - demo mode (no Supabase configured)
 *   - signUp errors (email already registered, rate limit, etc.) —
 *     the caller surfaces the message via the toast helper
 */
let ephemeralAuthClient = null;
function getEphemeralAuthClient() {
  if (!isSupabaseConfigured) return null;
  if (ephemeralAuthClient) return ephemeralAuthClient;
  // No-op storage: anything signUp tries to write goes nowhere. Pair
  // with persistSession:false so the SDK doesn't even attempt to keep
  // the new-user session alive.
  const memoryStorage = {
    getItem:    () => null,
    setItem:    () => {},
    removeItem: () => {},
  };
  ephemeralAuthClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession:    false,
      autoRefreshToken:  false,
      detectSessionInUrl: false,
      storage:           memoryStorage,
      // Distinct storageKey so it can never collide with the main
      // client's key — paranoia, since the no-op storage already
      // prevents any write.
      storageKey:        'sweater:provision:noop',
    },
  });
  return ephemeralAuthClient;
}

// Generates a 20-character password mixing uppercase, lowercase, digits,
// and a few safe symbols. Excludes visually-similar chars (I/l/O/0) so a
// hand-relayed password is less error-prone. Backed by Web Crypto.
function generateStrongPassword(length = 20) {
  const upper   = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  const lower   = 'abcdefghijkmnopqrstuvwxyz';
  const digits  = '23456789';
  const symbols = '!@#$%^&*';
  const all     = upper + lower + digits + symbols;
  const bytes   = new Uint8Array(length);
  (globalThis.crypto || window.crypto).getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) out += all[bytes[i] % all.length];
  // Ensure at least one of each character class so projects with strict
  // password policies don't reject. Replace the first 4 chars with one
  // of each class drawn from the random byte stream.
  const pick = (set, idx) => set[bytes[idx] % set.length];
  return pick(upper, 0) + pick(lower, 1) + pick(digits, 2) + pick(symbols, 3) + out.slice(4);
}

export async function createPartnerUser(email) {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase غير مُهيّأ — لا يمكن إنشاء حسابات في وضع العرض التجريبي.');
  }
  const trimmed = String(email || '').trim().toLowerCase();
  if (!trimmed) throw new Error('البريد الإلكتروني مطلوب.');

  const client = getEphemeralAuthClient();
  const password = generateStrongPassword(20);

  const { data, error } = await client.auth.signUp({
    email:    trimmed,
    password,
  });
  if (error) {
    console.error('🔥 Real Supabase Error (auth.signUp on ephemeral client):', error, 'email:', trimmed);
    throw new Error(error.message || 'تعذّر إنشاء الحساب.');
  }
  if (!data?.user?.id) {
    // Belt-and-braces: signUp can return user=null in obfuscated mode
    // when the email already exists and "Confirm email" is on. Treat
    // that as a soft failure with a clear message.
    throw new Error('تعذّر تحديد معرف الحساب. قد يكون البريد مسجلاً مسبقاً.');
  }

  // session is null when project setting "Confirm email" is enabled —
  // the user exists in auth.users (so we can link them to a partner
  // row) but they can't sign in until they verify via email.
  const emailConfirmRequired = data.session == null;

  return {
    userId: data.user.id,
    password,
    emailConfirmRequired,
  };
}
