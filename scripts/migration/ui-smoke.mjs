#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// جولة في الموقع على Supabase المحلي — كل صفحة، بلا خطأ واحد
// ═══════════════════════════════════════════════════════════════════════════
// يبني الموقع بـ VITE_DATA_SOURCE=supabase، ويشغّل الخادم نفسه (api/) على
// pgstore، ثم يفتح كل صفحة كمدير ويسجّل: أخطاء الصفحة، أخطاء الطرفية، أي
// طلب فاشل (‎/api أو Supabase)، وأي بطاقة «تعذّر…» ظاهرة. لقطة لكل صفحة.
//
// قبله: npx supabase start، واستيراد تصدير (import-supabase.mjs).
//   node scripts/migration/ui-smoke.mjs [--no-build] [--out <dir>]
// محلي فقط: كلمة مرور الحساب تُضبط على القاعدة المحلية بمفتاحها المحلي.
// ═══════════════════════════════════════════════════════════════════════════
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import pg from 'pg';

// Playwright from the project, or the machine's global install (as measure.mjs does).
const require = createRequire(import.meta.url);
const { chromium } = (() => {
  try { return require('playwright'); }
  catch { return require(`${execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()}/playwright`); }
})();

const ROOT = new URL('../../', import.meta.url).pathname;
const API_PORT = 5184; const WEB_PORT = 4183; const BASE = `http://127.0.0.1:${WEB_PORT}`;
const DB_URL = process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const outIdx = process.argv.indexOf('--out');
const OUT = outIdx > 0 ? process.argv[outIdx + 1] : join(ROOT, 'migration-data', 'ui-smoke');
const PASSWORD = `smoke-${Date.now()}`;

const local = Object.fromEntries(execFileSync('npx', ['supabase', 'status', '-o', 'env'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  .split('\n').map(l => /^([A-Z_]+)="?(.*?)"?$/.exec(l.trim())).filter(Boolean).map(m => [m[1], m[2]]));
if (!local.API_URL || !/127\.0\.0\.1|localhost/.test(local.API_URL)) { console.error('Local Supabase only.'); process.exit(2); }

export const PAGES = ['overview', 'growth_performance', 'executive_reports', 'agent_command_center', 'washes', 'operations_reports', 'bikers',
  'housing', 'temporary_expenses', 'sweater_settlements', 'sweater_integration', 'startup', 'annual', 'monthly', 'variable', 'summary', 'vat',
  'budgets', 'partners', 'payments', 'ledger', 'trial', 'balance', 'documents', 'assets', 'periods', 'finance', 'finance_workbench',
  'finance_reports', 'finance_payroll'];

const env = {
  ...process.env, API_PORT: String(API_PORT),
  VITE_DATA_SOURCE: 'supabase', VITE_SUPABASE_URL: local.API_URL, VITE_SUPABASE_ANON_KEY: local.ANON_KEY, VITE_LEDGER_API_URL: '/api/ledger',
  DATA_SOURCE: 'supabase', LEDGER_DB_URL: DB_URL, SUPABASE_URL: local.API_URL, SUPABASE_JWT_SECRET: local.JWT_SECRET,
};

async function adminAccount() {
  const db = new pg.Client({ connectionString: DB_URL }); await db.connect();
  try {
    const { rows: [row] } = await db.query(`select u.id::text as id, u.email from public.app_admins a join auth.users u on u.id::text = a.id
      join public.members m on m.id = a.id order by u.email limit 1`);
    if (!row) throw new Error('No administrator in the local database — import an export first.');
    return row;
  } finally { await db.end(); }
}
async function setPassword(id) {
  const res = await fetch(`${local.API_URL}/auth/v1/admin/users/${id}`, { method: 'PUT',
    headers: { apikey: local.SERVICE_ROLE_KEY, Authorization: `Bearer ${local.SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }) });
  if (!res.ok) throw new Error(`password: ${res.status}`);
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
  if (!process.argv.includes('--no-build')) {
    execFileSync('npx', ['vite', 'build', '--mode', 'supabase-local', '--outDir', 'dist-supabase-local', '--emptyOutDir'], { cwd: ROOT, env, stdio: 'inherit' });
  }
  const children = [
    spawn('node', ['scripts/emulator/api-server.mjs'], { cwd: ROOT, env, stdio: ['ignore', 'ignore', 'inherit'] }),
    spawn('npx', ['vite', 'preview', '--mode', 'supabase-local', '--outDir', 'dist-supabase-local', '--port', String(WEB_PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, env, stdio: 'ignore' }),
  ];
  const stop = () => children.forEach(c => { try { c.kill(); } catch { /* gone */ } });
  process.on('exit', stop);
  await waitUp(BASE);

  const admin = await adminAccount();
  await setPassword(admin.id);
  const browser = await chromium.launch();
  const context = await browser.newContext({ locale: 'ar-SA', viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/?page=overview`);
  await page.locator('input[type="email"]').fill(admin.email);
  await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForFunction(() => !document.querySelector('input[type="email"]'), null, { timeout: 30000 });

  const results = [];
  for (const tab of PAGES) {
    const issues = [];
    const onError = e => issues.push(`pageerror: ${e.message}`);
    const onConsole = m => { if (m.type() === 'error') issues.push(`console: ${m.text().slice(0, 200)}`); };
    const onResponse = r => { const u = r.url(); if (r.status() >= 400 && (u.includes('/api/') || u.includes(local.API_URL))) issues.push(`${r.status()} ${r.request().method()} ${u.replace(local.API_URL, '<supabase>').slice(0, 160)}`); };
    page.on('pageerror', onError); page.on('console', onConsole); page.on('response', onResponse);
    await page.goto(`${BASE}/?page=${tab}`);
    await settle(page);
    // Error cards and alerts only (a status filter may legitimately offer «متعذر»).
    const visible = await page.locator('[role="alert"], .sw-error-state').filter({ hasText: /تعذّر|تعذر|حدث خطأ|Missing or insufficient/ }).allInnerTexts().catch(() => []);
    for (const t of visible.slice(0, 3)) issues.push(`on screen: ${t.replace(/\s+/g, ' ').slice(0, 160)}`);
    await page.screenshot({ path: join(OUT, `${tab}.png`), fullPage: false });
    page.off('pageerror', onError); page.off('console', onConsole); page.off('response', onResponse);
    results.push({ tab, issues: [...new Set(issues)] });
    console.log(`${issues.length ? '✗' : '✓'} ${tab}${issues.length ? `\n    ${[...new Set(issues)].join('\n    ')}` : ''}`);
  }
  await browser.close();
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(results, null, 2));
  const bad = results.filter(r => r.issues.length);
  console.log(`\n${results.length - bad.length}/${results.length} صفحة بلا خطأ.`);
  stop();
  process.exit(bad.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
