// ─── أعمدة كشف الحساب: اكتشافها، وتحويل الصفوف إلى حركات ─────────────────
// الملف يُقرأ في المتصفح فقط. هنا يُعرف صف العناوين وأي عمود هو التاريخ
// والوصف والمدين والدائن (أو عمود مبلغ واحد بإشارة)، ثم تُحوّل الصفوف إلى
// حركات { txDate, direction, amount, ... }. الاكتشاف اقتراح: المستخدم يرى
// الأعمدة ويغيّرها قبل أي خطوة.

export const STATEMENT_FIELDS = ['date', 'description', 'debit', 'credit', 'amount', 'balance', 'reference'];

// Header words as patterns (Arabic and English bank exports). Order matters:
// the first field whose pattern matches a header cell wins.
const PATTERNS = {
  date: /تاريخ|date/,
  description: /وصف|بيان|تفاصيل|description|details|narrative|particulars|remarks/,
  debit: /مدين|سحب|مسحوبات|خصم|debit|withdrawal|^dr$/,
  credit: /دائن|إيداع|ايداع|credit|deposit|^cr$/,
  amount: /مبلغ|amount|^value$/,
  balance: /رصيد|balance/,
  reference: /مرجع|رقم العملية|reference|^ref( no)?$/,
};

// Arabic-Indic and Persian digits, Arabic decimal and thousands separators.
const latinDigits = value => String(value ?? '')
  .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660))
  .replace(/[\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) - 0x06F0))
  .replace(/\u066B/g, '.').replace(/\u066C/g, ',');
const normalizeHeader = value => latinDigits(value).toLowerCase().replace(/[\u064B-\u0652\u0640]/g, '').replace(/[()[\]:.*#/_-]+/g, ' ').replace(/\s+/g, ' ').trim();

function headerField(cell) {
  const text = normalizeHeader(cell);
  if (!text) return null;
  return STATEMENT_FIELDS.find(field => PATTERNS[field].test(text)) || null;
}

/** المبلغ من نص البنك: فواصل، أقواس للسالب، إشارة لاحقة، أرقام عربية، عملة. */
export function parseAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let text = latinDigits(value).replace(/[\s\u00a0\u200f\u200e]/g, '').replace(/(sar|ر\.?س|ريال|﷼)/gi, '');
  if (!text || text === '-') return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) { negative = true; text = text.slice(1, -1); }
  if (/-$/.test(text)) { negative = true; text = text.slice(0, -1); }
  if (/^-/.test(text)) { negative = !negative; text = text.slice(1); }
  if (/^\+/.test(text)) text = text.slice(1);
  // 1.234,56 (European) → 1234.56; 1,234.56 → 1234.56.
  if (/,\d{1,2}$/.test(text) && text.includes('.')) text = text.replace(/\./g, '').replace(',', '.');
  else text = text.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? (negative ? -number : number) : null;
}

