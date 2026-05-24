// ═══════════════════════════════════════════════════════════════════════════
// Edge Function: create-partner-user
// ═══════════════════════════════════════════════════════════════════════════
// Provisions a new Supabase auth user on behalf of an admin who's adding
// or editing a partner. Runs in Deno on Supabase's edge runtime so the
// SERVICE_ROLE key never leaves the server.
//
// Flow:
//   1. Caller (the logged-in admin) invokes this function via
//      supabase.functions.invoke('create-partner-user', { body: { email } }).
//      supabase-js automatically attaches the admin's JWT.
//   2. We verify the JWT by hitting auth.getUser() with an anon-key
//      client that's configured to forward the caller's Authorization
//      header. This proves the caller is an authenticated app user;
//      anonymous traffic is rejected with 401.
//   3. A second client — configured with SERVICE_ROLE — calls
//      `auth.admin.createUser({ email, password, email_confirm: true })`.
//      email_confirm=true skips the email verification step so the
//      partner can log in immediately with the temporary password.
//   4. The new user's id is returned. The admin's session is untouched —
//      they keep their original JWT.
//
// Deployment (one-off):
//   supabase functions deploy create-partner-user --no-verify-jwt
//   # --no-verify-jwt: we verify the JWT manually inside the function
//   # so we can give a clean 401 with an Arabic-friendly error body.
//
// Required Edge Function secrets (set automatically by Supabase platform):
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
//   SUPABASE_SERVICE_ROLE_KEY
// ═══════════════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// Permissive CORS for the dashboard origin. Tighten to a specific
// Vercel URL if/when the public origin is locked down.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey     = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) {
    // Misconfigured deployment — never trust a default.
    return json(500, { error: "Edge function is missing required secrets" });
  }

  // ── 1. Authenticate the caller ──────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return json(401, { error: "يجب تسجيل الدخول أولاً قبل إنشاء حسابات." });
  }
  const verifyClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth:   { autoRefreshToken: false, persistSession: false },
  });
  const { data: callerData, error: callerErr } = await verifyClient.auth.getUser();
  if (callerErr || !callerData?.user) {
    return json(401, { error: "الجلسة منتهية أو غير صالحة." });
  }
  const caller = callerData.user;

  // ── 2. Parse + validate input ───────────────────────────────────────────
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) {
    return json(400, { error: "صيغة البريد الإلكتروني غير صحيحة." });
  }
  // Spec-mandated default. Admin can override per-request if needed.
  const password = String(body.password ?? "TemporaryPassword123!");

  // ── 3. Provision the user with the service-role client ─────────────────
  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      created_by_admin: caller.id,
      created_for:      "partner_link",
    },
  });
  if (error) {
    // Most common failure: email already exists. Surface as 409 so the
    // client can decide whether to treat it as "already registered" vs.
    // a real provisioning error.
    const alreadyExists = /already (registered|exists)/i.test(error.message);
    return json(alreadyExists ? 409 : 400, { error: error.message });
  }

  return json(200, {
    user_id: data.user?.id,
    email:   data.user?.email,
  });
});
