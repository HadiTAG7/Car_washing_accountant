#!/usr/bin/env node
// Every app table as { rows, md5 } of its rows in key order (all columns,
// generated ones included) — two databases with equal fingerprints hold the
// same data. Used to prove the raw-SQL import equals the direct one.
//   SUPABASE_DB_URL=… node scripts/migration/db-fingerprint.mjs > a.json
import pg from 'pg';
import { SCHEMA } from '../../src/lib/data/schema/registry.js';

const qi = s => `"${String(s).replace(/"/g, '""')}"`;
// Set by the database at insert time, not by the import.
const VOLATILE = { firebase_uid_map: ['migrated_at'] };

export async function fingerprint(connectionString) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const tables = [...SCHEMA.map(t => t.table), ...SCHEMA.filter(t => t.lines).map(t => t.lines), 'firebase_uid_map'];
    const out = {};
    for (const t of tables) {
      const { rows: cols } = await client.query(`select attname from pg_attribute where attrelid = $1::regclass and attnum > 0 and not attisdropped order by attnum`, [`public.${qi(t)}`]);
      const keep = cols.map(c => c.attname).filter(c => !(VOLATILE[t] || []).includes(c));
      const { rows: [r] } = await client.query(`select count(*)::int as rows, md5(coalesce(string_agg(x, E'\\n' order by x collate "C"), '')) as md5
        from (select row(${keep.map(qi).join(', ')})::text as x from public.${qi(t)}) s`);
      out[t] = r;
    }
    return out;
  } finally { await client.end(); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  fingerprint(process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres')
    .then(f => console.log(JSON.stringify(f, null, 2)), (e) => { console.error(e.message); process.exit(1); });
}
