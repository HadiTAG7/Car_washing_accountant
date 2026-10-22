// ═══════════════════════════════════════════════════════════════════════════
// طبقة البيانات في المتصفح: نفس دوال firebase/firestore التي يستعملها الموقع،
// فوق Supabase (supabase-js) — القراءة عبر PostgREST والكتابة عبر apply_writes
// ═══════════════════════════════════════════════════════════════════════════
// حين يُبنى الموقع بـ VITE_DATA_SOURCE=supabase يوجّه Vite كل استيراد لـ
// 'firebase/firestore' إلى هذا الملف (vite.config.js)، فلا يتغيّر سطر في
// الخطافات والصفحات: نفس الأسماء، نفس شكل المستندات، نفس الأخطاء.
//
//   • القراءة: الصف ← المستند بنفس المحوِّل (codec.js)، وسطور القيد مضمّنة.
//   • الاستعلام: كل حقل يُفلتر عليه عمود له نوع (السجل يضمن ذلك)؛ مقارنة
//     بنوع آخر لا تطابق شيئاً، والترتيب الافتراضي بالمعرّف.
//   • الكتابة: دفعة واحدة في عملية واحدة تحت صلاحيات المستخدم (RLS).
//   • الاستماع الحي (onSnapshot): Realtime، لمركز قيادة الوكلاء وحده.
// ═══════════════════════════════════════════════════════════════════════════
import { getSupabase } from './client.js';
import { tableFor } from '../schema/registry.js';
import { encodeDocument, decodeDocument, encodePatch, fitColumn, toTagged } from '../schema/codec.js';
import { Timestamp, makeTimestamp } from './timestamp.js';

export { Timestamp };
const DOCUMENT_ID = '__name__';
const RANGE = new Set(['<', '<=', '>', '>=']);
const DECODE = { makeTimestamp };
// One request returns at most this many rows (the API's max_rows is set above it).
const PAGE = 10000;

// ── Errors in the client SDK's shape: { code: 'permission-denied', message } ──
export class FirestoreError extends Error {
  constructor(code, message) { super(message); this.code = code; this.name = 'FirebaseError'; }
}
function toFirestoreError(error) {
  const msg = error?.message || String(error);
  if (error?.code === '42501' || /permission-denied|row-level security|permission denied/i.test(msg)) return new FirestoreError('permission-denied', 'Missing or insufficient permissions.');
  if (error?.code === 'P0002' || /^not-found/.test(msg)) return new FirestoreError('not-found', msg.replace(/^not-found:\s*/, 'No document to update: '));
  if (error?.code === '40001' || error?.code === '40P01') return new FirestoreError('aborted', msg);
  if (error?.code === 'PGRST301' || /JWT/.test(msg)) return new FirestoreError('unauthenticated', msg);
  return new FirestoreError('internal', msg);
}

// ── Sentinels ──
class FieldSentinel { constructor(kind) { this.kind = kind; } isEqual(o) { return o instanceof FieldSentinel && o.kind === this.kind; } }
export const serverTimestamp = () => new FieldSentinel('serverTimestamp');
export const deleteField = () => new FieldSentinel('delete');
export const documentId = () => DOCUMENT_ID;
const isDelete = v => v instanceof FieldSentinel && v.kind === 'delete';
const isServerTime = v => v instanceof FieldSentinel && v.kind === 'serverTimestamp';

// ── The database handle and references ──
const DB = Object.freeze({ type: 'firestore', app: null, toJSON: () => ({ type: 'firestore' }) });
export function getFirestore() { return DB; }
export function connectFirestoreEmulator() { /* not applicable */ }
export function initializeFirestore() { return DB; }

