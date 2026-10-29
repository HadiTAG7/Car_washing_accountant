// ─── قراءة ملف كشف الحساب — Excel أو CSV، بلا مكتبات ──────────────────────
// يرجع الجدول كما في الملف: صفوف من خلايا نصية أو رقمية. لا تفسير هنا لأي
// عمود؛ ذلك في statementColumns.js بعد أن يختار المستخدم الأعمدة.
//
// الأشكال المقبولة:
//   • CSV / TXT (فاصلة، فاصلة منقوطة أو Tab؛ UTF-8 مع BOM أو بدونه)
//   • XLSX (حزمة ZIP فيها XML؛ يُفك الضغط بـ DecompressionStream المدمج)
//   • XLS الذي هو في الحقيقة جدول HTML — كثير من البنوك تصدّره هكذا
// ملف XLS ثنائي قديم (BIFF) لا يُقرأ: يُطلب حفظه XLSX أو CSV.

export class StatementFileError extends Error {}

const decoder = () => new TextDecoder('utf-8');

function sniff(bytes) {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return 'zip';
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) return 'biff';
  const head = decoder().decode(bytes.subarray(0, 2048)).replace(/^\uFEFF/, '').trimStart().toLowerCase();
  if (head.startsWith('<') && /<table|<html|<\?xml/.test(head)) return 'markup';
  return 'text';
}

// ── CSV ────────────────────────────────────────────────────────────────
function detectDelimiter(text) {
  const sample = text.split(/\r?\n/).slice(0, 20).join('\n');
  const counts = [',', ';', '\t'].map(d => [d, sample.split(d).length]);
  return counts.sort((a, b) => b[1] - a[1])[0][0];
}

export function parseCsv(text) {
  const source = String(text || '').replace(/^\uFEFF/, '');
  const delimiter = detectDelimiter(source);
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map(r => r.map(c => c.trim())).filter(r => r.some(c => c !== ''));
}

// ── ZIP (للـ XLSX) ─────────────────────────────────────────────────────
async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new StatementFileError('الملف ليس Excel صالحًا.');
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const files = new Map();
  for (let n = 0; n < count; n += 1) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new StatementFileError('الملف ليس Excel صالحًا.');
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extra = view.getUint16(at + 30, true);
    const comment = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    files.set(name, { method, size, local });
    at += 46 + nameLength + extra + comment;
  }
  return async name => {
    const entry = files.get(name);
    if (!entry) return null;
    const start = entry.local + 30 + view.getUint16(entry.local + 26, true) + view.getUint16(entry.local + 28, true);
    const data = bytes.subarray(start, start + entry.size);
    if (entry.method === 0) return decoder().decode(data);
    if (entry.method === 8) return decoder().decode(await inflateRaw(data));
    throw new StatementFileError('ضغط غير مدعوم داخل ملف Excel.');
  };
}