const pad = n => String(n).padStart(2, '0');
function validDay(y, m, d) {
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  const date = new Date(`${iso}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}

/**
 * التاريخ من خلية البنك. `order` لترتيب اليوم والشهر حين يكون الشكل
 * DD/MM/YYYY أو MM/DD/YYYY ('dmy' افتراضيًا كما في البنوك السعودية).
 */
export function parseStatementDate(value, order = 'dmy') {
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    return new Date(Math.round((value - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  const text = latinDigits(value).trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(text);
  if (m) return validDay(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(text);
  if (m) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return order === 'mdy' ? validDay(year, +m[1], +m[2]) : validDay(year, +m[2], +m[1]);
  }
  const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  m = /^(\d{1,2})[\s-]([a-z]{3})[a-z]*[\s-](\d{2,4})/i.exec(text);
  if (m && months[m[2].toLowerCase()]) return validDay(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), months[m[2].toLowerCase()], +m[1]);
  return null;
}

/** 'mdy' فقط حين لا يصح غيره (يوم أكبر من 12 في الخانة الثانية). */
export function guessDateOrder(values) {
  let dmy = 0, mdy = 0;
  for (const value of values) {
    const m = /^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/.exec(latinDigits(value).trim());
    if (!m) continue;
    if (+m[1] > 12) dmy += 1;
    if (+m[2] > 12) mdy += 1;
  }
  return mdy > 0 && dmy === 0 ? 'mdy' : 'dmy';
}

/**
 * يقترح صف العناوين والأعمدة: أول صف (من أول 30) فيه تاريخ ومبلغ (مدين/دائن
 * أو مبلغ واحد). يرجع null إن لم يجد — فيختار المستخدم بنفسه.
 */
export function detectColumns(rows) {
  for (let r = 0; r < Math.min(rows.length, 30); r += 1) {
    const columns = {};
    (rows[r] || []).forEach((cell, index) => {
      const field = headerField(cell);
      if (field && columns[field] == null) columns[field] = index;
    });
    if (columns.date != null && (columns.debit != null || columns.credit != null || columns.amount != null)) {
      const mapping = { headerRow: r, amountSign: 'negative_is_debit', ...Object.fromEntries(STATEMENT_FIELDS.map(f => [f, columns[f] ?? null])) };
      if (mapping.debit != null || mapping.credit != null) mapping.amount = null;
      mapping.dateOrder = guessDateOrder(rows.slice(r + 1).map(row => row[mapping.date]));
      return mapping;
    }
  }
  return null;
}

export function emptyMapping() {
  return { headerRow: 0, amountSign: 'negative_is_debit', dateOrder: 'dmy', ...Object.fromEntries(STATEMENT_FIELDS.map(f => [f, null])) };
}

/** ما ينقص في اختيار الأعمدة قبل عرض الحركات. */
export function mappingProblems(mapping) {
  const problems = [];
  if (mapping?.date == null) problems.push('اختر عمود التاريخ.');
  if (mapping?.debit == null && mapping?.credit == null && mapping?.amount == null) problems.push('اختر عمودي المدين والدائن، أو عمود المبلغ.');
  return problems;
}

const cleanText = value => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);

/**
 * صفوف الملف → حركات. الصف الذي لا تاريخ له أو لا مبلغ (ترويسة، مجموع،
 * رصيد افتتاحي) يُترك ويُعدّ في `skipped`. `occurrence` يميّز حركتين
 * متطابقتين في نفس الملف (نفس اليوم والمبلغ والوصف).
 */
export function statementTransactions(rows, mapping) {
  const out = [], seen = new Map();
  let skipped = 0;
  for (let index = mapping.headerRow + 1; index < rows.length; index += 1) {
    const row = rows[index] || [];
    const txDate = parseStatementDate(row[mapping.date], mapping.dateOrder);
    let debit = mapping.debit != null ? Math.abs(parseAmount(row[mapping.debit]) || 0) : 0;
    let credit = mapping.credit != null ? Math.abs(parseAmount(row[mapping.credit]) || 0) : 0;
    if (mapping.amount != null && mapping.debit == null && mapping.credit == null) {
      const signed = parseAmount(row[mapping.amount]) || 0;
      const moneyOut = mapping.amountSign === 'negative_is_credit' ? signed > 0 : signed < 0;
      if (moneyOut) debit = Math.abs(signed); else credit = Math.abs(signed);
    }
    if (!txDate || (debit === 0 && credit === 0) || (debit > 0 && credit > 0)) { skipped += 1; continue; }
    const direction = debit > 0 ? 'debit' : 'credit';
    const amount = Math.round((debit || credit) * 100) / 100;
    const balance = mapping.balance != null ? parseAmount(row[mapping.balance]) : null;
    const description = cleanText(mapping.description != null ? row[mapping.description] : '');
    const reference = cleanText(mapping.reference != null ? row[mapping.reference] : '');
    const identity = JSON.stringify([txDate, direction, amount, description, reference, balance]);
    const occurrence = (seen.get(identity) || 0) + 1;
    seen.set(identity, occurrence);
    out.push({ index, txDate, direction, amount, balance: Number.isFinite(balance) ? Math.round(balance * 100) / 100 : null,
      description, reference, occurrence });
  }
  return { transactions: out, skipped };
}

/** أسماء الأعمدة للاختيار: نص العنوان إن وُجد، وإلا رقم العمود. */
export function columnOptions(rows, headerRow) {
  const width = Math.max(0, ...rows.slice(headerRow, headerRow + 50).map(r => r.length));
  return Array.from({ length: width }, (_, index) => {
    const label = cleanText(rows[headerRow]?.[index]);
    return { index, label: label || `عمود ${index + 1}` };
  });
}
