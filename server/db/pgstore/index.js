// ═══════════════════════════════════════════════════════════════════════════
// pgstore — نفس واجهة firebase-admin/firestore التي يستعملها الخادم، فوق Postgres
// ═══════════════════════════════════════════════════════════════════════════
// كل عملية خادم (functions/src/handlers.js) تستلم `db` معاملاً، فتشتغل كما هي
// حرفياً: نفس القيود، نفس الرواتب، نفس الأرقام. المدعوم هو ما يستعمله الكود
// فعلاً (مسح بـgrep)، وأي شيء خارجه يرمي خطأً صريحاً بدل أن ينحرف بصمت.
//
// المعاملات: SERIALIZABLE، والمستند المقروء داخلها يُقفل (FOR UPDATE) فيتسلسل
// عدّاد القيود، والكتابات تُجمع وتُطبَّق عند الإنهاء، وعند التعارض تُعاد
// الدالة كلها كما يفعل Firestore. وكل serverTimestamp في عملية واحدة = لحظة واحدة.
// ═══════════════════════════════════════════════════════════════════════════

import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { tableFor } from '../../../src/lib/data/schema/registry.js';
import { encodeDocument, decodeDocument, isoToTs } from '../../../src/lib/data/schema/codec.js';
import { qi, rowColumns, insertRowSql, insertLineSql } from '../rows.js';
import { compileQuery, DOCUMENT_ID, UnsupportedInPgStore } from './query.js';
import { Timestamp, makeTimestamp } from './timestamp.js';

export { Timestamp, UnsupportedInPgStore };
const DECODE = { makeTimestamp };
const NOT_FOUND = 5; const ALREADY_EXISTS = 6;

// ── FieldValue / FieldPath ──
class FieldValueSentinel { constructor(kind) { this.kind = kind; } isEqual(o) { return o instanceof FieldValueSentinel && o.kind === this.kind; } }
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