class CollectionReference {
  constructor(path) { this.type = 'collection'; this.path = path; this.id = path.split('/').at(-1); this.firestore = DB; }
  get parent() { const p = this.path.split('/'); return p.length > 1 ? new DocumentReference(p.slice(0, -1).join('/')) : null; }
}
class DocumentReference {
  constructor(path) { this.type = 'document'; this.path = path; this.id = path.split('/').at(-1); this.firestore = DB; }
  get parent() { return new CollectionReference(this.path.split('/').slice(0, -1).join('/')); }
}
class Query {
  constructor(path, constraints = []) { this.type = 'query'; this.path = path; this._constraints = constraints; this.firestore = DB; }
}
const join = (base, segments) => [base, ...segments].filter(Boolean).join('/');
export function collection(parent, ...segments) {
  const base = parent === DB || parent?.type === 'firestore' ? '' : parent.path;
  const path = join(base, segments);
  if (path.split('/').length % 2 === 0) throw new FirestoreError('invalid-argument', `Invalid collection reference: ${path}`);
  return new CollectionReference(path);
}
const AUTO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function autoId() {
  const bytes = new Uint8Array(40); crypto.getRandomValues(bytes);
  let id = ''; for (const b of bytes) if (b < 248 && id.length < 20) id += AUTO[b % 62];
  return id.length === 20 ? id : autoId();
}
export function doc(parent, ...segments) {
  if (parent instanceof CollectionReference && !segments.length) return new DocumentReference(`${parent.path}/${autoId()}`);
  const base = parent === DB || parent?.type === 'firestore' ? '' : parent.path;
  const path = join(base, segments);
  if (path.split('/').length % 2) throw new FirestoreError('invalid-argument', `Invalid document reference: ${path}`);
  return new DocumentReference(path);
}

// ── Query constraints ──
export const where = (field, op, value) => ({ kind: 'where', field: String(field), op, value });
export const orderBy = (field, dir = 'asc') => ({ kind: 'orderBy', field: String(field), dir: dir === 'desc' ? 'desc' : 'asc' });
export const limit = n => ({ kind: 'limit', n });
export function query(ref, ...constraints) {
  const base = ref instanceof Query ? ref._constraints : [];
  return new Query(ref.path, [...base, ...constraints.filter(Boolean)]);
}

// ── Snapshots ──
function deepClone(v) {
  if (v === null || typeof v !== 'object' || v instanceof Timestamp) return v;
  if (Array.isArray(v)) return v.map(deepClone);
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepClone(x)]));
}
class DocumentSnapshot {
  constructor(ref, data) { this.ref = ref; this.id = ref.id; this._data = data; }
  exists() { return this._data !== undefined; }
  data() { return this._data === undefined ? undefined : deepClone(this._data); }
  get(field) {
    let cur = this._data;
    for (const seg of String(field).split('.')) { if (cur == null || typeof cur !== 'object') return undefined; cur = cur[seg]; }
    return deepClone(cur);
  }
}
class QuerySnapshot {
  constructor(query, docs) { this.query = query; this.docs = docs; this.size = docs.length; this.empty = docs.length === 0; }
  forEach(fn, thisArg) { this.docs.forEach(fn, thisArg); }
}

// ── Reading ──
const selectFor = table => (table.lines ? `*,${table.lines}(*)` : '*');
const rowToData = (table, row) => decodeDocument(table, row, table.lines ? row[table.lines] : null, DECODE);

/** A filter value as the column's parameter, or null when Firestore could never match it there. */
const STR = new Set(['id', 'text', 'day', 'month']);
function param(col, v) {
  // Text columns compare strings byte by byte, as Firestore does: a month
  // prefix ('2026-10') is a valid bound for a 'YYYY-MM-DD' column.
  if (STR.has(col.type)) return typeof v === 'string' ? v : null;
  const fit = fitColumn(col.type, toTagged(v));
  if (!fit) return null;
  if (col.type === 'json') return JSON.stringify(fit.value);
  return fit.value;
}

function plan(q) {
  const { table, parentId } = tableFor(q.path);
  const wheres = q._constraints.filter(c => c.kind === 'where');
  let orders = q._constraints.filter(c => c.kind === 'orderBy');
  const lim = q._constraints.filter(c => c.kind === 'limit').at(-1)?.n ?? null;
  if (!orders.length) {
    const ineq = [...new Set(wheres.filter(w => (RANGE.has(w.op) || w.op === '!=') && w.field !== DOCUMENT_ID).map(w => w.field))];
    orders = ineq.map(field => ({ kind: 'orderBy', field, dir: 'asc' }));
  }
  if (!orders.some(o => o.field === DOCUMENT_ID)) orders = [...orders, { kind: 'orderBy', field: DOCUMENT_ID, dir: orders.at(-1)?.dir || 'asc' }];
  const column = (field) => {
    const col = table.columns.find(c => c.field === field);
    if (!col) throw new FirestoreError('failed-precondition', `الحقل ${table.collection}.${field} ليس عموداً معرّفاً؛ أضفه لسجل الجداول قبل الاستعلام عليه.`);
    return col;
  };
  return { table, parentId, wheres, orders, lim, column };
}

