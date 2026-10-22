// ═══════════════════════════════════════════════════════════════════════════
// صفوف المحوِّل ↔ SQL — المشترك بين سكربت النقل وطبقة الخادم (pgstore)
// ═══════════════════════════════════════════════════════════════════════════
// القيم تُرسل نصاً للأرقام (numeric يحفظها حرفياً) وJSON للـjsonb، وتُقرأ
// اللحظات نصاً كما هي (لا Date: يفقد الميكروثانية)، والأرقام نصاً ثم
// يحوّلها المحوِّل إلى Number بنفس الـdouble.
// ═══════════════════════════════════════════════════════════════════════════

import pg from 'pg';
import { encodeDocument, decodeDocument, LINE_COLUMNS } from '../../src/lib/data/schema/codec.js';

// timestamptz / timestamp as text; numeric and int8 are already text.
pg.types.setTypeParser(1184, v => v);
pg.types.setTypeParser(1114, v => v);

export const qi = name => `"${String(name).replace(/"/g, '""')}"`;
const JSON_TYPES = new Set(['json']);

/** Ordered column list for a table's rows (id, parent?, typed…, extra, shape). */
export function rowColumns(table) {
  return [
    { column: 'id' },
    ...(table.parentTable ? [{ column: 'parent_id' }] : []),
    ...table.columns,
    { column: 'extra', type: 'json' },
    { column: 'shape', type: 'json' },
  ];
}
function paramFor(col, value) {
  if (value === null || value === undefined) return null;
  return JSON_TYPES.has(col.type) ? JSON.stringify(value) : value;
}
function placeholder(col, i) {
  return JSON_TYPES.has(col.type) ? `$${i}::jsonb` : `$${i}`;
}

/** INSERT for one encoded row; `mode`: 'error' | 'replace' | 'ignore'. */
export function insertRowSql(table, row, mode = 'error') {
  const cols = rowColumns(table);
  const values = cols.map(c => paramFor(c, row[c.column]));
  const key = table.parentTable ? 'parent_id, id' : 'id';
  let conflict = '';
  if (mode === 'replace') conflict = ` on conflict (${key}) do update set ${cols.filter(c => c.column !== 'id' && c.column !== 'parent_id').map(c => `${qi(c.column)} = excluded.${qi(c.column)}`).join(', ')}`;
  if (mode === 'ignore') conflict = ` on conflict (${key}) do nothing`;
  return {
    text: `insert into public.${qi(table.table)} (${cols.map(c => qi(c.column)).join(', ')}) values (${cols.map((c, i) => placeholder(c, i + 1)).join(', ')})${conflict}`,
    values,
  };
}

const LINE_COLS = [{ column: 'entry_id' }, { column: 'line_no' }, ...LINE_COLUMNS, { column: 'extra', type: 'json' }, { column: 'shape', type: 'json' }];
export function insertLineSql(linesTable, line) {
  return {
    text: `insert into public.${qi(linesTable)} (${LINE_COLS.map(c => qi(c.column)).join(', ')}) values (${LINE_COLS.map((c, i) => placeholder(c, i + 1)).join(', ')})`,
    values: LINE_COLS.map(c => paramFor(c, line[c.column])),
  };
}

/** Writes one document (and its journal lines) with a pg client. */
export async function writeDocument(client, table, id, data, { parentId = null, mode = 'error' } = {}) {
  const { row, lines } = encodeDocument(table, id, data, { parentId });
  await client.query(insertRowSql(table, row, mode));
  if (table.lines && lines) {
    if (mode === 'replace') await client.query(`delete from public.${qi(table.lines)} where entry_id = $1`, [String(id)]);
    for (const line of lines) await client.query(insertLineSql(table.lines, line));
  }
  return row;
}

/** Reads rows back as documents: [{ id, parentId, data }] in id byte order. */
export async function readDocuments(client, table, opts, { where = '', params = [] } = {}) {
  const { rows } = await client.query(`select * from public.${qi(table.table)} ${where} order by ${table.parentTable ? 'parent_id, ' : ''}id`, params);
  let linesBy = new Map();
  if (table.lines && rows.length) {
    const { rows: lineRows } = await client.query(`select * from public.${qi(table.lines)} where entry_id = any($1) order by entry_id, line_no`, [rows.map(r => r.id)]);
    linesBy = lineRows.reduce((m, l) => m.set(l.entry_id, [...(m.get(l.entry_id) || []), l]), new Map());
  }
  return rows.map(r => ({ id: r.id, parentId: r.parent_id ?? null, data: decodeDocument(table, r, linesBy.get(r.id), opts) }));
}