function deepClone(v) {
  if (v === null || typeof v !== 'object' || v instanceof Timestamp) return v;
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
  constructor(ref, data) { this.ref = ref; this.id = ref.id; this._data = data; this.exists = data !== undefined; }
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
  get() { return this.firestore._read(client => runQuery(this.firestore, client, this, false)); }
  count() {
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
  collection(name) { return new CollectionReference(this.firestore, `${this.path}/${name}`); }
  isEqual(o) { return o instanceof DocumentReference && o.path === this.path; }
  get() { return this.firestore._read(client => readDoc(this.firestore, client, this, false)); }
  set(data, options) { return this.firestore._write([{ type: 'set', ref: this, data, merge: Boolean(options?.merge) }]); }
  update(data) { return this.firestore._write([{ type: 'update', ref: this, data }]); }
  create(data) { return this.firestore._write([{ type: 'create', ref: this, data }]); }
  delete() { return this.firestore._write([{ type: 'delete', ref: this }]); }
  listCollections() { throw new UnsupportedInPgStore('listCollections'); }
}

// ── Reading ──
async function loadRow(client, ref, lock) {
  const { table, parentId } = locate(ref._collectionPath);
  const where = table.parentTable ? 'id = $1 and parent_ref = $2' : 'id = $1';
  const params = table.parentTable ? [ref.id, parentId] : [ref.id];
  const { rows } = await client.query(`select * from public.${qi(table.table)} where ${where}${lock ? ' for update' : ''}`, params);
  if (!rows.length) return { table, parentId, row: null, lines: [] };
  let lines = [];
  if (table.lines) lines = (await client.query(`select * from public.${qi(table.lines)} where entry_id = $1 order by line_no${lock ? ' for update' : ''}`, [ref.id])).rows;
  return { table, parentId, row: rows[0], lines };
}
async function readDoc(store, client, ref, lock) {
  const { table, row, lines } = await loadRow(client, ref, lock);
  return new DocumentSnapshot(ref, row ? decodeDocument(table, row, lines, DECODE) : undefined);
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
async function runQuery(store, client, query) {
  const { table, parentId } = locate(query._path);
  let cursor = query._q.cursor;
  if (cursor && cursor.length === 1 && cursor[0] instanceof DocumentSnapshot) {
    const snap = cursor[0];
    const probe = compileQuery(table, { parentId, filters: query._q.filters, orders: query._q.orders });
    cursor = probe.effective.map(o => (o.field === DOCUMENT_ID ? snap.id : snap.get(o.field)));
  }
  const sql = compileQuery(table, { parentId, filters: query._q.filters, orders: query._q.orders, cursor, limit: query._q.limit });
  const { rows } = await client.query(sql);
  let linesBy = new Map();
  if (table.lines && rows.length) {
    const { rows: lineRows } = await client.query(`select * from public.${qi(table.lines)} where entry_id = any($1) order by entry_id, line_no`, [rows.map(r => r.id)]);
    linesBy = lineRows.reduce((m, l) => m.set(l.entry_id, [...(m.get(l.entry_id) || []), l]), new Map());
  }
  const coll = new CollectionReference(store, query._path);
  return new QuerySnapshot(rows.map(r => new DocumentSnapshot(coll.doc(r.id), project(decodeDocument(table, r, linesBy.get(r.id), DECODE), query._q.select))));
}

// ── Writing ──
function assertNoUndefined(value, path = '') {
  if (value === undefined) throw new Error(`Value for argument "data" is not a valid Firestore document. Cannot use "undefined" as a Firestore value${path ? ` (found in field "${path}")` : ''}. If you want to ignore undefined values, enable \`ignoreUndefinedProperties\`.`);
  if (value && typeof value === 'object' && !(value instanceof Timestamp) && !(value instanceof Date) && !(value instanceof FieldValueSentinel)) {
    for (const [k, v] of Object.entries(value)) assertNoUndefined(v, path ? `${path}.${k}` : k);
  }
}
function resolve(value, now, { allowDelete }) {
  if (value instanceof FieldValueSentinel) {
    if (value.kind === 'serverTimestamp') return now;
    if (value.kind === 'delete' && !allowDelete) throw new Error('FieldValue.delete() must appear at the top-level and can only be used in update() or set() with {merge:true}.');
    return value;
  }
  if (value === null || typeof value !== 'object' || value instanceof Timestamp || value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(v => resolve(v, now, { allowDelete: false }));
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v, now, { allowDelete })]));
}
const isDelete = v => v instanceof FieldValueSentinel && v.kind === 'delete';
function mergeDeep(target, patch) {
  const out = { ...target };
  for (const [k, v] of Object.entries(patch)) {
    if (isDelete(v)) { delete out[k]; continue; }
    const plain = v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Timestamp) && !(v instanceof Date);
    out[k] = plain && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k]) && !(out[k] instanceof Timestamp) ? mergeDeep(out[k], v) : v;
  }
  return out;
}

