#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// قياس قراءات Firestore لكل صفحة — على المحاكي، بلا حصة الإنتاج
// ═══════════════════════════════════════════════════════════════════════════
// يبني نسخة `--mode emulator` (عدّاد المتصفح مركّب بدل firebase/firestore)،
// ويشغّل خادم /api المحلي (عدّاد Admin SDK) ومعاينة Vite، ثم يفتح كل صفحة
// **تحميلاً جديداً** كما يفتحها المستخدم: نفس الجلسة المحفوظة، ذاكرة صفحة
// فارغة. ثم جلسة كاملة تتنقّل بين الصفحات داخل التطبيق.
//
// يُشغَّل داخل المحاكي (يضبط FIRESTORE_EMULATOR_HOST وFIREBASE_AUTH_EMULATOR_HOST):
//   npm run emulator:measure                 # يزرع ثم يقيس
//   MEASURE_OUT=reads.json node scripts/emulator/measure.mjs
// ═══════════════════════════════════════════════════════════════════════════

import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { ACCOUNTS, PASSWORD } from './accounts.mjs';

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error('measure.mjs runs inside the emulators (firebase emulators:exec).');
  process.exit(2);
}
const require = createRequire(import.meta.url);
const { chromium } = (() => {
  try { return require('playwright'); }
  catch { return require(`${execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()}/playwright`); }
})();

const ROOT = new URL('../../', import.meta.url).pathname;
const API_PORT = Number(process.env.API_PORT || 5174);
const WEB_PORT = Number(process.env.WEB_PORT || 4173);
const BASE = `http://127.0.0.1:${WEB_PORT}`;
const env = { ...process.env, VITE_FIREBASE_EMULATOR: '1', VITE_LEDGER_API_URL: '/api/ledger', API_PORT: String(API_PORT) };

export const PAGES = [
  ['النظرة العامة', 'overview'],
  ['الغسلات', 'washes'],
  ['البايكر', 'bikers'],
  ['ملخص المالية', 'finance'],
  ['قائمة الدخل', 'summary'],
  ['دفتر الأستاذ', 'ledger'],
  ['ميزان المراجعة', 'trial'],
  ['تسويات سويتر', 'sweater_settlements'],
];
const PARTNER_PAGES = [['الشريك — نظرة عامة', 'investor'], ['الشريك — قائمة الدخل', 'investor_income'], ['الشريك — رحلة رأس المال', 'investor_journey']];

if (!process.argv.includes('--no-build')) {
  execFileSync('npx', ['vite', 'build', '--mode', 'emulator', '--outDir', 'dist-emulator', '--emptyOutDir'], { cwd: ROOT, env, stdio: 'inherit' });
}
const children = [
  spawn('node', ['scripts/emulator/api-server.mjs'], { cwd: ROOT, env, stdio: 'inherit' }),
  spawn('npx', ['vite', 'preview', '--mode', 'emulator', '--outDir', 'dist-emulator', '--port', String(WEB_PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, env, stdio: 'ignore' }),
];
const stop = () => children.forEach(c => { try { c.kill(); } catch { /* already gone */ } });
process.on('exit', stop);

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitUp(url) {
  for (let i = 0; i < 120; i += 1) { try { await fetch(url); return; } catch { await sleep(500); } }
  throw new Error(`not up: ${url}`);
}
await waitUp(`http://127.0.0.1:${API_PORT}/__meter`);
await waitUp(BASE);

const takeServer = async () => (await fetch(`http://127.0.0.1:${API_PORT}/__meter`)).json();
const browserMeter = page => page.evaluate(() => globalThis.__firestoreReads || { reads: 0, requests: 0, listeners: 0, byCollection: {} });

/** Counts in-flight `/api` calls: a slow server call must not read as «quiet». */
function trackApi(page) {
  const pending = new Set();
  page.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api/')) pending.add(r); });
  const done = r => pending.delete(r);
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  page.__pendingApi = pending;
}

/** Waits until no `/api` call is in flight and neither meter moved for `quiet` ms (max 120 s). */
async function settle(page, quiet = 4000) {
  let last = ''; let since = Date.now(); const start = Date.now();
  let server = { reads: 0, calls: 0, byCollection: {} };
  while (Date.now() - start < 120000) {
    await sleep(500);
    const delta = await takeServer();
    server = { reads: server.reads + delta.reads, calls: server.calls + delta.calls, byCollection: merge(server.byCollection, delta.byCollection) };
    const b = await browserMeter(page).catch(() => ({ reads: -1 }));
    const key = `${b.reads}|${server.reads}|${page.__pendingApi?.size || 0}`;
    if (key !== last || page.__pendingApi?.size) { last = key; since = Date.now(); }
    else if (Date.now() - since >= quiet) break;
  }
  return { browser: await browserMeter(page), server };
}
function merge(a = {}, b = {}) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] || 0) + v;
  return out;
}

