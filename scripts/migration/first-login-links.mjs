#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// أول دخول على Supabase: رابط تعيين كلمة مرور لكل مستخدم منقول
// ═══════════════════════════════════════════════════════════════════════════
// المستخدمون يُنقلون بلا كلمات مرور (Firebase لا يعطيها). الطريق العادي: «نسيت
// كلمة المرور» في شاشة الدخول، والرسالة من SMTP المشروع. وإلى أن يُضبط SMTP
// (بريد Supabase المدمج لا يرسل إلا لأعضاء الفريق)، هذا السكربت يولّد لكل
// مستخدم رابطاً خاصاً يرسله المدير بنفسه — نفس صفحة /update-password.
//
// الروابط أسرار: تُكتب في migration-data/first-login-links.md (خارج git، 600)
// ولا تُطبع. صلاحيتها مدة otp_expiry في المشروع ولمرة واحدة.
//
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… APP_URL=https://<الموقع> \
//     node scripts/migration/first-login-links.mjs [--only email@x]
// service_role هنا فقط (سكربت محلي)، لا في الموقع.
// ═══════════════════════════════════════════════════════════════════════════
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { modulePath, isMainModule } from '../module-paths.mjs';

const url = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const app = String(process.env.APP_URL || '').replace(/\/+$/, '');
const out = process.env.MIGRATION_DATA || join(modulePath('../../', import.meta.url), 'migration-data');
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;

/** One user's link to /update-password (the token hash, spent on save). */
export async function recoveryLink({ url: base, key: secret, app: site }, email) {
  const res = await fetch(`${base}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: { apikey: secret, Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'recovery', email }),
  });
  const body = await res.json().catch(() => ({}));
  const hash = body.hashed_token || body.properties?.hashed_token;
  if (!res.ok || !hash) throw new Error(`${email}: ${res.status} ${body.msg || body.error_description || 'no token'}`);
  return `${site}/update-password?oobCode=${encodeURIComponent(hash)}&email=${encodeURIComponent(email)}`;
}

async function main() {
  if (!url || !key || !app) throw new Error('SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY و APP_URL مطلوبة.');
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const users = [];
  for (let page = 1; ; page += 1) {
    const res = await fetch(`${url}/auth/v1/admin/users?page=${page}&per_page=200`, { headers });
    if (!res.ok) throw new Error(`users: ${res.status}`);
    const { users: batch = [] } = await res.json();
    users.push(...batch);
    if (batch.length < 200) break;
  }
  const targets = users.filter(u => u.email && !u.banned_until && (!only || u.email === only) && u.user_metadata?.firebase_uid);
  const lines = ['# روابط أول دخول — سرّية، لكل شخص رابطه فقط', '', `صالحة لمرة واحدة ولمدة محدودة. أُنشئت ${new Date().toISOString()}.`, ''];
  for (const u of targets) lines.push(`- ${u.email}: ${await recoveryLink({ url, key, app }, u.email)}`);
  mkdirSync(out, { recursive: true, mode: 0o700 });
  const file = join(out, 'first-login-links.md');
  writeFileSync(file, `${lines.join('\n')}\n`, { mode: 0o600 });
  console.log(`${targets.length} رابطاً في ${file}`);
}

if (isMainModule(import.meta.url)) main().catch((e) => { console.error(e.message); process.exit(1); });
