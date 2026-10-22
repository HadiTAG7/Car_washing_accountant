// ═══════════════════════════════════════════════════════════════════════════
// مصادر قائمة الدخل لأشهرٍ بعينها — بدل قراءة إحدى عشرة مجموعة كاملة
// ═══════════════════════════════════════════════════════════════════════════
// قائمة الدخل كانت تُبنى من مستمعين حيّين على مجموعات كاملة: كل غسلة وكل قيد
// منذ اليوم الأول، مع كل فتح للنظرة العامة. هنا تُقرأ الأشهر المطلوبة وحدها،
// بشرطٍ واحد: كل ناتج (`liveIncomeStatement`، `unpaidPayrollIncome`،
// `overviewOperations`، القسائم المستحقة) يطابق ناتجه من المجموعات كاملة.
// اختبار الخاصية (`__tests__/incomeStatementScope.test.js`) يثبت ذلك على
// بيانات عشوائية بكل الحالات الحدّية.
//
// كل الاستعلامات حقلٌ واحد (فهرس تلقائي، بلا firestore.indexes.json):
//   • النطاق الشهري بادئةٌ لا أيام: [YYYY-MM, الشهر التالي) — الكود يقارن
//     `slice(0, 7)`، فقيمٌ مثل '2026-10' و'2026-10-05T09:00' تدخل.
//   • الغسلات: أشهر الغسلات (النظرة العامة تزيل التكرار حتى اليوم).
//   • المصاريف: اتحاد نطاقات الحقول التي قد يُؤخذ منها التاريخ.
//   • القيود: (E0) تاريخ القيد في أشهر القائمة؛ (E1) كل قيود الرواتب — فحص
//     «بلا شهر استحقاق» يمرّ على كل سطور الرواتب؛ (E2) قيود مصادر النافذة
//     المرحّلة بتاريخ خارجها؛ (E3) أصول كل قيد عكسٍ محمَّل.
//   • تكرار حجز سويتر عبر الأشهر: `count()` لكل 30 معرّفاً، والجلب للفرق فقط.
// وكل قائمة تُرتَّب بمعرّف المستند كما تُرجعها قراءة المجموعة كاملة: إزالة
// التكرار تأخذ الأول، وترتيب الجمع العشري واختيار بند التقريب يعتمدان عليه.
// ═══════════════════════════════════════════════════════════════════════════

import { mapWash } from '../mappers.js';
import { isRealCalendarDate } from '../vatFields.js';
import { sourceKindOf } from './reports.js';

const PAYROLL_KINDS = ['payroll', 'payroll_reversal'];
const IN_LIMIT = 30;

export const nextMonthKey = key => {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
};
export const monthsBetween = (from, to) => {
  const out = [];
  for (let key = from; key <= to; key = nextMonthKey(key)) out.push(key);
  return out;
};

/** Firestore orders document ids by UTF-8 bytes, which is code-point order. */
export function compareIds(a, b) {
  const x = [...String(a)]; const y = [...String(b)];
  for (let i = 0; i < Math.min(x.length, y.length); i += 1) {
    const d = x[i].codePointAt(0) - y[i].codePointAt(0);
    if (d) return d;
  }
  return x.length - y.length;
}
const sortById = rows => [...rows].sort((a, b) => compareIds(a.id, b.id));
const union = (...lists) => {
  const byId = new Map();
  for (const list of lists) for (const row of list) if (!byId.has(row.id)) byId.set(row.id, row);
  return sortById(byId.values());
};
const chunks = values => {
  const out = [];
  for (let i = 0; i < values.length; i += IN_LIMIT) out.push(values.slice(i, i + IN_LIMIT));
  return out;
};

// The same date choices `liveIncomeStatement` makes (kept here so the loader
// reads exactly the rows the statement could use).
export const expenseDateOf = row => (isRealCalendarDate(row.invoice_date) ? row.invoice_date : row.logged_date || row.spent_date);
export const voucherDateOf = row => (isRealCalendarDate(row.invoiceDate) ? row.invoiceDate : row.dueDate);
const monthOfDate = value => String(value || '').slice(0, 7);
const recognized = e => ['posted', 'reversed'].includes(e.status) && !e.reversalOf;

