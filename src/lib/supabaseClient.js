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
 * Provision a brand-new Supabase auth user (pre-verified) via the
 * `create-partner-user` Edge Function, which holds the service_role
 * key server-side. The admin's session is untouched — only a new row
 * appears in auth.users.
 *
 * Returns the new user's UUID on success. Throws on:
 *   - demo mode (Supabase not configured)
 *   - missing JWT (function returns 401)
 *   - email already registered (function returns 409) — caller should
 *     fall back to the lookup path
 *   - any other provisioning error
 */
export async function createPartnerUser(email) {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase غير مُهيّأ — لا يمكن إنشاء حسابات في وضع العرض التجريبي.');
  }
  const trimmed = String(email || '').trim().toLowerCase();
  if (!trimmed) throw new Error('البريد الإلكتروني مطلوب.');

  const { data, error } = await supabase.functions.invoke('create-partner-user', {
    body: { email: trimmed },
  });
  if (error) {
    // supabase-js wraps non-2xx as FunctionsHttpError; the function's
    // JSON body is on error.context (when available). Surface the
    // server's Arabic-friendly message when we can read it.
    let serverMsg = null;
    try {
      const ctx = error.context;
      if (ctx && typeof ctx.json === 'function') {
        const j = await ctx.json();
        serverMsg = j?.error;
      }
    } catch { /* ignore */ }
    console.error('🔥 Real Supabase Error (functions.create-partner-user):', error, 'email:', trimmed);
    const msg = serverMsg || error.message || 'تعذّر إنشاء الحساب.';
    const wrapped = new Error(msg);
    wrapped.original = error;
    throw wrapped;
  }
  if (!data?.user_id) {
    throw new Error('Edge function did not return a user_id');
  }
  return data.user_id;
}
