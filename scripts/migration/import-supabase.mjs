#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// استيراد تصدير Firestore إلى Supabase — قابل للتكرار، كله أو لا شيء
// ═══════════════════════════════════════════════════════════════════════════
// المصدر ملفات التصدير المحلية (export-firestore.mjs) لا Firestore نفسه.
//
// داخل عملية واحدة: تفريغ جداول التطبيق ثم تحميل كل مستند، ولا تُثبَّت إلا إذا
// نجحت كل البوابات:
//   • لكل مجموعة جدول معرَّف (أو سبب صريح لعدم نقلها)
//   • العدد في كل جدول = العدد في التصدير
//   • كل مستند يُقرأ من القاعدة فيعود حرفياً كما صُدِّر (ذهاب وإياب 100%)
//   • كل قيد متوازن، ومجموع المدين = مجموع الدائن
//   • بصمات الاعتماد المالي: نفس ما يطابق قبل النقل يطابق بعده
// تشغيله مرتين يعطي نفس النتيجة (تفريغ ثم تحميل، والمعرّفات ثابتة).
//
// الحسابات: كل مستخدم Firebase يُنشأ في Supabase Auth بمعرّف ثابت مشتق من
// معرّفه القديم (UUID v5)، بلا كلمة مرور قابلة للاستخدام ولا رسائل. أول دخول
// برابط تعيين كلمة المرور. المراجع الحية للحساب (users، app_admins،
// partners.user_id، مفاتيح MCP) تُحوَّل للمعرّف الجديد؛ «من فعل» التاريخية
// تبقى كما هي.
//
//   node scripts/migration/import-supabase.mjs [--dir migration-data] [--dry-run]
// والاستعادة من نسخة الموقع الاحتياطية (Supabase): نفس الأمر على مجلد الملف
// بعد فكّه — المعرّفات كما هي، ولا حسابات تُنشأ، وجدول ربط الحسابات يعود معها.
// الهدف: SUPABASE_DB_URL (الافتراضي القاعدة المحلية) و SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY لإنشاء الحسابات (service_role هنا فقط، لا في الموقع).
// ═══════════════════════════════════════════════════════════════════════════

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { modulePath, isMainModule } from '../module-paths.mjs';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { SCHEMA, NOT_MIGRATED, tableFor } from '../../src/lib/data/schema/registry.js';
import { encodeDocument, decodeDocument, toTagged, plainTimestamp, LINE_COLUMNS } from '../../src/lib/data/schema/codec.js';
import { literal, pgSqlTransport, managementApiTransport } from './sql-transport.mjs';
import { qi, rowColumns, readDocuments } from '../../server/db/rows.js';
import { readExport } from './ndjson.mjs';
import { financeSourceHash, FINANCE_KINDS } from '../../functions/src/financeReview.js';

const ROOT = modulePath('../../', import.meta.url);
const argv = process.argv.slice(2);
const flag = name => argv.includes(name);
const opt = (name) => {
  const eq = argv.find(a => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const DIR = opt('--dir') || process.env.MIGRATION_DATA || join(ROOT, 'migration-data');
const DB_URL = process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const DRY = flag('--dry-run');

// ── Firebase uid → Supabase user id (UUID v5, stable across runs) ──
const UID_NAMESPACE = '6b1f2e5c-8a3d-4f0b-9c7e-1d2a3b4c5d6e';
export function uidFor(firebaseUid) {
  const ns = Buffer.from(UID_NAMESPACE.replace(/-/g, ''), 'hex');
  const h = createHash('sha1').update(Buffer.concat([ns, Buffer.from(String(firebaseUid), 'utf8')])).digest();
  h[6] = (h[6] & 0x0f) | 0x50; h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

const canon = v => JSON.stringify(sortDeep(toTagged(v)));
function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, sortDeep(v[k])]));
  return v;
}
const opts = { makeTimestamp: plainTimestamp };

