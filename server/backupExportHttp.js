// ═══════════════════════════════════════════════════════════════════════════
// النسخة الاحتياطية على Supabase — كل الجداول، بصيغة يستعيدها سكربت النقل
// ═══════════════════════════════════════════════════════════════════════════
// الخطة المجانية لـ Supabase بلا نسخ تلقائي، فزر النسخ في الموقع يصير هو
// النسخة: المتصفح يطلب كل مجموعة صفحةً صفحة (حد استجابة Vercel 4.5MB)، ويجمعها
// في ملف ZIP. كل مستند بصيغة التصدير نفسها (JSON موسوم بأنواعه)، فالملف
// يُستعاد كما هو: node scripts/migration/import-supabase.mjs --dir <المجلد>.
//
// للمدير وحده، وعلى Supabase وحده (على Firebase يبقى زر النسخ كما كان).
// يُقرأ بدور الخادم المحدود، لا بمفتاح خدمة.
// ═══════════════════════════════════════════════════════════════════════════
import { onSupabase, supabaseRuntime } from './db/backend.js';
import { callerRole } from '../functions/src/handlers.js';
import { SCHEMA } from '../src/lib/data/schema/registry.js';
import { decodeDocument, toTagged } from '../src/lib/data/schema/codec.js';

const PAGE_ROWS = 500;
const PAGE_BYTES = 2_500_000;
const UID_MAP = 'firebase_uid_map';
// Decoded straight into the tagged form the export uses.
const TAGGED = { makeTimestamp: (s, n) => ({ '$fs:ts': { s, n } }), makeRef: path => ({ '$fs:ref': path }), makeBytes: b64 => ({ '$fs:bytes': b64 }), makeGeo: (a, b) => ({ '$fs:geo': [a, b] }) };
const qi = s => `"${String(s).replace(/"/g, '""')}"`;

/** Every collection the backup holds, in a stable order (plus the uid map). */
export const BACKUP_COLLECTIONS = [...SCHEMA.map(t => t.collection), UID_MAP];

/** One page of one collection: `{ rows, next }`, `next` null at the end. */
export async function exportPage(db, collection, after = null) {
  if (collection === UID_MAP) {
    const { rows } = await db._read(q => q.query(`select firebase_uid, user_id::text as user_id, email from public.${qi(UID_MAP)}
      where ($1::text is null or firebase_uid > $1) order by firebase_uid collate "C" limit ${PAGE_ROWS}`, [after?.id ?? null]));
    return { rows, next: rows.length === PAGE_ROWS ? { id: rows.at(-1).firebase_uid } : null };
  }
  const table = SCHEMA.find(t => t.collection === collection);
  if (!table) throw Object.assign(new Error(`مجموعة غير معروفة: ${collection}`), { code: 'invalid-argument' });
  const keyed = Boolean(table.parentTable);
  const order = keyed ? 'parent_ref collate "C", id collate "C"' : 'id collate "C"';
  const [where, params] = !after ? ['true', []]
    : keyed ? ['(parent_ref, id) > ($1::text, $2::text)', [after.parent ?? '', after.id]] : ['id > $1::text', [after.id]];
  const out = []; let bytes = 0; let next = null;
  await db._read(async (q) => {
    const { rows } = await q.query(`select * from public.${qi(table.table)} where ${where} order by ${order} limit ${PAGE_ROWS + 1}`, params);
    const page = rows.slice(0, PAGE_ROWS);
    let lines = new Map();
    if (table.lines && page.length) {
      const { rows: lineRows } = await q.query(`select * from public.${qi(table.lines)} where entry_id = any($1) order by entry_id, line_no`, [page.map(r => r.id)]);
      lines = lineRows.reduce((m, l) => m.set(l.entry_id, [...(m.get(l.entry_id) || []), l]), new Map());
    }
    for (const row of page) {
      const data = toTagged(decodeDocument(table, row, lines.get(row.id), TAGGED));
      const path = keyed ? `${table.collection.replace('/*/', `/${row.parent_ref}/`)}/${row.id}` : `${table.collection}/${row.id}`;
      const item = { id: row.id, path, data };
      bytes += JSON.stringify(item).length;
      out.push(item);
      if (bytes >= PAGE_BYTES) break;
    }
    const last = out.at(-1);
    if (out.length < page.length || rows.length > PAGE_ROWS) next = last ? { parent: last.path.split('/').at(-3) ?? null, id: last.id } : null;
    if (next && !keyed) next.parent = null;
  });
  return { rows: out, next };
}

export function createBackupExportHandler(getRuntime = supabaseRuntime) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Vary', 'Authorization');
    if (!onSupabase()) return res.status(404).json({ error: { code: 'not-found' } });
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: { code: 'invalid-argument' } }); }
    const token = /^Bearer (.+)$/.exec(String(req.headers.authorization || ''))?.[1];
    if (!token) return res.status(401).json({ error: { code: 'unauthenticated' } });
    let runtime; let caller;
    try { runtime = getRuntime(); } catch { return res.status(503).json({ error: { code: 'unavailable' } }); }
    try { caller = await runtime.auth.verifyIdToken(token, true); } catch { return res.status(401).json({ error: { code: 'unauthenticated' } }); }
    try {
      const role = await callerRole(runtime.db, { uid: caller.uid }).catch(() => null);
      if (role !== 'admin') return res.status(403).json({ error: { code: 'permission-denied', message: 'النسخة الاحتياطية للمدير وحده.' } });
      const input = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      if (input.list) return res.status(200).json({ result: { collections: BACKUP_COLLECTIONS } });
      const collection = String(input.collection || '');
      if (!BACKUP_COLLECTIONS.includes(collection)) return res.status(400).json({ error: { code: 'invalid-argument', message: 'مجموعة غير معروفة.' } });
      const after = input.after && typeof input.after === 'object' ? { parent: input.after.parent == null ? null : String(input.after.parent), id: String(input.after.id) } : null;
      return res.status(200).json({ result: await exportPage(runtime.db, collection, after) });
    } catch (error) {
      const code = error instanceof SyntaxError ? 'invalid-argument' : error.code;
      const status = { 'invalid-argument': 400, 'permission-denied': 403 }[code] || 500;
      return res.status(status).json({ error: { code: status === 500 ? 'internal' : code, message: status === 500 ? 'تعذّرت قراءة النسخة الاحتياطية.' : error.message } });
    }
  };
}
export default createBackupExportHandler();