// ── XML ────────────────────────────────────────────────────────────────
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function unescapeXml(text) {
  return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
const textOf = xml => unescapeXml([...String(xml).matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => m[1]).join(''));
const attr = (tag, name) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

function columnIndex(ref) {
  const letters = /^[A-Z]+/.exec(ref || '')?.[0];
  if (!letters) return null;
  return [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
}

// Built-in date formats (14–22, 45–47) and custom ones made of date letters.
const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
function dateStyles(stylesXml) {
  if (!stylesXml) return new Set();
  const custom = new Map([...stylesXml.matchAll(/<numFmt\s[^>]*>/g)].map(m => [Number(attr(m[0], 'numFmtId')), unescapeXml(attr(m[0], 'formatCode') || '')]));
  const isDate = id => BUILTIN_DATE.has(id) || (custom.has(id) && /[dmy]/i.test(custom.get(id).replace(/"[^"]*"|\[[^\]]*\]/g, '')));
  const cellXfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] || '';
  const out = new Set();
  [...cellXfs.matchAll(/<xf\s[^>]*?\/?>/g)].forEach((m, i) => { if (isDate(Number(attr(m[0], 'numFmtId')))) out.add(i); });
  return out;
}

/** Excel serial day (1900 system) → 'YYYY-MM-DD'. */
export function excelSerialToIso(serial) {
  const ms = Math.round((Number(serial) - 25569) * 86400000);
  return new Date(ms).toISOString().slice(0, 10);
}

function sheetRows(sheetXml, shared, dates) {
  const rows = [];
  for (const rowMatch of sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const c of rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const open = c[1], body = c[2] || '';
      const index = columnIndex(attr(open, 'r')) ?? row.length;
      const type = attr(open, 't');
      const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = '';
      if (type === 's') value = shared[Number(raw)] ?? '';
      else if (type === 'inlineStr') value = textOf(body);
      else if (type === 'str' || type === 'e') value = unescapeXml(raw ?? '');
      else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
      else if (raw != null && raw !== '') {
        const number = Number(raw);
        value = dates.has(Number(attr(open, 's'))) && Number.isFinite(number) ? excelSerialToIso(number) : number;
      }
      row[index] = value;
    }
    rows.push(Array.from(row, v => v ?? ''));
  }
  return rows.map(r => r.map(v => typeof v === 'string' ? v.trim() : v)).filter(r => r.some(v => v !== ''));
}

async function readXlsx(bytes) {
  const read = await unzip(bytes);
  const workbook = await read('xl/workbook.xml');
  if (!workbook) throw new StatementFileError('الملف ليس Excel صالحًا.');
  const rels = await read('xl/_rels/workbook.xml.rels') || '';
  const targets = new Map([...rels.matchAll(/<Relationship\s[^>]*>/g)].map(m => [attr(m[0], 'Id'), attr(m[0], 'Target')]));
  const sharedXml = await read('xl/sharedStrings.xml') || '';
  const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => textOf(m[1]));
  const dates = dateStyles(await read('xl/styles.xml'));
  const sheets = [];
  for (const m of workbook.matchAll(/<sheet\s[^>]*>/g)) {
    const target = targets.get(attr(m[0], 'r:id')) || '';
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    const xml = await read(path);
    if (xml) sheets.push({ name: unescapeXml(attr(m[0], 'name') || ''), rows: sheetRows(xml, shared, dates) });
  }
  return sheets;
}

// ── جدول HTML (XLS مزيّف) ───────────────────────────────────────────────
function stripTags(html) {
  return unescapeXml(String(html).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')).replace(/\s+/g, ' ').trim();
}
function readMarkup(text) {
  const tables = [...text.matchAll(/<table\b[\s\S]*?<\/table>/gi)].map((t, i) => ({
    name: String(i + 1),
    rows: [...t[0].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
      .map(r => [...r[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => stripTags(c[1])))
      .filter(r => r.some(c => c !== '')),
  }));
  if (tables.length) return tables;
  // SpreadsheetML 2003 (XML): <Row><Cell><Data>…</Data></Cell></Row>
  const rows = [...text.matchAll(/<(?:ss:)?Row\b[^>]*>([\s\S]*?)<\/(?:ss:)?Row>/gi)]
    .map(r => [...r[1].matchAll(/<(?:ss:)?Data\b[^>]*>([\s\S]*?)<\/(?:ss:)?Data>/gi)].map(c => stripTags(c[1])))
    .filter(r => r.some(c => c !== ''));
  return [{ name: '1', rows }];
}

/**
 * يقرأ ملف كشف الحساب ويرجع أوراقه: [{ name, rows }].
 * `bytes` Uint8Array، و`name` اسم الملف (للرسائل فقط).
 */
export async function readStatementBytes(bytes) {
  const kind = sniff(bytes);
  if (kind === 'biff') throw new StatementFileError('ملف XLS قديم: افتحه في Excel واحفظه بصيغة XLSX أو CSV ثم ارفعه.');
  const sheets = kind === 'zip' ? await readXlsx(bytes)
    : kind === 'markup' ? readMarkup(decoder().decode(bytes))
      : [{ name: '1', rows: parseCsv(decoder().decode(bytes)) }];
  const withRows = sheets.filter(s => s.rows.length);
  if (!withRows.length) throw new StatementFileError('ما لقيت أي صفوف في الملف.');
  return withRows;
}

export async function readStatementFile(file) {
  return readStatementBytes(new Uint8Array(await file.arrayBuffer()));
}
