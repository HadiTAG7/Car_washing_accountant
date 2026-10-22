// ═══════════════════════════════════════════════════════════════════════════
// المحوِّل: مستند Firestore ↔ صف Postgres — ذهاباً وإياباً بلا أي فرق
// ═══════════════════════════════════════════════════════════════════════════
// يستعمله الخادم (pgstore) وطبقة المتصفح وسكربت النقل، فلا تختلف ترجمة عن
// أخرى. القاعدة: decode(encode(doc)) = doc حرفياً — نفس المفاتيح، نفس null
// مقابل الغياب، نفس الأنواع، نفس الـdouble. لأن بصمات الاعتماد والقيود
// (financeReview.js) تُحسب على المستند كما هو، وفحوص مثل «هل المفتاح موجود»
// تعتمد على وجود المفتاح لا على قيمته.
//
// العمود يحمل أفضل تمثيل SQL (للقيود والاستعلام والفهارس)، وshape يحفظ
// الأصل فقط حين يختلف:
//   shape.n  حقول قيمتها null صريحة (العمود NULL لا يميّز الغياب)
//   shape.r  { field: القيمة الأصلية } حين لا يحفظها العمود حرفياً (مبلغ فيه
//            كسر ثنائي، نص في عمود تاريخ، Timestamp بدقة نانو، …)
//   shape.t  { field: 'iso'|'ts' } لحظة خُزّنت بالشكل الآخر غير المعتاد للعمود
//   shape.nolines  قيد بلا مصفوفة lines أصلاً
// ═══════════════════════════════════════════════════════════════════════════

import { tagOf } from './tags.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export const isDay = v => typeof v === 'string' && DAY.test(v)
  && new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v;
export const isMonth = v => typeof v === 'string' && MONTH.test(v);

