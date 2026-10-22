// Test-only stand-in for `firebase-admin/firestore`: the server's own tests run
// unchanged on pgstore (vitest.pgstore.config.js). Not used in production.
import { createStore, FieldValue, FieldPath, Timestamp } from '../index.js';

export const TEST_DB_URL = process.env.SUPABASE_TEST_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
let store;
export function getFirestore() {
  if (!store || store._closed) store = createStore({ connectionString: TEST_DB_URL, role: 'ledger_server', testResets: true, max: 8, projectId: 'demo-sweater' });
  return store;
}
export { FieldValue, FieldPath, Timestamp };
export class Firestore {}

// On Supabase an account id is its Auth user's UUID (members/app_admins point
// at auth.users). Suites that name accounts ('u1', 'boss') map each name to a
// stable UUID and create the Auth user behind it.
import { createHash } from 'node:crypto';
import pg from 'pg';
export function testUid(name) {
  const h = createHash('sha1').update(`pgstore-test:${name}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export async function ensureAuthUsers(names) {
  const client = new pg.Client({ connectionString: TEST_DB_URL });
  await client.connect();
  try {
    for (const name of names) {
      await client.query(`insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
          confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token, phone_change, phone_change_token)
        values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, now(), '{}', '{}', now(), now(), '', '', '', '', '', '', '', '')
        on conflict (id) do nothing`, [testUid(name), `${name.replace(/[^a-z0-9]/gi, '')}.${testUid(name).slice(0, 8)}@pgstore.test`]);
    }
  } finally { await client.end(); }
}