/** The documents to load: { table, id, parentId, data } after the uid mapping. */
export function plan(exportData) {
  const problems = []; const skipped = {}; const docs = []; const uidMap = new Map(); const remapped = [];
  // Restoring a Supabase backup: ids are already Supabase's, accounts already
  // exist (the foreign keys check it at commit), and nothing is remapped.
  const restore = Boolean(exportData.restore);
  if (!restore) for (const u of exportData.authUsers) uidMap.set(u.uid, uidFor(u.uid));
  // A users/app_admins document needs a real account behind it (it is the
  // account's role). One without is reported, not invented.
  for (const name of restore ? [] : ['users', 'app_admins']) {
    for (const r of exportData.collections[name] || []) if (!uidMap.has(r.id)) problems.push(`${name}/${r.id}: لا حساب دخول بهذا المعرّف في Firebase Auth`);
  }
  const mapUid = (where, value) => {
    if (restore) return value;
    if (typeof value !== 'string' || !value) return value;
    if (!uidMap.has(value)) { problems.push(`${where}: يشير لحساب غير موجود ${value}`); return value; }
    remapped.push(where);
    return uidMap.get(value);
  };
  for (const [name, rows] of Object.entries(exportData.collections)) {
    if (NOT_MIGRATED[name]) { skipped[name] = { count: rows.length, reason: NOT_MIGRATED[name] }; continue; }
    let table;
    try { table = tableFor(name).table; } catch (e) { problems.push(e.message); continue; }
    for (const row of rows) {
      let { id } = row; const data = { ...row.data };
      if (!restore && (name === 'users' || name === 'app_admins')) id = uidMap.get(id);
      if (name === 'partners' && 'user_id' in data) data.user_id = mapUid(`partners/${row.id}.user_id`, data.user_id);
      if ((name === 'partner_mcp_keys' || name === 'partner_mcp_key_hashes') && 'ownerUid' in data) data.ownerUid = mapUid(`${name}/${row.id}.ownerUid`, data.ownerUid);
      docs.push({ table, id, parentId: null, data, source: `${name}/${row.id}` });
    }
  }
  for (const [group, rows] of Object.entries(exportData.groups)) {
    for (const row of rows) {
      const parts = row.path.split('/');
      if (parts.length !== 4) { problems.push(`${row.path}: عمق غير مدعوم`); continue; }
      let resolved;
      try { resolved = tableFor(parts.slice(0, 3).join('/')); } catch (e) { problems.push(`${e.message} (${group})`); continue; }
      docs.push({ table: resolved.table, id: row.id, parentId: resolved.parentId, data: row.data, source: row.path });
    }
  }
  return { docs, problems, skipped, uidMap, remapped };
}

async function ensureAuthUsers(authUsers, uidMap) {
  const url = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY مطلوب لإنشاء الحسابات (في سكربت النقل فقط).');
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  let created = 0; let existing = 0;
  for (const u of authUsers) {
    const id = uidMap.get(u.uid);
    const got = await fetch(`${url}/auth/v1/admin/users/${id}`, { headers });
    if (got.ok) { existing += 1; continue; }
    if (!u.email) throw new Error(`حساب بلا إيميل: ${u.uid}`);
    const res = await fetch(`${url}/auth/v1/admin/users`, {
      method: 'POST', headers,
      body: JSON.stringify({ id, email: u.email, email_confirm: true, user_metadata: { firebase_uid: u.uid, display_name: u.displayName || null }, ban_duration: u.disabled ? '876000h' : 'none' }),
    });
    if (!res.ok) throw new Error(`تعذّر إنشاء الحساب ${u.email}: ${res.status} ${await res.text()}`);
    created += 1;
  }
  return { created, existing };
}

