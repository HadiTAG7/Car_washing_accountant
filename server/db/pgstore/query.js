// ═══════════════════════════════════════════════════════════════════════════
// ترجمة استعلام Firestore إلى SQL بنفس دلالاته حرفياً
// ═══════════════════════════════════════════════════════════════════════════
// لكل حقل «قيمة فعلية» كما يراها Firestore: من عمودها، أو من الأصل المحفوظ في
// shape.r حين لم يحفظها العمود حرفياً (رقم في عمود نصي، كسر ثنائي، …).
//   • المقارنة صارمة النوع: نص بنص، رقم برقم، لحظة بلحظة — غير ذلك لا يطابق.
//   • الترتيب بنوع القيمة أولاً كما في Firestore (null < منطقي < رقم < لحظة <
//     نص < … < خريطة)، ثم بالقيمة؛ والمستند الذي لا يحمل الحقل يُستبعد.
//   • بلا orderBy الترتيب بالمعرّف؛ وبفلتر نطاق بلا orderBy الترتيب بحقله؛ وآخر
//     مفتاح ترتيب دائماً المعرّف (بترتيب البايت، COLLATE "C") باتجاه آخر ترتيب.
// ═══════════════════════════════════════════════════════════════════════════

import { toTagged, fitColumn } from '../../../src/lib/data/schema/codec.js';
import { qi } from '../rows.js';

export const DOCUMENT_ID = '__name__';
const STR = new Set(['id', 'text', 'day', 'month']);
const NUM = new Set(['int', 'big', 'money', 'num', 'rate']);
const TIME = new Set(['ts', 'iso']);
const RANGE = new Set(['<', '<=', '>', '>=']);
// Firestore's cross-type order.
const RANK = { null: 0, bool: 1, num: 3, time: 4, str: 5, bytes: 6, ref: 7, geo: 8, array: 9, map: 10 };

export class UnsupportedInPgStore extends Error {
  constructor(message) { super(`pgstore: ${message}`); this.name = 'UnsupportedInPgStore'; }
}

function jsKind(v) {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'number') return 'num';
  if (typeof v === 'string') return 'str';
  if (v instanceof Date || (v && typeof v.toDate === 'function' && typeof v.seconds === 'number')) return 'time';
  if (Array.isArray(v)) return 'array';
  return 'map';
}
const lit = s => `'${String(s).replace(/'/g, "''")}'`;

export class SqlBuilder {
  constructor() { this.params = []; }
  p(value) { this.params.push(value); return `$${this.params.length}`; }
}

// Rank and per-type values of one jsonb expression (extra, a json column path, or shape.r).
function jsonVals(x) {
  return {
    rank: `(case jsonb_typeof(${x}) when 'null' then 0 when 'boolean' then 1 when 'number' then 3 when 'string' then 5 when 'array' then 9
      when 'object' then (case when ${x} ? '$fs:ts' then 4 when ${x} ? '$fs:num' then 3 when ${x} ? '$fs:bytes' then 6 when ${x} ? '$fs:ref' then 7 when ${x} ? '$fs:geo' then 8 else 10 end) end)`,
    bool: `(case when jsonb_typeof(${x}) = 'boolean' then (${x})::boolean end)`,
    num: `(case when jsonb_typeof(${x}) = 'number' then (${x})::numeric end)`,
    time: `(case when jsonb_typeof(${x}) = 'object' and ${x} ? '$fs:ts' then (${x} -> '$fs:ts' ->> 's')::numeric + (${x} -> '$fs:ts' ->> 'n')::numeric / 1000000000 end)`,
    str: `(case when jsonb_typeof(${x}) = 'string' then (${x} #>> '{}') end) collate "C"`,
    json: `(case when jsonb_typeof(${x}) in ('array', 'object') then ${x} end)`,
  };
}

/**
 * The field's effective Firestore value for one row, as SQL: a type rank
 * (NULL when the field is absent) and one value expression per type.
 */
