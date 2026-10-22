#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// دخول دور الخادم ledger_server — للموقع على Vercel، بلا service_role
// ═══════════════════════════════════════════════════════════════════════════
// يولّد كلمة مرور عشوائية محلياً، ويرسل للقاعدة بصمتها SCRAM فقط (كلمة المرور
// نفسها لا تمر بواجهة الإدارة ولا بسجلات القاعدة)، ثم يكتب سطر الاتصال عبر
// المجمِّع (Supavisor) في migration-data/ledger-server.env — خارج git، 600.
// تلصقه أنت في Vercel (LEDGER_DB_URL)، ثم يُحذف الملف.
//
// الدور كما في الترحيلات: بلا تجاوز للـRLS، وصلاحياته محسوبة جدولاً جدولاً.
//   SUPABASE_ACCESS_TOKEN=… node scripts/migration/server-role.mjs --project <ref>
// ═══════════════════════════════════════════════════════════════════════════
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const API = 'https://api.supabase.com/v1';

/** PostgreSQL's SCRAM-SHA-256 secret for a password (what pg_authid stores). */
export function scramSecret(password, { salt = randomBytes(16), iterations = 4096 } = {}) {
  const salted = pbkdf2Sync(password.normalize('NFKC'), salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

async function api(path, token, init = {}) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers } });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${path}: ${res.status} ${JSON.stringify(body)?.slice(0, 200)}`);
  return body;
}

async function main() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const i = process.argv.indexOf('--project');
  const ref = i > 0 ? process.argv[i + 1] : process.env.SUPABASE_PROJECT_REF;
  if (!token || !ref) throw new Error('SUPABASE_ACCESS_TOKEN و --project <ref> مطلوبان.');
  // URL-safe, long, random; never printed.
  const password = randomBytes(32).toString('base64url');
  const secret = scramSecret(password);
  await api(`/projects/${ref}/database/query`, token, { method: 'POST',
    body: JSON.stringify({ query: `alter role ledger_server with login password '${secret}'` }) });
  const poolers = await api(`/projects/${ref}/config/database/pooler`, token);
  const tx = (Array.isArray(poolers) ? poolers : [poolers]).find(p => p.pool_mode === 'transaction') || (Array.isArray(poolers) ? poolers[0] : poolers);
  const host = tx.db_host; const port = tx.db_port || 6543;
  const url = `postgresql://ledger_server.${ref}:${password}@${host}:${port}/postgres?sslmode=require`;
  const dir = process.env.MIGRATION_DATA || join(new URL('../../', import.meta.url).pathname, 'migration-data');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, 'ledger-server.env');
  writeFileSync(file, `# سرّي — يُلصق في Vercel ثم يُحذف هذا الملف\nLEDGER_DB_URL=${url}\n`, { mode: 0o600 });
  console.log(`ledger_server يدخل الآن. سطر الاتصال في ${file} (لم يُطبع).`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exit(1); });
