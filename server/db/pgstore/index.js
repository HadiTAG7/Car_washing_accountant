// ═══════════════════════════════════════════════════════════════════════════
// pgstore — نفس واجهة firebase-admin/firestore التي يستعملها الخادم، فوق Postgres
// ═══════════════════════════════════════════════════════════════════════════
// كل عملية خادم (functions/src/handlers.js) تستلم `db` معاملاً، فتشتغل كما هي
// حرفياً: نفس القيود، نفس الرواتب، نفس الأرقام. المدعوم هو ما يستعمله الكود
// فعلاً (مسح بـgrep)، وأي شيء خارجه يرمي خطأً صريحاً بدل أن ينحرف بصمت.
//
// المعاملات: SERIALIZABLE، والمستند المقروء داخلها يُقفل (FOR NO KEY UPDATE) فيتسلسل
// عدّاد القيود، والكتابات تُجمع وتُطبَّق عند الإنهاء، وعند التعارض تُعاد
// الدالة كلها كما يفعل Firestore. وكل serverTimestamp في عملية واحدة = لحظة واحدة.
// ═══════════════════════════════════════════════════════════════════════════

import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { tableFor, hasTableFor, SCHEMA } from '../../../src/lib/data/schema/registry.js';
import { encodeDocument, decodeDocument, isoToTs } from '../../../src/lib/data/schema/codec.js';
import { qi, rowColumns, insertRowSql, insertLineSql } from '../rows.js';
import { compileQuery, DOCUMENT_ID, UnsupportedInPgStore } from './query.js';
import { Timestamp, makeTimestamp } from './timestamp.js';

export { Timestamp, UnsupportedInPgStore };
// A stored reference reads back as a reference on the same store.
const decodeOpts = store => ({ makeTimestamp, makeRef: path => new DocumentReference(store, path) });
const NOT_FOUND = 5; const ALREADY_EXISTS = 6;

const lit = v => `'${String(v).replace(/'/g, "''")}'`;

// ── FieldValue / FieldPath ──
class FieldValueSentinel { constructor(kind) { this.kind = kind; } isEqual(o) { return o instanceof FieldValueSentinel && o.kind === this.kind; } }
// firebase-admin's own sentinels too: a few server files import FieldValue from
// it directly, and in Supabase mode their writes land here. Recognised by the
// SDK's public `methodName`; anything but these two still refuses loudly.
const ADMIN_SENTINELS = { 'FieldValue.serverTimestamp': 'serverTimestamp', 'FieldValue.delete': 'delete' };
function sentinelKind(v) {
  if (v instanceof FieldValueSentinel) return v.kind;
  if (!v || typeof v !== 'object' || typeof v.methodName !== 'string' || !v.methodName.startsWith('FieldValue.')) return null;
  const kind = ADMIN_SENTINELS[v.methodName];
  if (!kind) throw new UnsupportedInPgStore(v.methodName);
  return kind;
}
export const FieldValue = {
  serverTimestamp: () => new FieldValueSentinel('serverTimestamp'),
  delete: () => new FieldValueSentinel('delete'),
  increment: () => { throw new UnsupportedInPgStore('FieldValue.increment'); },
  arrayUnion: () => { throw new UnsupportedInPgStore('FieldValue.arrayUnion'); },
  arrayRemove: () => { throw new UnsupportedInPgStore('FieldValue.arrayRemove'); },
};
export class FieldPath {
  constructor(...segments) { this.segments = segments; }
  static documentId() { return new FieldPath(DOCUMENT_ID); }
  toString() { return this.segments.join('.'); }
}
const fieldName = f => (f instanceof FieldPath ? f.toString() : String(f));

function firestoreError(code, name, message) {
  const e = new Error(`${code} ${name}: ${message}`);
  e.code = code; e.details = message;
  return e;
}

const AUTO_ID = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export function autoId() {
  let id = '';
  while (id.length < 20) for (const b of randomBytes(40)) if (b < 248 && id.length < 20) id += AUTO_ID[b % 62];
  return id;
}

