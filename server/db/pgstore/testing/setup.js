// Each test file starts from empty tables, as each emulator run did. The
// emulator's «clear all documents» endpoint, which some suites call between
// cases, answers here too: FIRESTORE_EMULATOR_HOST points at this stand-in.
import pg from 'pg';
import http from 'node:http';
import { afterAll, beforeAll } from 'vitest';
import { SCHEMA } from '../../../../src/lib/data/schema/registry.js';
import { TEST_DB_URL } from './firestore.js';

async function truncateAll() {
  const client = new pg.Client({ connectionString: TEST_DB_URL });
  await client.connect();
  const tables = [...SCHEMA.map(t => t.table), ...SCHEMA.filter(t => t.lines).map(t => t.lines), 'firebase_uid_map'];
  try { await client.query(`truncate ${tables.map(t => `public."${t}"`).join(', ')}`); } finally { await client.end(); }
}

const CLEAR = /^\/emulator\/v1\/projects\/[^/]+\/databases\/\(default\)\/documents$/;
const server = http.createServer((req, res) => {
  if (req.method !== 'DELETE' || !CLEAR.test(req.url)) { res.statusCode = 404; res.end(); return; }
  truncateAll().then(() => res.end('{}'), (e) => { res.statusCode = 500; res.end(String(e?.message)); });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
process.env.FIRESTORE_EMULATOR_HOST = `127.0.0.1:${server.address().port}`;

beforeAll(truncateAll);
afterAll(() => new Promise(resolve => server.close(resolve)));