/** Applies the plan's filters to a supabase-js builder; null means «matches nothing». */
function applyFilters(req, p) {
  if (p.table.parentTable) req = req.eq('parent_ref', p.parentId);
  for (const w of p.wheres) {
    if (w.field === DOCUMENT_ID) {
      if (w.op === 'in') req = req.in('id', w.value.map(String));
      else if (w.op === '==') req = req.eq('id', String(w.value));
      else req = req[{ '<': 'lt', '<=': 'lte', '>': 'gt', '>=': 'gte' }[w.op]]('id', String(w.value));
      continue;
    }
    const col = p.column(w.field);
    // An explicit null is recorded in shape.n (JSON containment, not an array literal).
    if (w.op === '==' && w.value === null) { req = req.is(col.column, null).filter('shape->n', 'cs', JSON.stringify([w.field])); continue; }
    // `!= null`: the field exists and holds a value — in its column, or kept
    // raw in shape.r when the column could not hold it exactly.
    if (w.op === '!=') {
      if (w.value !== null) throw new FirestoreError('invalid-argument', `'!=' is supported against null only (${w.field})`);
      req = req.or(`${col.column}.not.is.null,shape->r->>${w.field}.not.is.null`);
      continue;
    }
    if (w.op === 'in') {
      const values = w.value.filter(v => v !== null).map(v => param(col, v)).filter(v => v !== null);
      if (!values.length) return null;
      req = req.in(col.column, values);
      continue;
    }
    const v = param(col, w.value);
    if (v === null) return null;
    const method = { '==': 'eq', '<': 'lt', '<=': 'lte', '>': 'gt', '>=': 'gte' }[w.op];
    if (!method) throw new FirestoreError('invalid-argument', `Unsupported operator ${w.op}`);
    req = req[method](col.column, v);
  }
  // A field the order is on must exist (Firestore leaves the rest out); an explicit null counts.
  for (const o of p.orders) {
    if (o.field === DOCUMENT_ID) continue;
    const col = p.column(o.field);
    req = req.or(`${col.column}.not.is.null,shape->n.cs.${JSON.stringify([o.field])}`);
  }
  return req;
}

async function runQuery(q) {
  const p = plan(q);
  const sb = getSupabase();
  const docs = [];
  for (let from = 0; ; from += PAGE) {
    let req = applyFilters(sb.from(p.table.table).select(selectFor(p.table)), p);
    if (!req) return new QuerySnapshot(q, []);
    for (const o of p.orders) {
      if (o.field === DOCUMENT_ID) req = req.order('id', { ascending: o.dir === 'asc' });
      else req = req.order(p.column(o.field).column, { ascending: o.dir === 'asc', nullsFirst: o.dir === 'asc' });
    }
    const want = p.lim != null ? Math.min(PAGE, p.lim - from) : PAGE;
    req = req.range(from, from + want - 1);
    const { data, error } = await req;
    if (error) throw toFirestoreError(error);
    const coll = new CollectionReference(q.path);
    for (const row of data) docs.push(new DocumentSnapshot(new DocumentReference(`${coll.path}/${row.id}`), rowToData(p.table, row)));
    if (data.length < want || (p.lim != null && docs.length >= p.lim)) break;
  }
  return new QuerySnapshot(q, docs);
}

export async function getDocs(q) {
  return runQuery(q instanceof Query ? q : new Query(q.path));
}
async function fetchRow(ref) {
  const { table, parentId } = tableFor(ref.parent.path);
  let req = getSupabase().from(table.table).select(selectFor(table)).eq('id', ref.id);
  if (table.parentTable) req = req.eq('parent_ref', parentId);
  const { data, error } = await req.maybeSingle();
  if (error) throw toFirestoreError(error);
  return { table, row: data };
}
export async function getDoc(ref) {
  const { table, row } = await fetchRow(ref);
  return new DocumentSnapshot(ref, row ? rowToData(table, row) : undefined);
}
export async function getCountFromServer(q) {
  const p = plan(q instanceof Query ? q : new Query(q.path));
  const req = applyFilters(getSupabase().from(p.table.table).select('id', { count: 'exact', head: true }), p);
  if (!req) return { data: () => ({ count: 0 }) };
  const { count, error } = await req;
  if (error) throw toFirestoreError(error);
  return { data: () => ({ count }) };
}