// Values that are whole in themselves: never walked into, merged or cloned field by field.
const isLeaf = v => v instanceof Timestamp || v instanceof Date || v instanceof DocumentReference || v instanceof Uint8Array;
function deepClone(v) {
  if (v === null || typeof v !== 'object' || v instanceof Timestamp || v instanceof DocumentReference) return v;
  if (Array.isArray(v)) return v.map(deepClone);
  if (v instanceof Uint8Array) return new Uint8Array(v);
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepClone(x)]));
}
function getPath(obj, path) {
  let cur = obj;
  for (const seg of fieldName(path).split('.')) {
    if (cur === null || typeof cur !== 'object' || !Object.hasOwn(cur, seg)) return undefined;
    cur = cur[seg];
  }
  return cur;
}

// ── Snapshots ──
export class DocumentSnapshot {
  constructor(ref, data, version = null) {
    this.ref = ref; this.id = ref.id; this._data = data; this.exists = data !== undefined;
    // Not a clock: the row's version shaped as a Timestamp, so updateTime.isEqual
    // holds exactly while the document is unchanged — all it is used for.
    if (this.exists && version != null) this.updateTime = new Timestamp(Number(version), 0);
  }
  data() { return this._data === undefined ? undefined : deepClone(this._data); }
  get(path) { return this._data === undefined ? undefined : deepClone(getPath(this._data, path)); }
  isEqual(o) { return o instanceof DocumentSnapshot && o.ref.path === this.ref.path && JSON.stringify(o._data) === JSON.stringify(this._data); }
}
class QuerySnapshot {
  constructor(docs) { this.docs = docs; this.size = docs.length; this.empty = docs.length === 0; }
  forEach(fn, thisArg) { this.docs.forEach(fn, thisArg); }
}

// ── Paths ──
function splitPath(path) { return String(path).split('/').filter(Boolean); }
function locate(collectionPath) {
  const { table, parentId } = tableFor(collectionPath);
  return { table, parentId };
}

// ── References and queries ──
class Query {
  constructor(store, collectionPath, state = {}) {
    this.firestore = store; this._path = collectionPath;
    this._q = { filters: [], orders: [], limit: null, cursor: null, select: null, ...state };
  }
  _with(patch) { return new Query(this.firestore, this._path, { ...this._q, ...patch }); }
  where(field, op, value) {
    if (value === undefined) throw new Error('Value for argument "value" is not a valid query constraint. Cannot use "undefined" as a Firestore value.');
    return this._with({ filters: [...this._q.filters, { field: fieldName(field), op, value }] });
  }
  orderBy(field, dir = 'asc') { return this._with({ orders: [...this._q.orders, { field: fieldName(field), dir: dir === 'desc' ? 'desc' : 'asc' }] }); }
  limit(n) { return this._with({ limit: n }); }
  startAfter(...values) { return this._with({ cursor: values }); }
  select(...fields) { return this._with({ select: fields.map(fieldName) }); }
  offset() { throw new UnsupportedInPgStore('offset'); }
  limitToLast() { throw new UnsupportedInPgStore('limitToLast'); }
  startAt() { throw new UnsupportedInPgStore('startAt'); }
  endAt() { throw new UnsupportedInPgStore('endAt'); }
  endBefore() { throw new UnsupportedInPgStore('endBefore'); }
  onSnapshot() { throw new UnsupportedInPgStore('onSnapshot on the server'); }
  // A collection with no table can hold nothing (writes to it refuse), so reading it finds nothing — as in Firestore.
  get() {
    if (!hasTableFor(this._path)) return Promise.resolve(new QuerySnapshot([]));
    return this.firestore._read(client => runQuery(this.firestore, client, this, false));
  }
  count() {
    if (!hasTableFor(this._path)) return { get: async () => ({ data: () => ({ count: 0 }) }) };
    return { get: () => this.firestore._read(async (client) => {
      const { table, parentId } = locate(this._path);
      const sql = compileQuery(table, { parentId, filters: this._q.filters, count: true });
      const { rows: [{ n }] } = await client.query(sql);
      return { data: () => ({ count: n }) };
    }) };
  }
}

export class CollectionReference extends Query {
  constructor(store, path) {
    super(store, path);
    const parts = splitPath(path);
    this.id = parts.at(-1); this.path = parts.join('/');
    this.parent = parts.length > 1 ? new DocumentReference(store, parts.slice(0, -1).join('/')) : null;
  }
  doc(id = autoId()) { return new DocumentReference(this.firestore, `${this.path}/${id}`); }
  async add(data) { const ref = this.doc(); await ref.create(data); return ref; }
  listDocuments() { throw new UnsupportedInPgStore('listDocuments'); }
}

