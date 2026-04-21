// ═══════════════════════════════════════════════════════════════════════════
// Supabase client
//
// Reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from the Vite env.
// If both are missing we export a `null` client and flag `isConfigured=false`
// so the app falls back to demo data instead of crashing.
// ═══════════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js';

const url      = import.meta.env.VITE_SUPABASE_URL;
const anonKey  = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);
export const requireAuth = import.meta.env.VITE_REQUIRE_AUTH === 'true';

export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

if (!isSupabaseConfigured && typeof window !== 'undefined') {
  console.warn(
    '[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set. ' +
    'Running in DEMO MODE — data will not persist.',
  );
}