async function insertMany(client, table, rows) {
  const cols = rowColumns(table);
  const per = Math.max(1, Math.floor(30000 / cols.length));
  for (let i = 0; i < rows.length; i += per) {
    const chunk = rows.slice(i, i + per); const values = []; const tuples = [];
    for (const row of chunk) {
      tuples.push(`(${cols.map(c => { values.push(c.type === 'json' ? (row[c.column] == null ? null : JSON.stringify(row[c.column])) : row[c.column] ?? null); return c.type === 'json' ? `$${values.length}::jsonb` : `$${values.length}`; }).join(', ')})`);
    }
    await client.query(`insert into public.${qi(table.table)} (${cols.map(c => qi(c.column)).join(', ')}) values ${tuples.join(', ')}`, values);
  }
}
async function insertLines(client, linesTable, lines) {
  const cols = ['entry_id', 'line_no', 'account_id', 'debit', 'credit', 'description', 'extra', 'shape'];
  for (let i = 0; i < lines.length; i += 3000) {
    const chunk = lines.slice(i, i + 3000); const values = []; const tuples = [];
    for (const l of chunk) {
      tuples.push(`(${cols.map(c => { values.push(['extra', 'shape'].includes(c) ? (l[c] == null ? null : JSON.stringify(l[c])) : l[c] ?? null); return ['extra', 'shape'].includes(c) ? `$${values.length}::jsonb` : `$${values.length}`; }).join(', ')})`);
    }
    await client.query(`insert into public.${qi(linesTable)} (${cols.map(qi).join(', ')}) values ${tuples.join(', ')}`, values);
  }
}

function financeHashState(docsBySource) {
  const state = new Map();
  for (const [source, data] of docsBySource) {
    if (!source.startsWith('finance_reviews/')) continue;
    const spec = FINANCE_KINDS[data.kind];
    const target = spec && docsBySource.get(`${spec.collection}/${data.sourceId}`);
    if (!target) { state.set(source, 'missing'); continue; }
    state.set(source, financeSourceHash({ ...target, id: data.sourceId }) === data.sourceHash ? 'match' : 'mismatch');
  }
  return state;
}

/** Everything decided before the database is touched: shared by both paths. */
function prepare(dir) {
  const exportData = readExport(dir);
  const { docs, problems, skipped, uidMap, remapped } = plan(exportData);
  if (problems.length) throw new Error(`لا يمكن الاستيراد:\n- ${problems.slice(0, 30).join('\n- ')}`);

  // Codec-level gate first: cheap, and names the document that fails.
  const encoded = new Map(); const lineRows = new Map();
  for (const d of docs) {
    const { row, lines } = encodeDocument(d.table, d.id, d.data, { parentId: d.parentId });
    const back = decodeDocument(d.table, JSON.parse(JSON.stringify(row)), lines && JSON.parse(JSON.stringify(lines)), opts);
    if (canon(back) !== canon(d.data)) throw new Error(`التحويل لا يعود حرفياً: ${d.source}`);
    if (!encoded.has(d.table.table)) encoded.set(d.table.table, []);
    encoded.get(d.table.table).push(row);
    if (lines?.length) lineRows.set(d.table.lines, [...(lineRows.get(d.table.lines) || []), ...lines]);
  }
  // Approval hashes over the source documents as exported (with Firestore uids).
  const sourceDocs = new Map();
  for (const [name, rows] of Object.entries(exportData.collections)) for (const r of rows) sourceDocs.set(`${name}/${r.id}`, decodeDocument({ columns: [] }, { extra: r.data }, null, opts));
  const hashesBefore = financeHashState(sourceDocs);
  return { exportData, docs, skipped, uidMap, remapped, encoded, lineRows, hashesBefore };
}