// ── Runtime value → tagged JSON (the export's form) ──
// Timestamps from either SDK (seconds/nanoseconds), JS Dates (Firestore turns
// them into Timestamps on write), and the special numbers JSON cannot hold.
export function toTagged(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return { '$fs:num': 'NaN' };
    if (value === Infinity) return { '$fs:num': 'Infinity' };
    if (value === -Infinity) return { '$fs:num': '-Infinity' };
    if (Object.is(value, -0)) return { '$fs:num': '-0' };
    return value;
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(v => (v === undefined ? null : toTagged(v)));
  if (value instanceof Date) {
    const ms = value.getTime();
    return { '$fs:ts': { s: Math.floor(ms / 1000), n: (((ms % 1000) + 1000) % 1000) * 1e6 } };
  }
  if (tagOf(value)) return value;
  if (typeof value.toDate === 'function' && typeof value.seconds === 'number' && typeof value.nanoseconds === 'number') {
    return { '$fs:ts': { s: value.seconds, n: value.nanoseconds } };
  }
  if (typeof value.path === 'string' && value.__docRef === true) return { '$fs:ref': value.path };
  if (typeof Uint8Array !== 'undefined' && value instanceof Uint8Array) {
    let bin = ''; for (const b of value) bin += String.fromCharCode(b);
    return { '$fs:bytes': btoa(bin) };
  }
  const out = {};
  for (const key of Object.keys(value)) {
    const v = toTagged(value[key]);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

// ── Tagged JSON → runtime value ──
export function fromTagged(value, opts) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(v => fromTagged(v, opts));
  const tag = tagOf(value);
  if (tag === 'ts') return opts.makeTimestamp(value['$fs:ts'].s, value['$fs:ts'].n);
  if (tag === 'num') return Number(value['$fs:num']);
  if (tag === 'ref') return opts.makeRef ? opts.makeRef(value['$fs:ref']) : { path: value['$fs:ref'], __docRef: true };
  if (tag === 'bytes') return opts.makeBytes ? opts.makeBytes(value['$fs:bytes']) : Uint8Array.from(atob(value['$fs:bytes']), c => c.charCodeAt(0));
  if (tag === 'geo') return { latitude: value['$fs:geo'][0], longitude: value['$fs:geo'][1] };
  return sortedObject(value, v => fromTagged(v, opts));
}

// Firestore returns map fields in key byte order; so does every decode here.
const byteOrder = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
function sortedObject(obj, map) {
  const out = {};
  for (const key of Object.keys(obj).sort(byteOrder)) out[key] = map(obj[key]);
  return out;
}

// ── Instants: microsecond ISO for timestamptz ──
const pad = (n, w) => String(n).padStart(w, '0');
export function tsToIso({ s, n }) {
  const base = new Date(s * 1000).toISOString().slice(0, 19);
  return `${base}.${pad(Math.floor(n / 1000), 6)}Z`;
}
/** Parses Postgres/PostgREST timestamptz text ('2026-10-21 10:00:00.123456+00' or ISO) to {s, n}. */
export function isoToTs(text) {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(String(text).trim());
  if (!m) throw new Error(`لحظة غير مفهومة: ${text}`);
  let zone = m[4] || 'Z';
  if (/^[+-]\d{2}$/.test(zone)) zone = `${zone}:00`;
  const ms = Date.parse(`${m[1]}T${m[2]}${zone}`);
  return { s: Math.floor(ms / 1000), n: Number((m[3] || '').padEnd(9, '0').slice(0, 9)) };
}

// ── One typed column: value → { value, exact } or null when it does not fit ──
function fitNumber(v, digits, bound) {
  if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) >= bound) return null;
  const text = v.toFixed(digits);
  return { value: text, exact: Number(text) === v && !Object.is(v, -0) };
}
function fitColumn(type, v) {
  switch (type) {
    case 'id': case 'text': return typeof v === 'string' ? { value: v, exact: true } : null;
    case 'int': return Number.isInteger(v) && Math.abs(v) <= 2147483647 && !Object.is(v, -0) ? { value: v, exact: true } : null;
    case 'big': return Number.isSafeInteger(v) && !Object.is(v, -0) ? { value: String(v), exact: true } : null;
    case 'money': return fitNumber(v, 2, 1e12);
    case 'rate': return fitNumber(v, 6, 1e3);
    case 'num': return typeof v === 'number' && Number.isFinite(v) ? { value: String(v), exact: !Object.is(v, -0) } : null;
    case 'bool': return typeof v === 'boolean' ? { value: v, exact: true } : null;
    case 'day': return isDay(v) ? { value: v, exact: true } : null;
    case 'month': return isMonth(v) ? { value: v, exact: true } : null;
    case 'json': return v !== null && typeof v === 'object' && !tagOf(v) ? { value: v, exact: true } : null;
    case 'ts': case 'iso': {
      const tag = tagOf(v);
      if (tag === 'ts') {
        const { n } = v['$fs:ts'];
        return { value: tsToIso(v['$fs:ts']), exact: n % 1000 === 0, form: 'ts' };
      }
      if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v))) {
        const canonical = new Date(Date.parse(v)).toISOString() === v;
        return { value: new Date(Date.parse(v)).toISOString(), exact: canonical, form: 'iso' };
      }
      return null;
    }
    default: throw new Error(`نوع عمود غير معروف ${type}`);
  }
}

function columnToValue(type, raw, form, opts) {
  switch (type) {
    case 'int': case 'big': case 'money': case 'rate': case 'num': return Number(raw);
    case 'bool': return raw === true || raw === 't' || raw === 'true';
    case 'json': return fromTagged(raw, opts);
    case 'ts': case 'iso': {
      const ts = typeof raw === 'string' ? isoToTs(raw) : isoToTs(new Date(raw).toISOString());
      return form === 'iso' ? new Date(ts.s * 1000 + Math.floor(ts.n / 1e6)).toISOString() : opts.makeTimestamp(ts.s, ts.n);
    }
    default: return raw;
  }
}

