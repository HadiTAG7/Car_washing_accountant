#!/usr/bin/env node
// Every app table as { rows, md5 } of its rows in key order (all columns,
// generated ones included) — two databases with equal fingerprints hold the
// same data. Used to prove the raw-SQL import equals the direct one, and the
// remote project equals the local reference import of the same export.
// Raw SQL through a transport, so a local database and the remote project
// (over HTTPS) are measured by the same text; times are read in UTC.
//   SUPABASE_DB_URL=… node scripts/migration/db-fingerprint.mjs > a.json
//   SUPABASE_ACCESS_TOKEN=… node scripts/migration/db-fingerprint.mjs --via api --project <ref> > b.json
import { SCHEMA } from '../../src/lib/data/schema/registry.js';
import { literal, managementApiTransport, pgSqlTransport } from './sql-transport.mjs';

const qi = s => `"${String(s).replace(/"/g, '""')}"`;
// Set by the database at insert time, not by the import.
const VOLATILE = { firebase_uid_map: ['migrated_at'] };
// Text output that depends on the session, pinned for this one request.
const PIN = `set local timezone = 'UTC'; set local datestyle = 'ISO, MDY'; set local intervalstyle = 'postgres';
set local extra_float_digits = 1; set local bytea_output = 'hex';`;

/** @param target a connection string or a raw-SQL transport ({ run(sql) }). */
export async function fingerprint(target) {
  const sql = typeof target === 'string' ? pgSqlTransport(target) : target;
  const tables = [...SCHEMA.map(t => t.table), ...SCHEMA.filter(t => t.lines).map(t => t.lines), 'firebase_uid_map'];
  const cols = await sql.run(`select c.relname as t, a.attname as c from pg_attribute a
    join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname in (${tables.map(literal).join(', ')}) and a.attnum > 0 and not a.attisdropped
    order by c.relname, a.attnum`);
  const byTable = {};
  for (const { t, c } of cols) (byTable[t] ||= []).push(c);
  const parts = tables.map((t) => {
    if (!byTable[t]) throw new Error(`fingerprint: no table public.${t}`);
    const keep = byTable[t].filter(c => !(VOLATILE[t] || []).includes(c));
    return `select ${literal(t)} as t, count(*)::int as rows, md5(coalesce(string_agg(x, E'\\n' order by x collate "C"), '')) as md5
      from (select row(${keep.map(qi).join(', ')})::text as x from public.${qi(t)}) s`;
  });
  const rows = await sql.run(`${PIN}\n${parts.join('\nunion all\n')}`);
  const got = Object.fromEntries(rows.map(r => [r.t, { rows: Number(r.rows), md5: r.md5 }]));
  return Object.fromEntries(tables.map((t) => {
    if (!got[t]) throw new Error(`fingerprint: ${t} missing from the answer`);
    return [t, got[t]];
  }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const opt = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
  const target = opt('--via') === 'api'
    ? managementApiTransport({ ref: opt('--project'), token: process.env.SUPABASE_ACCESS_TOKEN })
    : (process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres');
  fingerprint(target).then(f => console.log(JSON.stringify(f, null, 2)), (e) => { console.error(e.message); process.exit(1); });
}
