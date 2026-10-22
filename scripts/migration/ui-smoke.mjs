#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// جولة في الموقع على Supabase — كل صفحة، بلا خطأ واحد
// ═══════════════════════════════════════════════════════════════════════════
// يفتح كل صفحة كمدير (ثم صفحات الشريك كشريك) ويسجّل: أخطاء الصفحة، أخطاء
// الطرفية، أي طلب فاشل (‎/api أو Supabase)، أي طلب لـFirebase، وأي بطاقة
// «تعذّر…» ظاهرة. لقطة لكل صفحة.
//
// محلي: يبني الموقع بـVITE_DATA_SOURCE=supabase ويشغّل الخادم نفسه (api/) على
// pgstore؛ كلمة مرور الحساب تُضبط على القاعدة المحلية بمفتاحها المحلي.
//   قبله: npx supabase start، واستيراد تصدير (import-supabase.mjs).
//   node scripts/migration/ui-smoke.mjs [--no-build] [--out <dir>]
//
// بعيد (موقع منشور، مثل معاينة Vercel): لا تُغيَّر كلمة مرور أحد — جلسة مؤقتة
// من Auth Admin (magiclink ثم verify) تُحقن في المتصفح، ويُسجَّل خروجها في
// النهاية. رمز تجاوز حماية Vercel يُضاف لطلبات الموقع فقط، لا لـSupabase.
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=… \
//   SUPABASE_ACCESS_TOKEN=… [VERCEL_BYPASS=…] \
//     node scripts/migration/ui-smoke.mjs --base https://<الموقع> [--out <dir>]
// ═══════════════════════════════════════════════════════════════════════════
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { managementApiTransport, pgSqlTransport } from './sql-transport.mjs';

// Playwright from the project, or the machine's global install (as measure.mjs does).
const require = createRequire(import.meta.url);
const { chromium } = (() => {
  try { return require('playwright'); }
  catch { return require(`${execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()}/playwright`); }
})();

const ROOT = new URL('../../', import.meta.url).pathname;
const opt = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const REMOTE = opt('--base')?.replace(/\/+$/, '');
const API_PORT = 5184; const WEB_PORT = 4183;
const BASE = REMOTE || `http://127.0.0.1:${WEB_PORT}`;
const DB_URL = process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const OUT = opt('--out') || join(ROOT, 'migration-data', REMOTE ? 'ui-smoke-preview' : 'ui-smoke');
const PASSWORD = `smoke-${Date.now()}`;
// Requests to Firebase mean a page still talks to the old backend.
const FIREBASE = /firestore\.googleapis\.com|identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com|firebaseio\.com|firebasestorage\.googleapis\.com/;

export const PAGES = ['overview', 'growth_performance', 'executive_reports', 'agent_command_center', 'washes', 'operations_reports', 'bikers',
  'housing', 'temporary_expenses', 'sweater_settlements', 'sweater_integration', 'startup', 'annual', 'monthly', 'variable', 'summary', 'vat',
  'budgets', 'partners', 'payments', 'ledger', 'trial', 'balance', 'documents', 'assets', 'periods', 'finance', 'finance_workbench',
  'finance_reports', 'finance_payroll'];

// The partner's own pages: everything comes from the server, trimmed to their share.
export const PARTNER_PAGES = ['investor', 'investor_income', 'investor_journey'];