export class DocumentReference {
  constructor(store, path) {
    const parts = splitPath(path);
    if (parts.length % 2) throw new Error(`Value for argument "documentPath" must point to a document, but was "${path}".`);
    this.firestore = store; this.path = parts.join('/'); this.id = parts.at(-1);
    this._collectionPath = parts.slice(0, -1).join('/');
  }
  get parent() { return new CollectionReference(this.firestore, this._collectionPath); }
  get __docRef() { return true; } // stored as a reference value (codec.toTagged)
  collection(name) { return new CollectionReference(this.firestore, `${this.path}/${name}`); }
  isEqual(o) { return o instanceof DocumentReference && o.path === this.path; }
  get() {
    if (!hasTableFor(this._collectionPath)) return Promise.resolve(new DocumentSnapshot(this, undefined));
    return this.firestore._read(client => readDoc(this.firestore, client, this, false));
  }
  set(data, options) { return this.firestore._write([{ type: 'set', ref: this, data, merge: Boolean(options?.merge) }]); }
  update(data) { return this.firestore._write([{ type: 'update', ref: this, data }]); }
  create(data) { return this.firestore._write([{ type: 'create', ref: this, data }]); }
  delete() { return this.firestore._write([{ type: 'delete', ref: this, reset: isTestReset(this.firestore) }]); }
  listCollections() { throw new UnsupportedInPgStore('listCollections'); }
}

// ── Reading ──
// FOR UPDATE needs UPDATE privilege; the audit log is insert-only for the
// server, so its existence check reads without a lock (the key still guards).
const NO_ROW_LOCK = new Set(['audit_logs']);
const keyOf = (table, ref, parentId) => ({
  where: table.parentTable ? 'id = $1 and parent_ref = $2' : 'id = $1',
  params: table.parentTable ? [ref.id, parentId] : [ref.id],
});
async function loadRow(client, ref, wantLock, store) {
  const { table, parentId } = locate(ref._collectionPath);
  const lock = wantLock && await lockable(client, store, table.table);
  const { where, params } = keyOf(table, ref, parentId);
  const { rows } = await client.query(`select *, xmin::text as "__v" from public.${qi(table.table)} where ${where}${lock ? ' for no key update' : ''}`, params);
  if (!rows.length) return { table, parentId, row: null, lines: [], version: null };
  let lines = [];
  if (table.lines) lines = (await client.query(`select * from public.${qi(table.lines)} where entry_id = $1 order by line_no${lock ? ' for no key update' : ''}`, [ref.id])).rows;
  return { table, parentId, row: rows[0], lines, version: rows[0].__v };
}
async function readDoc(store, client, ref, lock, tx = null) {
  if (!hasTableFor(ref._collectionPath)) return new DocumentSnapshot(ref, undefined);
  const { table, parentId, row, lines, version } = await loadRow(client, ref, lock, store);
  if (tx) tx._noteRead(ref, table, parentId, version);
  return new DocumentSnapshot(ref, row ? decodeDocument(table, row, lines, decodeOpts(store)) : undefined, version);
}
function project(data, fields) {
  if (!fields) return data;
  const out = {};
  for (const f of fields) {
    const v = getPath(data, f);
    if (v === undefined) continue;
    const segs = f.split('.'); let cur = out;
    segs.slice(0, -1).forEach((s) => { cur[s] = cur[s] && typeof cur[s] === 'object' ? cur[s] : {}; cur = cur[s]; });
    cur[segs.at(-1)] = v;
  }
  return out;
}
async function runQuery(store, client, query, tx = null) {
  if (!hasTableFor(query._path)) return new QuerySnapshot([]);
  const { table, parentId } = locate(query._path);
  let cursor = query._q.cursor;
  if (cursor && cursor.length === 1 && cursor[0] instanceof DocumentSnapshot) {
    const snap = cursor[0];
    const probe = compileQuery(table, { parentId, filters: query._q.filters, orders: query._q.orders });
    cursor = probe.effective.map(o => (o.field === DOCUMENT_ID ? snap.id : snap.get(o.field)));
  }
  const sql = compileQuery(table, { parentId, filters: query._q.filters, orders: query._q.orders, cursor, limit: query._q.limit, versions: true });
  const { rows } = await client.query(sql);
  if (tx) tx._noteQuery(sql, rows);
  let linesBy = new Map();
  if (table.lines && rows.length) {
    const { rows: lineRows } = await client.query(`select * from public.${qi(table.lines)} where entry_id = any($1) order by entry_id, line_no`, [rows.map(r => r.id)]);
    linesBy = lineRows.reduce((m, l) => m.set(l.entry_id, [...(m.get(l.entry_id) || []), l]), new Map());
  }
  const coll = new CollectionReference(store, query._path);
  return new QuerySnapshot(rows.map(r => new DocumentSnapshot(coll.doc(r.id), project(decodeDocument(table, r, linesBy.get(r.id), decodeOpts(store)), query._q.select), r.__v)));
}