async function persist(client, table, parentId, id, before, data) {
  const where = table.parentTable ? `id = $1 and parent_ref = $2` : 'id = $1';
  const keyParams = table.parentTable ? [id, parentId] : [id];
  if (data === null) {
    if (before) await client.query(`delete from public.${qi(table.table)} where ${where}`, keyParams);
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

async function applyWrites(client, writes) {
  if (!writes.length) return [];
  const { rows: [{ t }] } = await client.query('select clock_timestamp()::text as t');
  const ts = isoToTs(t); const now = new Timestamp(ts.s, ts.n);
  const state = new Map(); // path → { table, parentId, before (exists in db), data|null }
  for (const w of writes) {
    if (!state.has(w.ref.path)) {
      const { table, parentId, row, lines } = await loadRow(client, w.ref, true);
      state.set(w.ref.path, { table, parentId, before: Boolean(row), data: row ? decodeDocument(table, row, lines, DECODE) : null });
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
      s.data = null;
    }
  }
  for (const s of state.values()) s.written = false;
  for (const w of writes) {
    const s = state.get(w.ref.path);
    if (s.written) continue;
    await persist(client, s.table, s.parentId, w.ref.id, s.before, s.data);
    s.written = true;
  }
  return writes.map(() => ({ writeTime: now }));
}

// ── Transactions and batches ──
class Transaction {
  constructor(store, client) { this._store = store; this._client = client; this._writes = []; }
  _readGuard() { if (this._writes.length) throw new Error('Firestore transactions require all reads to be executed before all writes.'); }
  async get(refOrQuery) {
    this._readGuard();
    if (refOrQuery instanceof DocumentReference) return readDoc(this._store, this._client, refOrQuery, true);
    if (refOrQuery instanceof Query) return runQuery(this._store, this._client, refOrQuery);
    throw new Error('Value for argument "refOrQuery" must be a DocumentReference or a Query.');
  }
  async getAll(...refs) { this._readGuard(); const out = []; for (const r of refs) out.push(await readDoc(this._store, this._client, r, true)); return out; }
  set(ref, data, options) { this._writes.push({ type: 'set', ref, data, merge: Boolean(options?.merge) }); return this; }
  update(ref, data) { this._writes.push({ type: 'update', ref, data }); return this; }
  create(ref, data) { this._writes.push({ type: 'create', ref, data }); return this; }
  delete(ref) { this._writes.push({ type: 'delete', ref }); return this; }
}
class WriteBatch {
  constructor(store) { this._store = store; this._writes = []; this._committed = false; }
  set(ref, data, options) { this._writes.push({ type: 'set', ref, data, merge: Boolean(options?.merge) }); return this; }
  update(ref, data) { this._writes.push({ type: 'update', ref, data }); return this; }
  create(ref, data) { this._writes.push({ type: 'create', ref, data }); return this; }
  delete(ref) { this._writes.push({ type: 'delete', ref }); return this; }
  commit() {
    if (this._committed) throw new Error('Cannot modify a WriteBatch that has been committed.');
    this._committed = true;
    return this._store._write(this._writes);
  }
}

const RETRYABLE = new Set(['40001', '40P01']);
const sleep = ms => new Promise(r => setTimeout(r, ms));

export class Store {
  constructor({ pool, role = null }) { this._pool = pool; this._role = role; }
  collection(path) { return new CollectionReference(this, path); }
  doc(path) { return new DocumentReference(this, path); }
  batch() { return new WriteBatch(this); }
  collectionGroup() { throw new UnsupportedInPgStore('collectionGroup on the server'); }
  listCollections() { throw new UnsupportedInPgStore('listCollections'); }
  async getAll(...refs) { return this._read(async (client) => { const out = []; for (const r of refs) out.push(await readDoc(this, client, r, false)); return out; }); }

  async _begin(client, isolation = '') {
    await client.query(`begin${isolation ? ` isolation level ${isolation}` : ''}`);
    if (this._role) await client.query(`set local role ${qi(this._role)}`);
  }
  async _read(fn) {
    const client = await this._pool.connect();
    try { await this._begin(client, 'repeatable read read only'); const r = await fn(client); await client.query('commit'); return r; } catch (e) { await client.query('rollback').catch(() => {}); throw e; } finally { client.release(); }
  }
  async _write(writes) {
    return this.runTransaction(async (tx) => { tx._writes.push(...writes); }, { _writesOnly: true }).then(() => writes.map(() => ({})));
  }
  async runTransaction(fn, { maxAttempts = 5 } = {}) {
    for (let attempt = 1; ; attempt += 1) {
      const client = await this._pool.connect();
      try {
        await this._begin(client, 'serializable');
        const tx = new Transaction(this, client);
        const result = await fn(tx);
        await applyWrites(client, tx._writes);
        await client.query('commit');
        return result;
      } catch (e) {
        await client.query('rollback').catch(() => {});
        if (RETRYABLE.has(e?.code) && attempt < maxAttempts) { await sleep(20 * 2 ** attempt + Math.random() * 30); continue; }
        throw e;
      } finally { client.release(); }
    }
  }
  async close() { await this._pool.end(); }
}

/** A store on a connection string; `role` is SET LOCAL per transaction (tests). */
export function createStore({ connectionString, role = null, max = 5 } = {}) {
  const pool = new pg.Pool({ connectionString, max, idleTimeoutMillis: 10_000 });
  return new Store({ pool, role });
}
