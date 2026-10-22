#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// خادم `/api` المحلي فوق المحاكي — بدل Vercel أثناء القياس والتطوير
// ═══════════════════════════════════════════════════════════════════════════
// يركّب ملفات `api/*.js` كما هي (كلها تدعم المحاكي إذا وُجد
// FIRESTORE_EMULATOR_HOST وFIREBASE_AUTH_EMULATOR_HOST) ويعيد كتابة المسارات
// كما في vercel.json. ويحمل عدّاد قراءات Admin SDK:
//   GET /__meter  → قراءات الخادم منذ آخر طلب ثم يصفّر العدّاد.
// ═══════════════════════════════════════════════════════════════════════════

import http from 'node:http';
import { readFileSync } from 'node:fs';
import { takeMeter } from './read-meter.mjs';

// Or the local Supabase (DATA_SOURCE=supabase, LEDGER_DB_URL to it): the same
// handlers on pgstore, for `vite --mode supabase-local`.
const localSupabase = process.env.DATA_SOURCE === 'supabase' && /@(127\.0\.0\.1|localhost):/.test(process.env.LEDGER_DB_URL || '');
if (!localSupabase && (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST)) {
  console.error('api-server.mjs serves the emulators (or a local Supabase) only.');
  process.exit(2);
}
process.env.GCLOUD_PROJECT ||= 'demo-sweater';

const PORT = Number(process.env.API_PORT || 5174);
const rewrites = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')).rewrites
  .filter(r => r.source.startsWith('/api/'));
const handlers = new Map();
async function handlerFor(pathname) {
  const rewrite = rewrites.find(r => r.source === pathname);
  const target = new URL(rewrite ? rewrite.destination : pathname, 'http://local');
  const file = target.pathname.replace(/^\/api\//, '');
  if (!/^[a-z0-9-]+(\/[a-z0-9-]+)*$/.test(file)) return null;
  if (!handlers.has(file)) handlers.set(file, (await import(`../../api/${file}.js`)).default);
  return { handler: handlers.get(file), query: Object.fromEntries(target.searchParams) };
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  if (url.pathname === '/__meter') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(takeMeter()));
  }
  const route = url.pathname.startsWith('/api/') ? await handlerFor(url.pathname).catch(() => null) : null;
  if (!route) { res.writeHead(404); return res.end(); }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  let body = raw;
  try { body = raw ? JSON.parse(raw) : {}; } catch { /* handlers parse strings themselves */ }
  const vreq = Object.assign(req, { query: { ...Object.fromEntries(url.searchParams), ...route.query }, body });
  const vres = Object.assign(res, {
    status(code) { res.statusCode = code; return vres; },
    json(value) { if (!res.headersSent) res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); return vres; },
    send(value) { res.end(typeof value === 'string' ? value : JSON.stringify(value)); return vres; },
  });
  try { await route.handler(vreq, vres); }
  catch (e) { if (!res.headersSent) { res.statusCode = 500; res.end(JSON.stringify({ error: { message: e.message } })); } }
}).listen(PORT, '127.0.0.1', () => console.log(`api-server on http://127.0.0.1:${PORT}`));
