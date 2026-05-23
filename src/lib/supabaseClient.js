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
