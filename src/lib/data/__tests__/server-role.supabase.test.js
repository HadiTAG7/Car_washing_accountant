// دخول ledger_server: القاعدة تستلم بصمة SCRAM فقط، وكلمة المرور نفسها تدخل.
// بصمة خاطئة الحساب = لا دخول على Vercel، فتُثبت هنا بتحقق Postgres نفسه.
// التشغيل: npx supabase start && npm run test:supabase
import { afterAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { available, closeDb, db, LOCAL_DB_URL } from './supabaseTestDb.js';
import { scramSecret } from '../../../../scripts/migration/server-role.mjs';

const up = await available();
const d = up ? describe : describe.skip;
const ROLE = 'server_role_scram_test';

async function login(password) {
  const url = new URL(LOCAL_DB_URL);
  url.username = ROLE; url.password = password;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try { return (await client.query('select current_user as u')).rows[0].u; } finally { await client.end(); }
}

d('scramSecret', () => {
  afterAll(async () => { await db().query(`drop role if exists ${ROLE}`); await closeDb(); });

  it('a role given only the SCRAM secret logs in with the password, and only with it', async () => {
    const password = randomBytes(32).toString('base64url');
    await db().query(`drop role if exists ${ROLE}`);
    await db().query(`create role ${ROLE} login password '${scramSecret(password)}'`);
    const { rows: [r] } = await db().query(`select rolpassword from pg_authid where rolname = $1`, [ROLE]);
    expect(r.rolpassword).toMatch(/^SCRAM-SHA-256\$4096:/);
    expect(await login(password)).toBe(ROLE);
    await expect(login(`${password}x`)).rejects.toThrow(/password authentication failed/);
  });
});