// ── Writing ──
function assertNoUndefined(value, path = '') {
  if (value === undefined) throw new Error(`Value for argument "data" is not a valid Firestore document. Cannot use "undefined" as a Firestore value${path ? ` (found in field "${path}")` : ''}. If you want to ignore undefined values, enable \`ignoreUndefinedProperties\`.`);
  if (value && typeof value === 'object' && !isLeaf(value) && !sentinelKind(value)) {
    for (const [k, v] of Object.entries(value)) assertNoUndefined(v, path ? `${path}.${k}` : k);
  }
}
const DELETE = new FieldValueSentinel('delete');
function resolve(value, now, { allowDelete }) {
  const kind = sentinelKind(value);
  if (kind === 'serverTimestamp') return now;
  if (kind === 'delete') {
    if (!allowDelete) throw new Error('FieldValue.delete() must appear at the top-level and can only be used in update() or set() with {merge:true}.');
    return DELETE;
  }
  if (value === null || typeof value !== 'object' || isLeaf(value)) return value;
  if (Array.isArray(value)) return value.map(v => resolve(v, now, { allowDelete: false }));
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v, now, { allowDelete })]));
}
const isDelete = v => sentinelKind(v) === 'delete';
function mergeDeep(target, patch) {
  const out = { ...target };
  for (const [k, v] of Object.entries(patch)) {
    if (isDelete(v)) { delete out[k]; continue; }
    const plain = v && typeof v === 'object' && !Array.isArray(v) && !isLeaf(v);
    out[k] = plain && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k]) && !isLeaf(out[k]) ? mergeDeep(out[k], v) : v;
  }
  return out;
}

// Append-only for the trusted server too: no DELETE grant, and the ledger's
// triggers refuse it. Only a test reset (never production) empties them.
const APPEND_ONLY = new Set(['journal_entries', 'journal_lines_legacy', 'audit_logs', 'sweater_raw_payloads',
  'executive_report_revisions', 'finance_report_revisions', 'operations_report_revisions', 'partner_worker_eligibility_audit']);
// Test resets only: Firestore has no foreign keys, so a test wipes collections
// in any order. Here a reset delete removes what references the row first.
let fkCache = null;
async function referencing(client, tableName) {
  if (!fkCache) {
    const { rows } = await client.query(`select c.conrelid::regclass::text as child, a.attname as col, c.confrelid::regclass::text as parent, af.attname as parent_col,
        not a.attnotnull as nullable
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      join pg_attribute af on af.attrelid = c.confrelid and af.attnum = c.confkey[1]
      where c.contype = 'f' and c.connamespace = 'public'::regnamespace and array_length(c.conkey, 1) = 1`);
    fkCache = rows.map(r => ({ ...r, child: r.child.replace(/^public\./, '').replace(/"/g, ''), parent: r.parent.replace(/^public\./, '').replace(/"/g, '') }));
  }
  return fkCache.filter(f => f.parent === tableName);
}
async function cascadeDelete(client, tableName, col, value, seen) {
  const key = `${tableName}|${col}|${value}`;
  if (seen.has(key)) return;
  seen.add(key);
  for (const fk of await referencing(client, tableName)) {
    const { rows } = await client.query(`select ${qi(fk.parent_col)} as v from public.${qi(tableName)} where ${qi(col)} = $1`, [value]);
    for (const r of rows) {
      if (fk.nullable) {
        // A reference that may be empty is emptied (it breaks cycles such as
        // an entry and its reversal pointing at each other).
        await client.query(`update public.${qi(fk.child)} set ${qi(fk.col)} = null where ${qi(fk.col)} = $1`, [r.v]);
        continue;
      }
      const { rows: kids } = await client.query(`select ctid::text as ctid, * from public.${qi(fk.child)} where ${qi(fk.col)} = $1`, [r.v]);
      for (const kid of kids) {
        if (kid.id !== undefined) await cascadeDelete(client, fk.child, 'id', kid.id, seen);
        await client.query(`delete from public.${qi(fk.child)} where ctid = $1::tid`, [kid.ctid]);
      }
    }
  }
}
// A reset is a delete a test file issues itself — wiping fixtures between
// cases. A delete reached through application code (functions/src, server/)
// is never one: it meets the same keys and triggers as in production.
const PGSTORE_DIR = new URL('.', import.meta.url).pathname;
function isTestReset(store) {
  if (!store?._testResets) return false;
  for (const frame of String(new Error().stack).split('\n').slice(1)) {
    if (frame.includes(PGSTORE_DIR) || frame.includes('node:') || frame.includes('/node_modules/') || frame.includes('<anonymous>')) continue;
    return /\/(test|__tests__)\/|\.test\.[cm]?[jt]sx?/.test(frame);
  }
  return false;
}
async function testResetDelete(client, store, table, where, keyParams, id) {
  await client.query('set local role postgres');
  // Checked now: deferred checks left pending must not be skipped by the
  // switch below. Then, for this transaction only, the append-only triggers
  // stand aside (replica mode) — no table lock, unlike ALTER TABLE.
  await client.query('set constraints all immediate');
  await client.query('set local session_replication_role = replica');
  await cascadeDelete(client, table.table, 'id', id, new Set());
  await client.query(`delete from public.${qi(table.table)} where ${where}`, keyParams);
  await client.query('set local session_replication_role = origin');
  if (store._role) await client.query(`set local role ${qi(store._role)}`);
}