/** A field's whole document part → { columns, extra, shape } for one table. */
function encodeFields(columns, data, { skip = [] } = {}) {
  const row = {}; const extra = {}; const shape = { n: [], r: {}, t: {} };
  const known = new Map(columns.map(c => [c.field, c]));
  for (const c of columns) row[c.column] = null;
  for (const key of Object.keys(data)) {
    if (skip.includes(key)) continue;
    const v = data[key];
    const col = known.get(key);
    if (!col) { extra[key] = v; continue; }
    if (v === null) { shape.n.push(key); continue; }
    const fit = fitColumn(col.type, v);
    if (!fit) { shape.r[key] = v; continue; }
    row[col.column] = fit.value;
    if (!fit.exact) shape.r[key] = v;
    const usual = col.type === 'iso' ? 'iso' : 'ts';
    if (fit.form && fit.form !== usual) shape.t[key] = fit.form;
  }
  const compact = {};
  if (shape.n.length) compact.n = shape.n.sort(byteOrder);
  if (Object.keys(shape.r).length) compact.r = shape.r;
  if (Object.keys(shape.t).length) compact.t = shape.t;
  return { row, extra, shape: compact };
}

function decodeFields(columns, row, extra, shape, opts) {
  const data = {};
  for (const [k, v] of Object.entries(extra || {})) data[k] = fromTagged(v, opts);
  const s = shape || {};
  const nulls = new Set(s.n || []);
  for (const c of columns) {
    if (s.r && Object.hasOwn(s.r, c.field)) { data[c.field] = fromTagged(s.r[c.field], opts); continue; }
    const raw = row[c.column];
    if (raw !== null && raw !== undefined) {
      const form = s.t?.[c.field] || (c.type === 'iso' ? 'iso' : 'ts');
      data[c.field] = columnToValue(c.type, raw, form, opts);
    } else if (nulls.has(c.field)) data[c.field] = null;
  }
  return data;
}

// Journal lines are their own table; these are their columns.
export const LINE_COLUMNS = [
  { field: 'accountId', column: 'account_id', type: 'id' },
  { field: 'debit', column: 'debit', type: 'money' },
  { field: 'credit', column: 'credit', type: 'money' },
  { field: 'description', column: 'description', type: 'text' },
];
const plainMap = v => v !== null && typeof v === 'object' && !Array.isArray(v) && !tagOf(v);

/**
 * A document (runtime or tagged values) → the row for its table, plus child
 * rows for journal lines. `table` is a registry entry.
 */
export function encodeDocument(table, id, data, { parentId = null } = {}) {
  const tagged = toTagged(data || {});
  const hasLines = Boolean(table.lines);
  const lines = hasLines ? tagged.lines : undefined;
  const linesOk = hasLines && Array.isArray(lines) && lines.every(plainMap);
  const { row, extra, shape } = encodeFields(table.columns, tagged, { skip: linesOk ? ['lines'] : [] });
  const out = { id: String(id), ...row, extra, shape: Object.keys(shape).length ? shape : null };
  if (table.parentTable) out.parent_id = String(parentId);
  let lineRows = null;
  if (hasLines) {
    if (linesOk) {
      lineRows = lines.map((line, i) => {
        const enc = encodeFields(LINE_COLUMNS, line);
        return { entry_id: String(id), line_no: i, ...enc.row, extra: enc.extra, shape: Object.keys(enc.shape).length ? enc.shape : null };
      });
    } else {
      lineRows = [];
      if (!Object.hasOwn(tagged, 'lines')) out.shape = { ...(out.shape || {}), nolines: true };
    }
  }
  return { row: out, lines: lineRows };
}

/** A row (and its line rows, ordered by line_no) → the document's data. */
export function decodeDocument(table, row, lineRows, opts) {
  const data = decodeFields(table.columns, row, row.extra, row.shape, opts);
  // A malformed `lines` value (not an array of maps) was kept whole in extra.
  if (table.lines && !row.shape?.nolines && !Object.hasOwn(row.extra || {}, 'lines')) {
    data.lines = (lineRows || []).slice().sort((a, b) => a.line_no - b.line_no)
      .map(l => sortedObject(decodeFields(LINE_COLUMNS, l, l.extra, l.shape, opts), v => v));
  }
  return sortedObject(data, v => v);
}

/** A plain Timestamp-like for tests and the migration (both SDK shapes readable). */
export function plainTimestamp(seconds, nanoseconds) {
  return {
    seconds, nanoseconds,
    toDate: () => new Date(seconds * 1000 + Math.floor(nanoseconds / 1e6)),
    toMillis: () => seconds * 1000 + Math.floor(nanoseconds / 1e6),
  };
}
