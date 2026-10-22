// ═══════════════════════════════════════════════════════════════════════════
// عميل Supabase الوحيد في المتصفح — كل قراءة وكتابة ودخول وملف يمر منه
// ═══════════════════════════════════════════════════════════════════════════
// المفتاح هنا هو المفتاح العام (anon / publishable) — مثل إعدادات Firebase
// العامة، مكانه المتصفح بطبيعته، والحماية في RLS. مفتاح service_role لا يدخل
// هذا الملف ولا أي ملف في الموقع أبداً.
// ═══════════════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js';

const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
const read = name => env[name] ?? globalThis.process?.env?.[name];

export const SUPABASE_URL = read('VITE_SUPABASE_URL') || '';
export const SUPABASE_ANON_KEY = read('VITE_SUPABASE_ANON_KEY') || '';
export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let client = null;
export function getSupabase() {
  if (!client) {
    if (!isSupabaseConfigured) throw new Error('VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY غير مضبوطين.');
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
  }
  return client;
}

/** A second client that never touches the signed-in session (creating another account). */
export function isolatedClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

/** Tests: point the module at a given client. */
export function __setSupabaseClient(c) { client = c; }