async function persist(client, table, parentId, id, before, data, store, reset = false) {
  const where = table.parentTable ? `id = $1 and parent_ref = $2` : 'id = $1';
  const keyParams = table.parentTable ? [id, parentId] : [id];
  if (data === null) {
    if (!before) return;
    if (reset) return testResetDelete(client, store, table, where, keyParams, id);
    await client.query(`delete from public.${qi(table.table)} where ${where}`, keyParams);
    return;
  }
  const { row, lines } = encodeDocument(table, id, data, { parentId });
  if (!before) {
    await client.query(insertRowSql(table, row));
  } else {
    const cols = rowColumns(table).filter(c => c.column !== 'id' && c.column !== 'parent_ref');
    const values = cols.map(c => (c.type === 'json' ? (row[c.column] == null ? null : JSON.stringify(row[c.column])) : row[c.column] ?? null));
    const sets = cols.map((c, i) => `${qi(c.column)} = $${i + 1 + keyParams.length}${c.type === 'json' ? '::jsonb' : ''}`);
    await client.query(`update public.${qi(table.table)} set ${sets.join(', ')} where ${where}`, [...keyParams, ...values]);
  }
  if (table.lines) {
    const old = before ? (await client.query(`select * from public.${qi(table.lines)} where entry_id = $1 order by line_no`, [id])).rows : [];
    const next = lines || [];
    for (let i = 0; i < Math.max(old.length, next.length); i += 1) {
      if (i >= next.length) { await client.query(`delete from public.${qi(table.lines)} where entry_id = $1 and line_no = $2`, [id, i]); continue; }
      if (i >= old.length) { await client.query(insertLineSql(table.lines, next[i])); continue; }
      const l = next[i];
      await client.query(`update public.${qi(table.lines)} set account_id = $3, debit = $4, credit = $5, description = $6, extra = $7::jsonb, shape = $8::jsonb
        where entry_id = $1 and line_no = $2 and (account_id, debit, credit, description, extra, shape) is distinct from ($3, $4::numeric, $5::numeric, $6, $7::jsonb, $8::jsonb)`,
      [id, i, l.account_id, l.debit, l.credit, l.description, JSON.stringify(l.extra), l.shape == null ? null : JSON.stringify(l.shape)]);
    }
  }
}