async function login(browser, email) {
  const context = await browser.newContext({ locale: 'ar-SA' });
  const page = await context.newPage();
  await page.goto(`${BASE}/?page=overview`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForFunction(() => !document.querySelector('input[type="email"]'), null, { timeout: 30000 });
  await settle(page);
  const state = await context.storageState({ indexedDB: true });
  await context.close();
  return state;
}

async function openFresh(browser, state, tab) {
  const context = await browser.newContext({ storageState: state, locale: 'ar-SA' });
  const page = await context.newPage();
  trackApi(page);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await takeServer();
  await page.goto(`${BASE}/?page=${tab}`);
  const result = await settle(page);
  await context.close();
  return { ...result, errors };
}

/** One session: land on the overview, then move through every page in-app. */
async function session(browser, state, pages) {
  const context = await browser.newContext({ storageState: state, locale: 'ar-SA' });
  const page = await context.newPage();
  trackApi(page);
  await takeServer();
  await page.goto(`${BASE}/?page=${pages[0][1]}`);
  const steps = [];
  let previous = { browser: { reads: 0 }, server: { reads: 0 } };
  let first = await settle(page);
  steps.push({ tab: pages[0][1], browser: first.browser.reads, server: first.server.reads });
  previous = first;
  for (const [, tab] of [...pages.slice(1), pages[0]]) {
    await page.evaluate(t => { const u = new URL(location.href); u.searchParams.set('page', t); history.pushState(null, '', u); dispatchEvent(new PopStateEvent('popstate')); }, tab);
    const now = await settle(page);
    steps.push({ tab, browser: now.browser.reads - previous.browser.reads, server: now.server.reads });
    previous = { browser: now.browser, server: now.server };
  }
  await context.close();
  return steps;
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const report = { at: new Date().toISOString(), pages: [], partner: [], session: [] };
try {
  const admin = await login(browser, ACCOUNTS.admin);
  for (const [label, tab] of PAGES) {
    const r = await openFresh(browser, admin, tab);
    report.pages.push({ label, tab, browser: r.browser.reads, server: r.server.reads, requests: r.browser.requests,
      listeners: r.browser.listeners, collections: merge(r.browser.byCollection, r.server.byCollection), errors: r.errors });
    console.log(`${label.padEnd(16)} browser ${String(r.browser.reads).padStart(6)}  server ${String(r.server.reads).padStart(6)}  requests ${r.browser.requests}`);
  }
  report.session = await session(browser, admin, PAGES);
  const partner = await login(browser, ACCOUNTS.partner);
  for (const [label, tab] of PARTNER_PAGES) {
    const r = await openFresh(browser, partner, tab);
    report.partner.push({ label, tab, browser: r.browser.reads, server: r.server.reads, requests: r.browser.requests,
      collections: merge(r.browser.byCollection, r.server.byCollection), errors: r.errors });
    console.log(`${label.padEnd(16)} browser ${String(r.browser.reads).padStart(6)}  server ${String(r.server.reads).padStart(6)}`);
  }
} finally {
  await browser.close();
  stop();
}
const out = process.env.MEASURE_OUT || 'emulator-reads.json';
writeFileSync(new URL(out, `file://${ROOT}`), JSON.stringify(report, null, 2));
console.log(`\nwritten: ${out}`);
process.exit(0);