/**
 * Reads the statement sources for `statementMonths` (and washes for
 * `washMonths`, a superset) through `exec`:
 *   all(c) · range(c, field, from, toExclusive) · equals(c, field, v) ·
 *   notNull(c, field) · inValues(c, field, values≤30) · byIds(c, ids≤30) ·
 *   count(c, field, values≤30) · probe(c)
 * Each returns rows shaped `{ ...data, id }` (count → number, probe → bool).
 * `cached(key, tags, fn)` lets the caller share month units between pages.
 */
export async function loadScopedIncomeSources(exec, {
  statementMonths, washMonths = statementMonths, withBikers = false, cached = (key, tags, fn) => fn(),
} = {}) {
  const ms = [...new Set(statementMonths)].sort();
  const mw = [...new Set([...washMonths, ...ms])].sort();
  const monthUnit = (collection, field, month) => cached(`${collection}:${field}:${month}`, [collection],
    () => exec.range(collection, field, month, nextMonthKey(month)));
  const overMonths = (collection, fields, months) => Promise.all(fields.flatMap(field => months.map(m => monthUnit(collection, field, m))))
    .then(lists => union(...lists));

  // ── Round 1: the windows, the small registers and the payroll journal ──
  const payrollQueries = ['sourceType', 'sourceKind', 'reversedSourceType', 'reversedSourceKind']
    .map(field => exec.inValues('journal_entries', field, PAYROLL_KINDS));
  const [washes, variables, annualEntries, vouchers, monthlies, settlements, flaggedA, flaggedB,
    windowEntries, payrollEntries, hasLegacyLines, bikers] = await Promise.all([
    overMonths('washes', ['wash_date'], mw),
    overMonths('variable_expenses', ['invoice_date', 'logged_date', 'spent_date'], ms),
    overMonths('annual_expense_entries', ['invoice_date', 'logged_date', 'spent_date'], ms),
    overMonths('expense_vouchers', ['invoiceDate', 'dueDate'], ms),
    cached('monthly_expenses', ['monthly_expenses'], () => exec.all('monthly_expenses')).then(sortById),
    cached('sweater_settlements', ['sweater_settlements'], () => exec.all('sweater_settlements')).then(sortById),
    cached('sweater_bookings:posted', ['sweater_bookings'], () => exec.equals('sweater_bookings', 'processingStatus', 'posted')),
    cached('sweater_bookings:postedEntry', ['sweater_bookings'], () => exec.notNull('sweater_bookings', 'postedEntryId')),
    overMonths('journal_entries', ['entryDate'], ms),
    cached('journal_entries:payroll', ['journal_entries'], () => Promise.all(payrollQueries).then(lists => union(...lists))),
    cached('journal_lines:any', ['journal_lines'], () => exec.probe('journal_lines')),
    withBikers ? cached('bikers', ['bikers'], () => exec.all('bikers')).then(sortById) : Promise.resolve(undefined),
  ]);
  const bookings = union(flaggedA, flaggedB);
  let entries = union(windowEntries, payrollEntries);
  let allWashes = washes;

  // ── Round 2: postings of window sources dated outside the window ──
  // A source with its LIVE posting already loaded needs no lookup: posting
  // locks allow one live entry per source, and that entry is all the statement
  // (and the summary's posted-wash figures) consult. A source whose only
  // loaded entry was reversed is looked up: its re-posting may be elsewhere.
  const liveFor = new Set();
  const noteLive = list => {
    for (const e of list) if (e.status === 'posted' && !e.reversalOf && e.sourceId != null) liveFor.add(`${sourceKindOf(e)}:${e.sourceId}`);
  };
  noteLive(entries);
  const expenseCandidates = [
    ...variables.map(row => ['variable', row, expenseDateOf(row)]),
    ...monthlies.filter(row => row.recurrence === 'one_time').map(row => ['monthly', row, expenseDateOf(row)]),
    ...annualEntries.map(row => ['annual', row, expenseDateOf(row)]),
    ...vouchers.filter(row => row.status !== 'cancelled').map(row => ['voucher', row, voucherDateOf(row)]),
  ].filter(([, , date]) => isRealCalendarDate(date) && ms.includes(monthOfDate(date)));
  const wanted = new Set();
  for (const raw of allWashes) if (!liveFor.has(`wash:${raw.id}`)) wanted.add(String(raw.id));
  for (const [kind, row] of expenseCandidates) {
    if (!liveFor.has(`${kind}:${row.id}`) && !liveFor.has(`expense:${row.id}`)) wanted.add(String(row.id));
  }
  for (const row of settlements) if (!liveFor.has(`sweater_settlement:${row.id}`)) wanted.add(String(row.id));
  const bySource = async ids => (await Promise.all(chunks([...ids]).map(c => exec.inValues('journal_entries', 'sourceId', c)))).flat();
  entries = union(entries, await bySource(wanted));

  // ── Round 3: a booking executed in this window and posted from another month ──
  const postedIndex = new Set();
  for (const e of entries) if (recognized(e)) postedIndex.add(`${sourceKindOf(e)}:${e.sourceId}`);
  const knownPosted = new Set();
  for (const s of settlements) {
    if (postedIndex.has(`sweater_settlement:${s.id}`)) for (const row of s.figures?.lines?.eligible || []) knownPosted.add(row.sspBookingId);
  }
  for (const b of bookings) if (b.postedEntryId || b.processingStatus === 'posted') knownPosted.add(b.sspBookingId);
  for (const raw of allWashes) if (raw.ssp_booking_id && postedIndex.has(`wash:${raw.id}`)) knownPosted.add(raw.ssp_booking_id);
  const candidateBookings = new Set();
  for (const raw of allWashes) {
    const w = mapWash(raw);
    if (w.status === 'مكتملة' && ms.includes(w.washDate.slice(0, 7)) && raw.ssp_booking_id && !knownPosted.has(raw.ssp_booking_id)) {
      candidateBookings.add(raw.ssp_booking_id);
    }
  }
  const loadedPer = new Map();
  for (const raw of allWashes) if (raw.ssp_booking_id) loadedPer.set(raw.ssp_booking_id, (loadedPer.get(raw.ssp_booking_id) || 0) + 1);
  const extraWashes = [];
  await Promise.all(chunks([...candidateBookings]).map(async chunk => {
    const total = await exec.count('washes', 'ssp_booking_id', chunk);
    if (total === chunk.reduce((n, id) => n + (loadedPer.get(id) || 0), 0)) return;
    const loadedIds = new Set(allWashes.map(row => row.id));
    extraWashes.push(...(await exec.inValues('washes', 'ssp_booking_id', chunk)).filter(row => !loadedIds.has(row.id)));
  }));
  if (extraWashes.length) {
    allWashes = union(allWashes, extraWashes);
    entries = union(entries, await bySource(new Set(extraWashes.map(row => String(row.id)))));
  }

  // ── Round 4: the original of every loaded reversal ──
  for (let guard = 0; guard < 20; guard += 1) {
    const have = new Set(entries.map(e => e.id));
    const missing = [...new Set(entries.flatMap(e => [e.reversalOf, e.reversesEntryId]).filter(id => id && !have.has(id)))];
    if (!missing.length) break;
    const found = (await Promise.all(chunks(missing).map(c => exec.byIds('journal_entries', c)))).flat();
    if (!found.length) break;
    entries = union(entries, found);
  }

  // ── Round 5: the frozen legacy lines, read once per session if any exist ──
  let legacyLines = [];
  if (hasLegacyLines) {
    const all = await cached('journal_lines', ['journal_lines'], () => exec.all('journal_lines'));
    const ids = new Set(entries.map(e => e.id));
    legacyLines = sortById(all.filter(line => ids.has(line.entryId)));
  }

  return {
    washes: allWashes, variables, monthlies, annualEntries, vouchers, bookings, settlements,
    journalEntries: entries, legacyLines, ...(withBikers ? { bikers } : {}),
  };
}