async function applyWrites(client, writes, store) {
  if (!writes.length) return [];
  const { rows: [{ t }] } = await client.query('select clock_timestamp()::text as t');
  const ts = isoToTs(t); const now = new Timestamp(ts.s, ts.n);
  const state = new Map(); // path → { table, parentId, before (exists in db), data|null }
  for (const w of writes) {
    if (!state.has(w.ref.path)) {
      const { table, parentId, row, lines } = await loadRow(client, w.ref, true, store);
      state.set(w.ref.path, { table, parentId, before: Boolean(row), data: row ? decodeDocument(table, row, lines, decodeOpts(store)) : null });
    }
    const s = state.get(w.ref.path);
    if (w.type !== 'delete') assertNoUndefined(w.data);
    if (w.type === 'create') {
      if (s.data) throw firestoreError(ALREADY_EXISTS, 'ALREADY_EXISTS', `Document already exists: ${w.ref.path}`);
      s.data = resolve(w.data, now, { allowDelete: false });
    } else if (w.type === 'set') {
      const patch = resolve(w.data, now, { allowDelete: w.merge });
      s.data = w.merge ? mergeDeep(s.data || {}, patch) : patch;
    } else if (w.type === 'update') {
      if (!s.data) throw firestoreError(NOT_FOUND, 'NOT_FOUND', `No document to update: ${w.ref.path}`);
      const patch = resolve(w.data, now, { allowDelete: true });
      const next = { ...s.data };
      for (const [k, v] of Object.entries(patch)) {
        if (k.includes('.')) throw new UnsupportedInPgStore(`update() with a dotted field path (${k})`);
        if (isDelete(v)) delete next[k]; else next[k] = v;
      }
      s.data = next;
    } else if (w.type === 'delete') {
      s.data = null; s.reset = w.reset;
    }
  }
  for (const s of state.values()) s.written = false;
  for (const w of writes) {
    const s = state.get(w.ref.path);
    if (s.written) continue;
    await persist(client, s.table, s.parentId, w.ref.id, s.before, s.data, store, s.reset && s.data === null);
    s.written = true;
  }
  return writes.map(() => ({ writeTime: now }));
}

// ── Transactions and batches ──
class Transaction {
  constructor(store, client, { lockReads = false } = {}) {
    this._store = store; this._client = client; this._lockReads = lockReads; this._writes = []; this._reads = new Map(); this._queries = [];
  }
  _readGuard() { if (this._writes.length) throw new Error('Firestore transactions require all reads to be executed before all writes.'); }
  // Reads lock nothing (as in Firestore): each remembers the version it saw,
  // and the commit checks them all again — see validateReads.
  _noteRead(ref, table, parentId, version) {
    if (!this._reads.has(ref.path)) this._reads.set(ref.path, { ref, table, parentId, version });
  }
  _noteQuery(sql, rows) { this._queries.push({ sql, seen: rows.map(r => `${r.id}@${r.__v}`).join('|') }); }
  async get(refOrQuery) {
    this._readGuard();
    if (refOrQuery instanceof DocumentReference) return readDoc(this._store, this._client, refOrQuery, this._lockReads, this);
    if (refOrQuery instanceof Query) return runQuery(this._store, this._client, refOrQuery, this);
    throw new Error('Value for argument "refOrQuery" must be a DocumentReference or a Query.');
  }
  async getAll(...refs) { this._readGuard(); const out = []; for (const r of refs) out.push(await readDoc(this._store, this._client, r, this._lockReads, this)); return out; }
  set(ref, data, options) { this._writes.push({ type: 'set', ref, data, merge: Boolean(options?.merge) }); return this; }
  update(ref, data) { this._writes.push({ type: 'update', ref, data }); return this; }
  create(ref, data) { this._writes.push({ type: 'create', ref, data }); return this; }
  delete(ref) { this._writes.push({ type: 'delete', ref, reset: isTestReset(this._store) }); return this; }
}
class WriteBatch {
  constructor(store) { this._store = store; this._writes = []; this._committed = false; }
  set(ref, data, options) { this._writes.push({ type: 'set', ref, data, merge: Boolean(options?.merge) }); return this; }
  update(ref, data) { this._writes.push({ type: 'update', ref, data }); return this; }
  create(ref, data) { this._writes.push({ type: 'create', ref, data }); return this; }
  delete(ref) { this._writes.push({ type: 'delete', ref, reset: isTestReset(this._store) }); return this; }
  commit() {
    if (this._committed) throw new Error('Cannot modify a WriteBatch that has been committed.');
    this._committed = true;
    return this._store._write(this._writes);
  }
}