export function fieldVals(b, table, field) {
  if (field === DOCUMENT_ID) return { name: true };
  const col = table.columns.find(c => c.field === field);
  if (!col) {
    const [head, ...rest] = field.split('.');
    const parent = table.columns.find(c => c.field === head && c.type === 'json');
    const expr = parent && rest.length ? `(${qi(parent.column)} #> ${lit(`{${rest.join(',')}}`)})` : `(extra #> ${lit(`{${field.split('.').join(',')}}`)})`;
    return { ...jsonVals(expr), present: `(${expr} is not null)` };
  }
  const C = qi(col.column);
  const f = `${b.p(field)}::text`;
  const has = `coalesce(shape -> 'r', '{}'::jsonb) ? ${f}`;
  const raw = jsonVals(`(shape -> 'r' -> ${f})`);
  const isNull = `coalesce(shape -> 'n', '[]'::jsonb) ? ${f}`;
  const form = `coalesce(shape -> 't' ->> ${f}, ${lit(col.type === 'iso' ? 'iso' : 'ts')})`;
  const colRank = STR.has(col.type) ? RANK.str : NUM.has(col.type) ? RANK.num : col.type === 'bool' ? RANK.bool
    : TIME.has(col.type) ? `(case when ${form} = 'iso' then ${RANK.str} else ${RANK.time} end)`
      : `(case jsonb_typeof(${C}) when 'array' then 9 else 10 end)`;
  const pick = (rawExpr, colExpr) => `(case when ${has} then ${rawExpr} else ${colExpr} end)`;
  return {
    rank: `(case when ${has} then ${raw.rank} when ${C} is not null then ${colRank} when ${isNull} then 0 end)`,
    bool: pick(raw.bool, col.type === 'bool' ? C : 'null::boolean'),
    num: pick(raw.num, NUM.has(col.type) ? `${C}::numeric` : 'null::numeric'),
    time: pick(raw.time, TIME.has(col.type) ? `(case when ${form} = 'ts' then extract(epoch from ${C}) end)` : 'null::numeric'),
    str: `${pick(raw.str, STR.has(col.type) ? `${C}::text` : TIME.has(col.type)
      ? `(case when ${form} = 'iso' then to_char(${C} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end)` : 'null::text')} collate "C"`,
    json: pick(raw.json, col.type === 'json' ? C : 'null::jsonb'),
    present: `(${C} is not null or ${has} or ${isNull})`,
    // Fast path for the planner when the bound has the column's own type.
    col, C, has,
  };
}

function bound(b, v) {
  const k = jsKind(v);
  if (k === 'num') return { kind: 'num', sql: Number.isFinite(v) ? `${b.p(String(v))}::numeric` : null };
  if (k === 'str') return { kind: 'str', sql: `${b.p(v)}::text collate "C"` };
  if (k === 'bool') return { kind: 'bool', sql: `${b.p(v)}::boolean` };
  if (k === 'time') {
    const t = toTagged(v)['$fs:ts'];
    return { kind: 'time', sql: `(${b.p(String(t.s))}::numeric + ${b.p(String(t.n))}::numeric / 1000000000)` };
  }
  if (k === 'null') return { kind: 'null' };
  return { kind: 'json', sql: `${b.p(JSON.stringify(toTagged(v)))}::jsonb` };
}
const VAL = { num: 'num', str: 'str', bool: 'bool', time: 'time', json: 'json' };

function predicate(b, table, field, op, v) {
  if (field === DOCUMENT_ID) {
    if (op === 'in') return `id = any(${b.p(v.map(String))}::text[])`;
    return `id ${op === '==' ? '=' : op} ${b.p(String(v))}::text collate "C"`;
  }
  if (op === 'in') return `(${v.map(x => predicate(b, table, field, '==', x)).join(' or ')})`;
  const vals = fieldVals(b, table, field);
  const bd = bound(b, v);
  if (bd.kind === 'null') return op === '==' ? `(${vals.rank} = 0)` : 'false';
  if (bd.sql === null) return 'false'; // NaN/Infinity never compare
  if (bd.kind === 'json' && op !== '==') return 'false';
  const sqlOp = op === '==' ? '=' : op;
  const exact = `(${vals[VAL[bd.kind]]} ${sqlOp} ${bd.sql})`;
  // Planner-friendly: the column itself when the bound fits it, else the exact form.
  if (vals.col && fitColumn(vals.col.type, v)?.exact && !TIME.has(vals.col.type) && vals.col.type !== 'json') {
    return `((not ${vals.has} and ${vals.C} ${sqlOp} ${bd.sql}) or (${vals.has} and ${exact}))`;
  }
  return exact;
}

export function effectiveOrders(filters, orders) {
  let effective = [...orders];
  if (!effective.length) {
    const ineq = [...new Set(filters.filter(f => RANGE.has(f.op) && f.field !== DOCUMENT_ID).map(f => f.field))];
    effective = ineq.map(field => ({ field, dir: 'asc' }));
  }
  if (!effective.some(o => o.field === DOCUMENT_ID)) effective.push({ field: DOCUMENT_ID, dir: effective.at(-1)?.dir || 'asc' });
  return effective;
}

/**
 * Compiles a query. `filters`: [{field, op, value}], `orders`: [{field, dir}],
 * `cursor`: values for startAfter (one per effective order key), `limit`.
 */
export function compileQuery(table, { parentId = null, filters = [], orders = [], cursor = null, limit = null, count = false, versions = false }) {
  const b = new SqlBuilder();
  const where = [];
  if (table.parentTable) {
    if (parentId == null) throw new UnsupportedInPgStore(`${table.collection} needs its parent document`);
    where.push(`parent_ref = ${b.p(String(parentId))}`);
  }
  for (const f of filters) {
    if (f.op === 'in' && (!Array.isArray(f.value) || !f.value.length)) throw new UnsupportedInPgStore("'in' needs a non-empty array");
    if (f.op !== '==' && f.op !== 'in' && !RANGE.has(f.op)) throw new UnsupportedInPgStore(`operator ${f.op}`);
    where.push(predicate(b, table, f.field, f.op, f.value));
  }
  const effective = effectiveOrders(filters, orders);
  for (const o of effective) if (o.field !== DOCUMENT_ID) where.push(fieldVals(b, table, o.field).present);
  if (cursor) {
    if (cursor.length > effective.length) throw new UnsupportedInPgStore('too many cursor values');
    const ors = [];
    for (let i = 0; i < cursor.length; i += 1) {
      const ands = [];
      for (let j = 0; j < i; j += 1) ands.push(predicate(b, table, effective[j].field, '==', cursor[j]));
      ands.push(afterValue(b, table, effective[i], cursor[i]));
      ors.push(`(${ands.join(' and ')})`);
    }
    where.push(`(${ors.join(' or ')})`);
  }
  const whereSql = where.length ? ` where ${where.join(' and ')}` : '';
  if (count) return { text: `select count(*)::int as n from public.${qi(table.table)}${whereSql}`, values: b.params, effective };
  const orderSql = effective.flatMap((o) => {
    const dir = o.dir === 'desc' ? 'desc' : 'asc';
    if (o.field === DOCUMENT_ID) return [`id ${dir}`];
    const v = fieldVals(b, table, o.field);
    return [v.rank, v.bool, v.num, v.time, v.str].map(x => `${x} ${dir} nulls ${dir === 'asc' ? 'first' : 'last'}`);
  }).join(', ');
  const limitSql = limit != null ? ` limit ${Number(limit)}` : '';
  // `versions`: each row's xmin — a transaction's read set, checked again at commit.
  const cols = versions ? '*, xmin::text as "__v"' : '*';
  return { text: `select ${cols} from public.${qi(table.table)}${whereSql} order by ${orderSql}${limitSql}`, values: b.params, effective };
}

// startAfter: strictly after the cursor value in the field's full (type, value) order.
function afterValue(b, table, order, value) {
  const desc = order.dir === 'desc';
  if (order.field === DOCUMENT_ID) return `id ${desc ? '<' : '>'} ${b.p(String(value))}::text collate "C"`;
  const vals = fieldVals(b, table, order.field);
  const bd = bound(b, value);
  const rank = bd.kind === 'null' ? 0 : RANK[bd.kind === 'json' ? jsKind(value) : bd.kind];
  const op = desc ? '<' : '>';
  if (bd.kind === 'null' || bd.kind === 'json') return `(${vals.rank} ${op} ${rank})`;
  return `((${vals.rank} ${op} ${rank}) or (${vals.rank} = ${rank} and ${vals[VAL[bd.kind]]} ${op} ${bd.sql}))`;
}
