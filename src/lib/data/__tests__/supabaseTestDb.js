// Test access to the LOCAL Supabase (npx supabase start): run SQL as the
// database owner, as the trusted server role, or as a signed-in user exactly
// the way PostgREST does it (SET LOCAL ROLE authenticated + JWT claims).
import pg from 'pg';
import { SCHEMA } from '../schema/registry.js';

export const LOCAL_DB_URL = process.env.SUPABASE_TEST_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
let pool;
export const db = () => (pool ||= new pg.Pool({ connectionString: LOCAL_DB_URL, max: 4 }));
export async function closeDb() { if (pool) { await pool.end(); pool = null; } }

export async function available() {
  try { await db().query('select 1'); return true; } catch { return false; }
}

const APP_TABLES = [...SCHEMA.map(t => t.table), 'journal_entry_lines', 'firebase_uid_map'];
/** Empties every app table (and the test users). TRUNCATE skips the no-delete triggers. */
export async function resetDb() {
  await db().query(`truncate ${APP_TABLES.map(t => `public."${t}"`).join(', ')} cascade`);
  await db().query(`delete from auth.users where email like '%@sweater.test'`);
}

export async function createAuthUser(id, email) {
  await db().query(`insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, now(), '{}', '{}', now(), now())
    on conflict (id) do nothing`, [id, email]);
}

async function inTx(setup, fn) {
  const client = await db().connect();
  try {
    await client.query('begin');
    await setup(client);
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally { client.release(); }
}

/** As a signed-in user (uid) — RLS and the user-only triggers apply. */
export const asUser = (uid, fn) => inTx(async (c) => {
  await c.query('set local role authenticated');
  await c.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('request.jwt.claim.role', 'authenticated', true)`,
    [JSON.stringify({ sub: uid, role: 'authenticated', aud: 'authenticated' }), uid]);
}, fn);
/** As the trusted server role — its own policies and grants, no RLS bypass. */
export const asServer = fn => inTx(c => c.query('set local role ledger_server'), fn);
/** As the database owner (migration scripts only). */
export const asOwner = fn => inTx(async () => {}, fn);

/** Outcome of an attempt: 'ok', or the SQLSTATE of the refusal. */
export async function attempt(promise) {
  try { const r = await promise; return { ok: true, rows: r?.rows ?? r }; } catch (e) { return { ok: false, code: e.code, message: e.message }; }
}