const RETRYABLE = new Set(['40001', '40P01', '55P03']);
const LOCK_TIMEOUT = '10s';
// One connection runs one statement at a time. Callers do `Promise.all` over
// reads inside a transaction (as Firestore allows); queue them here instead
// of leaning on pg's deprecated internal queue.
function serial(client) {
  let tail = Promise.resolve();
  return { query: (...args) => { const p = tail.then(() => client.query(...args)); tail = p.catch(() => {}); return p; } };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Commit-time read validation: Firestore's optimistic transactions ──
// A transaction whose reads changed before it committed is aborted and run
// again. Documents it read are locked now, in a fixed order — the
// serializable snapshot makes Postgres itself refuse (40001) one that changed
// since it was read — and stay locked through the commit. Documents found
// missing, and query results, are checked on a fresh snapshot (another
// connection that takes no locks, so it cannot wait on this one).
const aborted = what => Object.assign(new Error(`ABORTED: ${what} changed before this transaction committed.`), { code: '40001' });
const lockableCache = new Map();
async function lockable(q, store, table) {
  if (NO_ROW_LOCK.has(table)) return false;
  const key = `${store?._role}:${table}`;
  if (!lockableCache.has(key)) {
    // Row locks need UPDATE; an insert-only table's rows cannot change anyway.
    const { rows: [{ ok }] } = await q.query(`select has_table_privilege(current_user, $1, 'UPDATE') as ok`, [`public.${qi(table)}`]);
    lockableCache.set(key, ok);
  }
  return lockableCache.get(key);
}
async function validateReads(store, q, tx) {
  const writing = new Map(tx._writes.map(w => [w.ref.path, w.type]));
  const reads = [...tx._reads.values()];
  const byKey = (a, b) => (a.table.table < b.table.table ? -1 : a.table.table > b.table.table ? 1 : a.ref.path < b.ref.path ? -1 : a.ref.path > b.ref.path ? 1 : 0);
  for (const r of reads.filter(x => x.version !== null).sort(byKey)) {
    if (!(await lockable(q, store, r.table.table))) continue;
    const mode = writing.get(r.ref.path) === 'delete' ? 'for update' : writing.has(r.ref.path) ? 'for no key update' : 'for share';
    const { where, params } = keyOf(r.table, r.ref, r.parentId);
    const { rows } = await q.query(`select xmin::text as v from public.${qi(r.table.table)} where ${where} ${mode}`, params);
    if (!rows.length || rows[0].v !== r.version) throw aborted(r.ref.path);
  }
  const missing = reads.filter(x => x.version === null);
  if (!missing.length && !tx._queries.length) return;
  const client = await store._checkPool.connect(); const fresh = serial(client);
  try {
    await fresh.query('begin isolation level read committed read only');
    if (store._role) await fresh.query(`set local role ${qi(store._role)}`);
    for (const r of missing) {
      const { where, params } = keyOf(r.table, r.ref, r.parentId);
      if ((await fresh.query(`select 1 from public.${qi(r.table.table)} where ${where}`, params)).rows.length) throw aborted(r.ref.path);
    }
    for (const { sql, seen } of tx._queries) {
      const { rows } = await fresh.query(sql);
      if (rows.map(row => `${row.id}@${row.__v}`).join('|') !== seen) throw aborted('a query result');
    }
    await fresh.query('commit');
  } catch (e) { await fresh.query('rollback').catch(() => {}); throw e; } finally { client.release(); }
}

export class Store {
  constructor({ pool, checkPool = pool, role = null, testResets = false, projectId = 'sweater' }) {
    this._pool = pool; this._checkPool = checkPool; this._role = role; this._testResets = testResets; this.projectId = projectId;
  }
  collection(path) { return new CollectionReference(this, path); }
  doc(path) { return new DocumentReference(this, path); }
  batch() { return new WriteBatch(this); }
  collectionGroup() { throw new UnsupportedInPgStore('collectionGroup on the server'); }
  /** Top-level collections holding at least one document, as Firestore lists them. */
  async listCollections() {
    const tops = SCHEMA.filter(t => !t.parentTable);
    const rows = await this._read(async q => (await q.query(tops.map(t => `select ${lit(t.collection)} as c where exists (select 1 from public.${qi(t.table)})`).join(' union all '))).rows);
    return rows.map(r => this.collection(r.c)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  async getAll(...refs) { return this._read(async (client) => { const out = []; for (const r of refs) out.push(await readDoc(this, client, r, false)); return out; }); }

  // Firestore never waits forever: contention aborts and the caller retries.
  // Here a lock wait gives up after LOCK_TIMEOUT (55P03, retried like a
  // serialization failure), and the limits hold whichever login runs this.
  async _begin(client, isolation = '') {
    await client.query(`begin${isolation ? ` isolation level ${isolation}` : ''}`);
    if (this._role) await client.query(`set local role ${qi(this._role)}`);
    await client.query(`set local lock_timeout = '${LOCK_TIMEOUT}'; set local statement_timeout = '30s'; set local idle_in_transaction_session_timeout = '60s'`);
  }
  async _read(fn) {
    const client = await this._pool.connect(); const q = serial(client);
    try { await this._begin(q, 'repeatable read read only'); const r = await fn(q); await q.query('commit'); return r; } catch (e) { await q.query('rollback').catch(() => {}); throw e; } finally { client.release(); }
  }
  // Plain writes and batches: last writer wins, as in Firestore. Rows are
  // locked while merged; two first-time writes to one id race on the key,
  // and the loser simply runs again against the row that now exists.
  async _write(writes) {
    for (let attempt = 1; ; attempt += 1) {
      const client = await this._pool.connect(); const q = serial(client);
      try {
        await this._begin(q, 'read committed');
        const results = await applyWrites(q, writes, this);
        await q.query('commit');
        return results;
      } catch (e) {
        await q.query('rollback').catch(() => {});
        const raced = e?.code === '23505' && !writes.some(w => w.type === 'create');
        if ((raced || RETRYABLE.has(e?.code)) && attempt < 5) { await sleep(10 * 2 ** attempt + Math.random() * 20); continue; }
        if (e?.code === '23505' && writes.some(w => w.type === 'create')) throw firestoreError(ALREADY_EXISTS, 'ALREADY_EXISTS', `Document already exists: ${writes.find(w => w.type === 'create').ref.path}`);
        throw e;
      } finally { client.release(); }
    }
  }
  async runTransaction(fn, { maxAttempts = 5 } = {}) {
    for (let attempt = 1; ; attempt += 1) {
      const client = await this._pool.connect(); const q = serial(client);
      // First attempt optimistic, as the emulator is: reads lock nothing and
      // the commit checks them. A retry means contention, so it queues the
      // way production Firestore does: each read takes the row's lock and
      // returns the latest committed version (read committed), so waiting
      // transactions take turns instead of aborting one another again.
      const pessimistic = attempt > 1;
      try {
        await this._begin(q, pessimistic ? 'read committed' : 'serializable');
        const tx = new Transaction(this, q, { lockReads: pessimistic });
        const result = await fn(tx);
        await validateReads(this, q, tx);
        await applyWrites(q, tx._writes, this);
        await q.query('commit');
        return result;
      } catch (e) {
        await q.query('rollback').catch(() => {});
        if (RETRYABLE.has(e?.code) && attempt < maxAttempts) { await sleep(20 * 2 ** attempt + Math.random() * 30); continue; }
        throw e;
      } finally { client.release(); }
    }
  }
  async close() {
    if (this._closed) return;
    this._closed = true;
    await this._pool.end(); if (this._checkPool !== this._pool) await this._checkPool.end();
  }
  terminate() { return this.close(); }
  /** Every document of a collection (subcollections follow by their keys). */
  async recursiveDelete(ref) {
    if (!(ref instanceof CollectionReference)) throw new UnsupportedInPgStore('recursiveDelete of a document');
    const snap = await ref.get();
    if (!snap.size) return;
    const batch = this.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
  /** Supabase's checkRevoked: the token's session still exists and its user is neither banned nor deleted. */
  async sessionIsLive(uid, sessionId) {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(String(uid)) || !uuid.test(String(sessionId))) return false;
    return this._read(async (q) => (await q.query('select app.session_is_live($1::uuid, $2::uuid) as live', [uid, sessionId])).rows[0]?.live === true);
  }
}

/** A store on a connection string; `role` is SET LOCAL per transaction. */
export function createStore({ connectionString, role = null, max = 5, ssl, testResets = false, projectId } = {}) {
  const pool = new pg.Pool({ connectionString, max, ssl, idleTimeoutMillis: 10_000 });
  // Commit-time checks get their own connections: a transaction holding one
  // of the main pool's must never wait for another from it.
  const checkPool = new pg.Pool({ connectionString, max: 2, ssl, idleTimeoutMillis: 10_000 });
  return new Store({ pool, checkPool, role, testResets, projectId });
}
