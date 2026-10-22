// ═══════════════════════════════════════════════════════════════════════════
// مصدر البيانات: Firebase (الافتراضي) أو Supabase — نفس الدوال للأدوات
// ═══════════════════════════════════════════════════════════════════════════
// SWEATER_DATA_SOURCE=supabase يحمّل طبقة الموقع نفسها على Supabase
// (src/lib/data/supabase): نفس الدخول بحساب حقيقي، ونفس RLS، ونفس شكل
// المستندات. لا مفتاح خدمة هنا أيضاً.
//   SWEATER_SUPABASE_URL       https://<ref>.supabase.co
//   SWEATER_SUPABASE_ANON_KEY  المفتاح العام (مثل إعداد Firebase العام)
// ═══════════════════════════════════════════════════════════════════════════
const onSupabase = String(process.env.SWEATER_DATA_SOURCE ?? '').trim() === 'supabase';

async function load() {
  if (!onSupabase) {
    const [app, auth, firestore, functions] = await Promise.all([
      import('firebase/app'), import('firebase/auth'), import('firebase/firestore'), import('firebase/functions'),
    ]);
    return { app, auth, firestore, functions };
  }
  const url = String(process.env.SWEATER_SUPABASE_URL ?? '').trim();
  const anon = String(process.env.SWEATER_SUPABASE_ANON_KEY ?? '').trim();
  // The layer reads its project from these at import time.
  if (url) process.env.VITE_SUPABASE_URL = url;
  if (anon) process.env.VITE_SUPABASE_ANON_KEY = anon;
  // Literal paths, so a deployment's file tracer bundles them.
  const [app, auth, firestore, functions, client, { createClient }] = await Promise.all([
    import('../../src/lib/data/supabase/app.js'), import('../../src/lib/data/supabase/auth.js'),
    import('../../src/lib/data/supabase/firestore.js'), import('../../src/lib/data/supabase/functions.js'),
    import('../../src/lib/data/supabase/client.js'), import('@supabase/supabase-js'),
  ]);
  // A process, not a browser tab: the session lives in memory and refreshes itself.
  if (url && anon) client.__setSupabaseClient(createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: true } }));
  // One client for the session and the reads: a named app would get an
  // isolated sign-in (the layer keeps those for creating other accounts).
  return { app: { ...app, initializeApp: options => app.initializeApp(options) }, auth, firestore, functions };
}

export const dataSource = onSupabase ? 'supabase' : 'firebase';
export const sdk = await load();