// ── Writing ──
function stripSentinels(value, path, ts) {
  if (isServerTime(value)) { ts.push(path); return Timestamp.now(); }
  if (isDelete(value)) throw new FirestoreError('invalid-argument', 'deleteField() can only be used with update() and set() with {merge:true}');
  if (value === null || typeof value !== 'object' || value instanceof Timestamp || value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(v => stripSentinels(v, null, []));
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, stripSentinels(v, path === '' ? k : null, ts)]));
}
function setOp(ref, data) {
  const { table, parentId } = tableFor(ref.parent.path);
  const ts = [];
  const plain = stripSentinels(data, '', ts);
  const { row } = encodeDocument(table, ref.id, plain, { parentId });
  const ts_columns = []; const ts_extra = [];
  for (const field of ts.filter(Boolean)) {
    const col = table.columns.find(c => c.field === field);
    if (col) { ts_columns.push(col.column); if (row.shape?.t) delete row.shape.t[field]; } else ts_extra.push(field);
  }
  return { op: 'set', table: table.table, id: ref.id, parent: parentId, row, ts_columns, ts_extra };
}
function updateOp(ref, data) {
  const { table, parentId } = tableFor(ref.parent.path);
  return { op: 'update', table: table.table, id: ref.id, parent: parentId, ...encodePatch(table, data, { isDelete, isServerTime }) };
}
function deleteOp(ref) {
  const { table, parentId } = tableFor(ref.parent.path);
  return { op: 'delete', table: table.table, id: ref.id, parent: parentId };
}
function mergeDeep(target, patch) {
  const out = { ...target };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (isDelete(v)) { delete out[k]; continue; }
    const plain = v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Timestamp) && !(v instanceof Date) && !(v instanceof FieldSentinel);
    out[k] = plain && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k]) && !(out[k] instanceof Timestamp) ? mergeDeep(out[k], v) : v;
  }
  return out;
}
// A merge reads the document, combines, and writes on the condition that the
// row is still the one read (`if_match`); otherwise it reads again.
async function mergeOp(ref, data) {
  const { table, row } = await fetchRow(ref);
  const current = row ? rowToData(table, row) : {};
  const seen = row ? Object.fromEntries(Object.entries(row).filter(([k]) => k !== table.lines)) : null;
  return { ...setOp(ref, mergeDeep(current, data)), if_match: seen };
}
const ATTEMPTS = 5;
async function commitWith(build) {
  for (let attempt = 1; ; attempt += 1) {
    const ops = await build();
    if (!ops.length) return;
    const { error } = await getSupabase().rpc('apply_writes', { ops });
    if (!error) return;
    const e = toFirestoreError(error);
    if (e.code !== 'aborted' || attempt >= ATTEMPTS) throw e;
    await new Promise(r => setTimeout(r, 20 * 2 ** attempt + Math.random() * 30));
  }
}
const commit = ops => commitWith(async () => ops);
export async function setDoc(ref, data, options) {
  if (options?.merge) return commitWith(async () => [await mergeOp(ref, data)]);
  return commit([setOp(ref, data)]);
}
export async function addDoc(collectionRef, data) {
  const ref = doc(collectionRef);
  await commit([setOp(ref, data)]);
  return ref;
}
export const updateDoc = (ref, data) => commit([updateOp(ref, data)]);
export const deleteDoc = ref => commit([deleteOp(ref)]);

export function writeBatch() {
  // Ops are built at commit, in the order they were added; a merge reads then.
  const steps = []; let done = false;
  const batch = {
    set(ref, data, options) { steps.push(options?.merge ? () => mergeOp(ref, data) : () => setOp(ref, data)); return batch; },
    update(ref, data) { const op = updateOp(ref, data); steps.push(() => op); return batch; },
    delete(ref) { const op = deleteOp(ref); steps.push(() => op); return batch; },
    async commit() {
      if (done) throw new FirestoreError('failed-precondition', 'A write batch can no longer be used after commit() has been called.');
      done = true;
      await commitWith(() => Promise.all(steps.map(step => step())));
    },
  };
  return batch;
}

// ── Live listener (agent command center only) ──
export function onSnapshot(target, onNext, onError) {
  const sb = getSupabase();
  const q = target instanceof Query ? target : new Query(target.path);
  const { table } = tableFor(q.path);
  let alive = true; let timer = null;
  const refresh = () => runQuery(q).then(s => { if (alive) onNext(s); }, e => { if (alive && onError) onError(e); });
  const channel = sb.channel(`live:${table.table}:${Math.random().toString(36).slice(2)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: table.table }, () => {
      clearTimeout(timer); timer = setTimeout(refresh, 150);
    })
    .subscribe();
  refresh();
  return () => { alive = false; clearTimeout(timer); sb.removeChannel(channel); };
}