export async function runImport({ dir = DIR, dbUrl = DB_URL, dry = DRY, createUsers = true, log = console.log } = {}) {
  const { exportData, docs, skipped, uidMap, remapped, encoded, lineRows, hashesBefore } = prepare(dir);
  const report = { at: new Date().toISOString(), target: dbUrl.replace(/:[^:@/]+@/, ':***@'), tables: [], skipped, users: exportData.authUsers.length, remappedReferences: remapped.length };
  if (dry) { log('تشغيل تجريبي: نجح التحويل لكل المستندات، لم يُكتب شيء.'); return report; }

  report.restore = Boolean(exportData.restore);
  if (createUsers && !exportData.restore) report.auth = await ensureAuthUsers(exportData.authUsers, uidMap);

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  try {
    await client.query('begin');
    await client.query('set constraints all deferred');
    const appTables = [...SCHEMA.map(t => t.table), ...SCHEMA.filter(t => t.lines).map(t => t.lines), 'firebase_uid_map'];
    await client.query(`truncate ${appTables.map(t => `public.${qi(t)}`).join(', ')}`);
    const mapRows = exportData.restore
      ? exportData.uidMapRows.map(r => [r.firebase_uid, r.user_id, r.email ?? null])
      : [...uidMap].map(([fb, id]) => [fb, id, exportData.authUsers.find(u => u.uid === fb)?.email ?? null]);
    for (const row of mapRows) await client.query('insert into public.firebase_uid_map (firebase_uid, user_id, email) values ($1, $2, $3)', row);
    // Parents before children; FKs are deferred anyway.
    const order = [...SCHEMA].sort((a, b) => Number(Boolean(a.parentTable)) - Number(Boolean(b.parentTable)));
    for (const table of order) {
      const rows = encoded.get(table.table) || [];
      if (rows.length) await insertMany(client, table, rows);
      if (table.lines && lineRows.get(table.lines)?.length) await insertLines(client, table.lines, lineRows.get(table.lines));
    }

    // ── Gates inside the transaction: nothing commits unless all pass ──
    const expected = new Map([...encoded].map(([t, rows]) => [t, rows.length]));
    for (const table of SCHEMA) {
      const { rows: [{ n }] } = await client.query(`select count(*)::int as n from public.${qi(table.table)}`);
      const want = expected.get(table.table) || 0;
      report.tables.push({ collection: table.collection, table: table.table, firebase: want, supabase: n });
      if (n !== want) throw new Error(`العدد لا يطابق في ${table.table}: ${n} ≠ ${want}`);
    }
    // Round trip through the database itself.
    const bySource = new Map(docs.map(d => [`${d.table.table}|${d.parentId ?? ''}|${d.id}`, d]));
    let checked = 0;
    for (const table of SCHEMA) {
      for (const back of await readDocuments(client, table, opts)) {
        const src = bySource.get(`${table.table}|${back.parentId ?? ''}|${back.id}`);
        if (!src || canon(back.data) !== canon(src.data)) throw new Error(`المستند لا يعود من القاعدة حرفياً: ${src?.source || `${table.table}/${back.id}`}`);
        checked += 1;
      }
    }
    report.roundTrip = { checked, of: docs.length };
    if (checked !== docs.length) throw new Error(`قُرئ ${checked} من ${docs.length}`);
    const { rows: [ledger] } = await client.query(`select coalesce(sum(l.debit), 0)::text as debit, coalesce(sum(l.credit), 0)::text as credit
      from public.journal_entry_lines l join public.journal_entries e on e.id = l.entry_id where e.status in ('posted', 'reversed')`);
    report.ledger = ledger;
    if (ledger.debit !== ledger.credit) throw new Error(`الدفتر غير متوازن بعد الاستيراد: ${ledger.debit} ≠ ${ledger.credit}`);
    await client.query('set constraints all immediate'); // the balance triggers and FKs, now
    const imported = new Map(); // finance hashes on what the database returns, with original uids
    for (const name of ['finance_reviews', ...Object.values(FINANCE_KINDS).map(s => s.collection)]) {
      const t = tableFor(name).table;
      for (const back of await readDocuments(client, t, opts)) imported.set(`${name}/${back.id}`, back.data);
    }
    const hashesAfter = financeHashState(imported);
    for (const [k, v] of hashesBefore) if (hashesAfter.get(k) !== v) throw new Error(`بصمة الاعتماد تغيّرت: ${k} (${v} → ${hashesAfter.get(k)})`);
    report.financeHashes = { reviews: hashesBefore.size, match: [...hashesBefore.values()].filter(v => v === 'match').length };
    await client.query('commit');
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally { await client.end(); }

  return writeReport(dir, report, skipped, log);
}

// ═══ The same import over raw SQL: HTTPS (Management API) or its local twin ═══
// No direct Postgres here, so no transaction can span requests. The data goes
// first to a private staging schema (the live tables untouched), is read back
// and compared document by document, and then ONE request swaps it in:
// truncate, copy, and every gate — counts, live = staged row for row, ledger
// balance, all deferred keys — inside that single implicit transaction. Any
// failure there leaves the live tables exactly as they were.
const STAGE = 'migration_stage';
const SQL_BATCH = 900_000;     // characters of SQL per request
const READ_PAGE = 250;         // rows per read-back request
const LINE_SPEC = [{ column: 'entry_id' }, { column: 'line_no', type: 'int' }, ...LINE_COLUMNS, { column: 'extra', type: 'json' }, { column: 'shape', type: 'json' }];
const valueSql = (col, v) => (col.type === 'json' ? (v == null ? 'null' : `${literal(JSON.stringify(v))}::jsonb`) : literal(v ?? null));
// Read back exactly as the pg driver returns rows: integers, booleans and
// jsonb as themselves; numerics, bigints and instants as their text.
const readSql = col => (['int', 'bool', 'json'].includes(col.type) ? qi(col.column) : `${qi(col.column)}::text as ${qi(col.column)}`);

async function uploadRows(sql, tableName, cols, rows) {
  const head = `insert into ${STAGE}.${qi(tableName)} (${cols.map(c => qi(c.column)).join(', ')}) values `;
  let tuples = []; let size = 0;
  const flush = async () => { if (tuples.length) await sql.run(`${head}${tuples.join(', ')} on conflict do nothing`); tuples = []; size = 0; };
  for (const row of rows) {
    const tuple = `(${cols.map(c => valueSql(c, row[c.column])).join(', ')})`;
    if (size + tuple.length > SQL_BATCH) await flush();
    tuples.push(tuple); size += tuple.length;
  }
  await flush();
}
async function readPaged(sql, schema, tableName, cols, order) {
  const out = [];
  for (let offset = 0; ; offset += READ_PAGE) {
    const [{ page }] = await sql.run(`select coalesce(json_agg(r), '[]')::text as page from (select ${cols.map(readSql).join(', ')}
      from ${schema}.${qi(tableName)} order by ${order} limit ${READ_PAGE} offset ${offset}) r`);
    const rows = JSON.parse(page);
    out.push(...rows);
    if (rows.length < READ_PAGE) return out;
  }
}
/** Every document of `schema`, decoded as readDocuments does: Map key → { id, parentId, data }. */
async function readBack(sql, schema) {
  const out = new Map();
  for (const table of SCHEMA) {
    let linesBy = new Map();
    if (table.lines) {
      for (const l of await readPaged(sql, schema, table.lines, LINE_SPEC, 'entry_id collate "C", line_no')) {
        linesBy.set(l.entry_id, [...(linesBy.get(l.entry_id) || []), l]);
      }
    }
    const order = table.parentTable ? 'parent_ref collate "C", id collate "C"' : 'id collate "C"';
    for (const r of await readPaged(sql, schema, table.table, rowColumns(table), order)) {
      out.set(`${table.table}|${r.parent_ref ?? ''}|${r.id}`, { id: r.id, parentId: r.parent_ref ?? null, data: decodeDocument(table, r, linesBy.get(r.id), opts), table });
    }
  }
  return out;
}
function roundTrip(docs, back, where) {
  const bySource = new Map(docs.map(d => [`${d.table.table}|${d.parentId ?? ''}|${d.id}`, d]));
  let checked = 0;
  for (const [key, b] of back) {
    const src = bySource.get(key);
    if (!src || canon(b.data) !== canon(src.data)) throw new Error(`المستند لا يعود من ${where} حرفياً: ${src?.source || key}`);
    checked += 1;
  }
  if (checked !== docs.length) throw new Error(`قُرئ من ${where} ${checked} من ${docs.length}`);
  return checked;
}
function hashesOf(back) {
  const docs = new Map();
  for (const name of ['finance_reviews', ...Object.values(FINANCE_KINDS).map(s => s.collection)]) {
    const t = tableFor(name).table;
    for (const b of back.values()) if (b.table === t) docs.set(`${name}/${b.id}`, b.data);
  }
  return financeHashState(docs);
}

export async function runImportViaSql({ dir = DIR, sql, dry = DRY, createUsers = true, log = console.log } = {}) {
  const { exportData, docs, skipped, uidMap, remapped, encoded, lineRows, hashesBefore } = prepare(dir);
  const report = { at: new Date().toISOString(), target: sql.target, transport: sql.name, tables: [], skipped, users: exportData.authUsers.length, remappedReferences: remapped.length };
  if (dry) { log('تشغيل تجريبي: نجح التحويل لكل المستندات، لم يُكتب شيء.'); return report; }
  report.restore = Boolean(exportData.restore);
  if (createUsers && !exportData.restore) report.auth = await ensureAuthUsers(exportData.authUsers, uidMap);

  const lineTables = SCHEMA.filter(t => t.lines).map(t => t.lines);
  const appTables = [...SCHEMA.map(t => t.table), ...lineTables, 'firebase_uid_map'];
  let swapped = false;
  try {
    // ── 1. Staging: private, the live tables untouched ──
    await sql.run([`drop schema if exists ${STAGE} cascade`, `create schema ${STAGE}`, `revoke all on schema ${STAGE} from public`,
      ...[...SCHEMA.map(t => t.table), ...lineTables].map(t => `create table ${STAGE}.${qi(t)} (like public.${qi(t)} including defaults including indexes)`)].join(';\n'));
    for (const table of SCHEMA) if (encoded.get(table.table)?.length) await uploadRows(sql, table.table, rowColumns(table), encoded.get(table.table));
    for (const lt of lineTables) if (lineRows.get(lt)?.length) await uploadRows(sql, lt, LINE_SPEC, lineRows.get(lt));

    // ── 2. Staged documents read back and compared, before anything goes live ──
    const staged = await readBack(sql, STAGE);
    roundTrip(docs, staged, 'المرحلة المؤقتة');
    const stagedHashes = hashesOf(staged);
    for (const [k, v] of hashesBefore) if (stagedHashes.get(k) !== v) throw new Error(`بصمة الاعتماد تغيّرت: ${k} (${v} → ${stagedHashes.get(k)})`);

    // ── 3. One request, one transaction: swap in, then every gate ──
    const mapRows = exportData.restore
      ? exportData.uidMapRows.map(r => [r.firebase_uid, r.user_id, r.email ?? null])
      : [...uidMap].map(([fb, id]) => [fb, id, exportData.authUsers.find(u => u.uid === fb)?.email ?? null]);
    const order = [...SCHEMA].sort((a, b) => Number(Boolean(a.parentTable)) - Number(Boolean(b.parentTable)));
    const copy = (name, cols) => `insert into public.${qi(name)} (${cols}) select ${cols} from ${STAGE}.${qi(name)}`;
    const same = (name, cols) => `if exists (select ${cols} from public.${qi(name)} except all select ${cols} from ${STAGE}.${qi(name)})
      or exists (select ${cols} from ${STAGE}.${qi(name)} except all select ${cols} from public.${qi(name)}) then
      raise exception 'الجدول % لا يطابق ما رُفع', ${literal(name)}; end if;`;
    const count = (name, n) => `if (select count(*) from public.${qi(name)}) <> ${Number(n)} then
      raise exception 'العدد لا يطابق في %: % ≠ %', ${literal(name)}, (select count(*) from public.${qi(name)}), ${Number(n)}; end if;`;
    const swap = ['set constraints all deferred', `truncate ${appTables.map(t => `public.${qi(t)}`).join(', ')}`];
    if (mapRows.length) swap.push(`insert into public.firebase_uid_map (firebase_uid, user_id, email) values ${mapRows.map(r => `(${r.map(literal).join(', ')})`).join(', ')}`);
    const gates = [count('firebase_uid_map', mapRows.length)];
    for (const table of order) {
      const cols = rowColumns(table).map(c => qi(c.column)).join(', ');
      swap.push(copy(table.table, cols));
      gates.push(count(table.table, encoded.get(table.table)?.length || 0), same(table.table, cols));
      if (table.lines) {
        const lcols = LINE_SPEC.map(c => qi(c.column)).join(', ');
        swap.push(copy(table.lines, lcols));
        gates.push(count(table.lines, lineRows.get(table.lines)?.length || 0), same(table.lines, lcols));
      }
    }
    gates.push(`if (select coalesce(sum(l.debit), 0) <> coalesce(sum(l.credit), 0) from public.journal_entry_lines l
      join public.journal_entries e on e.id = l.entry_id where e.status in ('posted', 'reversed')) then
      raise exception 'الدفتر غير متوازن بعد الاستيراد'; end if;`);
    swap.push(`do $gate$ begin\n${gates.join('\n')}\nend $gate$`, 'set constraints all immediate');
    await sql.run(swap.join(';\n'));
    swapped = true;

    // ── 4. Committed: the report, from the live tables ──
    const [{ counts }] = await sql.run(`select json_object_agg(t, n)::text as counts from (${SCHEMA.map(t => `select ${literal(t.table)} as t, count(*) as n from public.${qi(t.table)}`).join(' union all ')}) c`);
    const live = JSON.parse(counts);
    for (const table of SCHEMA) {
      const want = encoded.get(table.table)?.length || 0;
      report.tables.push({ collection: table.collection, table: table.table, firebase: want, supabase: Number(live[table.table]) });
      if (Number(live[table.table]) !== want) throw new Error(`العدد لا يطابق في ${table.table} بعد التثبيت: ${live[table.table]} ≠ ${want}`);
    }
    const back = await readBack(sql, 'public');
    report.roundTrip = { checked: roundTrip(docs, back, 'القاعدة'), of: docs.length };
    const [ledger] = await sql.run(`select coalesce(sum(l.debit), 0)::text as debit, coalesce(sum(l.credit), 0)::text as credit
      from public.journal_entry_lines l join public.journal_entries e on e.id = l.entry_id where e.status in ('posted', 'reversed')`);
    report.ledger = ledger;
    const hashesAfter = hashesOf(back);
    for (const [k, v] of hashesBefore) if (hashesAfter.get(k) !== v) throw new Error(`بصمة الاعتماد تغيّرت: ${k} (${v} → ${hashesAfter.get(k)})`);
    report.financeHashes = { reviews: hashesBefore.size, match: [...hashesBefore.values()].filter(v => v === 'match').length };
  } catch (e) {
    // After the swap the live tables hold the new data: say so, never «nothing changed».
    if (swapped) e.message = `ثُبّتت البيانات، ثم فشل التحقق بعدها: ${e.message}`;
    throw e;
  } finally {
    await sql.run(`drop schema if exists ${STAGE} cascade`).catch(() => {});
  }
  return writeReport(dir, report, skipped, log);
}

function writeReport(dir, report, skipped, log) {
  const md = ['| المجموعة | الجدول | العدد في Firebase | العدد في Supabase |', '|---|---|---:|---:|',
    ...report.tables.filter(t => t.firebase || t.supabase).map(t => `| ${t.collection} | ${t.table} | ${t.firebase} | ${t.supabase} ${t.firebase === t.supabase ? '✓' : '✗'} |`),
    ...Object.entries(skipped).map(([n, s]) => `| ${n} | — | ${s.count} | لم يُنقل: ${s.reason} |`)];
  writeFileSync(join(dir, 'import-report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  writeFileSync(join(dir, 'import-report.md'), `${md.join('\n')}\n`, { mode: 0o600 });
  log(md.join('\n'));
  log(`\nذهاب وإياب: ${report.roundTrip.checked}/${report.roundTrip.of} · الدفتر ${report.ledger.debit} = ${report.ledger.credit} · بصمات الاعتماد ${report.financeHashes.match}/${report.financeHashes.reviews}`);
  return report;
}

if (isMainModule(import.meta.url)) {
  // --via api --project <ref>: over HTTPS with SUPABASE_ACCESS_TOKEN (no direct Postgres).
  // --via sql: the same raw-SQL path on SUPABASE_DB_URL (its local rehearsal).
  const via = opt('--via');
  const run = !via ? runImport()
    : runImportViaSql({ sql: via === 'api' ? managementApiTransport({ ref: opt('--project'), token: process.env.SUPABASE_ACCESS_TOKEN }) : pgSqlTransport(DB_URL) });
  run.catch((e) => { console.error(`\n✗ ${e.message}${/^ثُبّتت/.test(e.message) ? '' : '\nلم يُثبَّت شيء في الجداول الحية.'}`); process.exit(1); });
}