/** Where the pages read from: the local stack, or the remote project behind the deployed site. */
function target() {
  if (REMOTE) {
    const url = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
    const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
    // The local stack works too (rehearsing this mode against a local build).
    const isLocal = /^(127\.0\.0\.1|localhost)$/.test(host);
    const project = /^([a-z0-9]+)\.supabase\.co$/.exec(host)?.[1];
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if ((!isLocal && !project) || !serviceKey || (!isLocal && !process.env.SUPABASE_ACCESS_TOKEN)) {
      console.error('--base needs SUPABASE_URL (https://<ref>.supabase.co), SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ACCESS_TOKEN.'); process.exit(2);
    }
    // supabase-js keeps the session under sb-<first label of the host>-auth-token.
    const ref = host.split('.')[0];
    return { url, ref, serviceKey, sql: isLocal ? pgSqlTransport(DB_URL) : managementApiTransport({ ref: project, token: process.env.SUPABASE_ACCESS_TOKEN }) };
  }
  const local = Object.fromEntries(execFileSync('npx', ['supabase', 'status', '-o', 'env'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    .split('\n').map(l => /^([A-Z_]+)="?(.*?)"?$/.exec(l.trim())).filter(Boolean).map(m => [m[1], m[2]]));
  if (!local.API_URL || !/127\.0\.0\.1|localhost/.test(local.API_URL)) { console.error('Local Supabase only.'); process.exit(2); }
  return { url: local.API_URL, serviceKey: local.SERVICE_ROLE_KEY, local, sql: pgSqlTransport(DB_URL) };
}
const T = target();
const admin = path => ({ headers: { apikey: T.serviceKey, Authorization: `Bearer ${T.serviceKey}`, 'Content-Type': 'application/json' }, url: `${T.url}${path}` });

async function account(sql, what) {
  const [row] = await T.sql.run(sql);
  if (!row && what === 'admin') throw new Error('No administrator in the database — import an export first.');
  return row || null;
}
const adminAccount = () => account(`select u.id::text as id, u.email from public.app_admins a join auth.users u on u.id::text = a.id
  join public.members m on m.id = a.id order by u.email limit 1`, 'admin');
// A partner account that a partners document points at.
const partnerAccount = () => account(`select u.id::text as id, u.email from public.members m join auth.users u on u.id::text = m.id
  join public.partners p on p.user_id = m.id where m.role = 'partner' and not exists (select 1 from public.app_admins a where a.id = m.id)
  order by u.email limit 1`, 'partner');

// Local: a known password, typed into the login screen.
async function setPassword(id) {
  const { url, headers } = admin(`/auth/v1/admin/users/${id}`);
  const res = await fetch(url, { method: 'PUT', headers, body: JSON.stringify({ password: PASSWORD }) });
  if (!res.ok) throw new Error(`password: ${res.status}`);
}
// Remote: a one-off session (no password changes), signed out when the walk ends.
async function temporarySession(email) {
  const link = admin('/auth/v1/admin/generate_link');
  const res = await fetch(link.url, { method: 'POST', headers: link.headers, body: JSON.stringify({ type: 'magiclink', email }) });
  const body = await res.json().catch(() => ({}));
  const hash = body.hashed_token || body.properties?.hashed_token;
  if (!res.ok || !hash) throw new Error(`session for ${email}: ${res.status}`);
  const verify = admin('/auth/v1/verify');
  const v = await fetch(verify.url, { method: 'POST', headers: verify.headers, body: JSON.stringify({ type: 'magiclink', token_hash: hash }) });
  const session = await v.json().catch(() => ({}));
  if (!v.ok || !session.access_token) throw new Error(`verify for ${email}: ${v.status}`);
  return { ...session, expires_at: session.expires_at || Math.floor(Date.now() / 1000) + Number(session.expires_in || 3600) };
}
async function signOut(session) {
  const res = await fetch(`${T.url}/auth/v1/logout?scope=local`, { method: 'POST', headers: { apikey: T.serviceKey, Authorization: `Bearer ${session.access_token}` } });
  if (!res.ok && res.status !== 404) console.warn(`sign-out: ${res.status}`);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitUp(url) { for (let i = 0; i < 120; i += 1) { try { await fetch(url); return; } catch { await sleep(500); } } throw new Error(`down: ${url}`); }
async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {});
  for (let i = 0; i < 60; i += 1) {
    const busy = await page.locator('[aria-busy="true"], .animate-spin').count().catch(() => 0);
    if (!busy) break;
    await sleep(500);
  }
  await sleep(400);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const children = [];
  if (!REMOTE) {
    const { local } = T;
    const env = {
      ...process.env, API_PORT: String(API_PORT),
      VITE_DATA_SOURCE: 'supabase', VITE_SUPABASE_URL: local.API_URL, VITE_SUPABASE_ANON_KEY: local.ANON_KEY, VITE_LEDGER_API_URL: '/api/ledger',
      DATA_SOURCE: 'supabase', LEDGER_DB_URL: DB_URL, SUPABASE_URL: local.API_URL, SUPABASE_JWT_SECRET: local.JWT_SECRET,
    };
    if (!process.argv.includes('--no-build')) {
      execFileSync('npx', ['vite', 'build', '--mode', 'supabase-local', '--outDir', 'dist-supabase-local', '--emptyOutDir'], { cwd: ROOT, env, stdio: 'inherit' });
    }
    children.push(
      spawn('node', ['scripts/emulator/api-server.mjs'], { cwd: ROOT, env, stdio: ['ignore', 'ignore', 'inherit'] }),
      spawn('npx', ['vite', 'preview', '--mode', 'supabase-local', '--outDir', 'dist-supabase-local', '--port', String(WEB_PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, env, stdio: 'ignore' }),
    );
  }
  const stop = () => children.forEach(c => { try { c.kill(); } catch { /* gone */ } });
  process.on('exit', stop);
  if (!REMOTE) await waitUp(BASE);

  const browser = await chromium.launch();
  const results = [];
  results.push(...await walk(browser, await adminAccount(), PAGES, 'admin'));
  const partner = await partnerAccount();
  if (partner) results.push(...await walk(browser, partner, PARTNER_PAGES, 'partner'));
  else console.log('(no linked partner account — partner pages skipped)');
  await browser.close();
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(results, null, 2));
  const bad = results.filter(r => r.issues.length);
  console.log(`\n${results.length - bad.length}/${results.length} صفحة بلا خطأ.`);
  stop();
  process.exit(bad.length ? 1 : 0);
}

async function walk(browser, who, pages, label) {
  const context = await browser.newContext({ locale: 'ar-SA', viewport: { width: 1440, height: 1000 } });
  const bypass = process.env.VERCEL_BYPASS;
  if (REMOTE && bypass) {
    const origin = new URL(BASE).origin;
    // The header for the requests the page makes, and Vercel's bypass cookie
    // for the one the routing cannot see (the service worker's script).
    await context.route(u => u.origin === origin, route => route.continue({
      headers: { ...route.request().headers(), 'x-vercel-protection-bypass': bypass, 'x-vercel-set-bypass-cookie': 'true' },
    }));
  }
  let session = null;
  if (REMOTE) {
    session = await temporarySession(who.email);
    await context.addInitScript(([key, value]) => { try { if (!localStorage.getItem(key)) localStorage.setItem(key, value); } catch { /* no storage */ } },
      [`sb-${T.ref}-auth-token`, JSON.stringify(session)]);
  } else {
    await setPassword(who.id);
  }
  const page = await context.newPage();
  try {
    await page.goto(`${BASE}/?page=${pages[0]}`);
    if (!REMOTE) {
      await page.locator('input[type="email"]').fill(who.email);
      await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
      await page.locator('button[type="submit"]').click();
    }
    await page.waitForFunction(() => !document.querySelector('input[type="email"]'), null, { timeout: 30000 });
    const results = [];
    for (const tab of pages) {
      const issues = [];
      const onError = e => issues.push(`pageerror: ${e.message}`);
      const onConsole = m => { if (m.type() === 'error') issues.push(`console: ${m.text().slice(0, 200)}`); };
      const onResponse = r => { const u = r.url(); if (r.status() >= 400 && (u.includes('/api/') || u.includes(T.url))) issues.push(`${r.status()} ${r.request().method()} ${u.replace(T.url, '<supabase>').slice(0, 160)}`); };
      const onRequest = r => { if (FIREBASE.test(r.url())) issues.push(`firebase request: ${r.url().slice(0, 160)}`); };
      page.on('pageerror', onError); page.on('console', onConsole); page.on('response', onResponse); page.on('request', onRequest);
      await page.goto(`${BASE}/?page=${tab}`);
      await settle(page);
      // Error cards and alerts only (a status filter may legitimately offer «متعذر»).
      const visible = await page.locator('[role="alert"], .sw-error-state').filter({ hasText: /تعذّر|تعذر|حدث خطأ|Missing or insufficient/ }).allInnerTexts().catch(() => []);
      for (const t of visible.slice(0, 3)) issues.push(`on screen: ${t.replace(/\s+/g, ' ').slice(0, 160)}`);
      await page.screenshot({ path: join(OUT, `${label}-${tab}.png`), fullPage: false });
      page.off('pageerror', onError); page.off('console', onConsole); page.off('response', onResponse); page.off('request', onRequest);
      results.push({ role: label, tab, issues: [...new Set(issues)] });
      console.log(`${issues.length ? '✗' : '✓'} ${label} ${tab}${issues.length ? `\n    ${[...new Set(issues)].join('\n    ')}` : ''}`);
    }
    return results;
  } finally {
    await context.close();
    if (session) await signOut(session);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
