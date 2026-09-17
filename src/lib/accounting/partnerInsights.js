// ═══════════════════════════════════════════════════════════════════════════
// مؤشرات الشريك — استرداد رأس المال، والتغيّر الشهري، ومنذ بداية السنة
// ═══════════════════════════════════════════════════════════════════════════
// الشريك يسأل سؤالاً واحداً في النهاية: «متى يرجع رأس مالي؟». الصفحة كانت
// تعرض ربح الشهر ولا تجمعه. هذه الدوال تجمع: حصّته من صافي الربح منذ أول
// قيدٍ مُرحَّل، مقابل ما دفعه — ونسبةُ الاسترداد، وتقديرُ ما بقي من أشهرٍ
// بمتوسط آخر ستة.
//
// نقيّة كلها: تأخذ صفوفاً وتُرجع أرقاماً، فتخدم صفحة الشريك وأداة المساعد
// الذكي معاً، ولا يختلف رقمٌ هنا عن رقمٍ هناك.
// ═══════════════════════════════════════════════════════════════════════════

import { round2 } from './journal.js';

const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

/**
 * استرداد رأس المال.
 *
 * `nets` صفوف `{ month, netProfit }` — حصّة الشريك، مرتّبةً أو لا (تُرتَّب هنا).
 * التقدير يُبنى على متوسط آخر `window` شهراً **فيها حركة**: شهرٌ فارغ لأن
 * الدفاتر لم تُرحَّل بعد ليس شهراً بلا ربح. ولا تقدير حين يكون المتوسط صفراً
 * أو سالباً — «غير محدد» أصدق من رقمٍ لا نهائي.
 */
export function roiSummary({ nets = [], paid = 0, window = 6 } = {}) {
  const rows = [...(nets || [])]
    .filter((r) => r && /^\d{4}-\d{2}$/.test(String(r.month)))
    .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
  const cumulativeProfit = round2(rows.reduce((s, r) => s + (Number(r.netProfit) || 0), 0));
  const paidAmount = round2(Number(paid) || 0);
  const remaining = round2(Math.max(0, paidAmount - cumulativeProfit));
  const recovered = paidAmount > 0 && cumulativeProfit >= paidAmount;
  const recoveredPercent = paidAmount > 0 ? round1((cumulativeProfit / paidAmount) * 100) : 0;

  const recent = rows.filter((r) => r.hasActivity !== false).slice(-window);
  const avgRecent = recent.length
    ? round2(recent.reduce((s, r) => s + (Number(r.netProfit) || 0), 0) / recent.length)
    : 0;
  let monthsToRecover = null;
  if (paidAmount > 0 && !recovered && avgRecent > 0) {
    monthsToRecover = Math.ceil(remaining / avgRecent);
  }

  return {
    cumulativeProfit,
    paid: paidAmount,
    remaining,
    recovered,
    recoveredPercent,
    avgRecent,
    monthsAveraged: recent.length,
    monthsToRecover,
    firstMonth: rows[0]?.month ?? null,
    lastMonth: rows[rows.length - 1]?.month ?? null,
    monthsCounted: rows.length,
  };
}

/**
 * التغيّر عن الشهر السابق.
 *
 * النسبة `null` حين لا سابق أو حين السابق صفر — «▲ ∞٪» ليس معلومة. والاتجاه
 * يُحسب على القيمة المطلقة كي يقرأ الشريك «خسارتك صغرت» تحسّناً لا تراجعاً.
 */
export function momChange(current, previous) {
  const cur = Number(current) || 0;
  if (previous === null || previous === undefined) return { delta: null, percent: null, direction: 'flat' };
  const prev = Number(previous) || 0;
  const delta = round2(cur - prev);
  const percent = prev !== 0 ? round1((delta / Math.abs(prev)) * 100) : null;
  return {
    delta,
    percent,
    direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
  };
}

/** مجموع حصّته منذ بداية سنةٍ بعينها (`'2026'`) — من الصفوف نفسها. */
export function ytdTotal(nets = [], year) {
  const y = String(year || '').slice(0, 4);
  return round2((nets || [])
    .filter((r) => String(r?.month || '').startsWith(`${y}-`))
    .reduce((s, r) => s + (Number(r.netProfit) || 0), 0));
}

/**
 * حال الفترة: `'closed'` نهائية، `'open'` قد تتغيّر، `null` لا سجل.
 *
 * مستندات `accounting_periods` معرّفها `YYYY-MM` وفيها `status`؛ وقد تأتي
 * بالشكل `{ id }` من القارئ أو `{ periodKey }` من الخادم — يُقبل الاثنان.
 */
export function periodStatusOf(periods = [], periodKey) {
  const key = String(periodKey || '');
  const p = (periods || []).find((x) => String(x?.periodKey ?? x?.id ?? x?.key) === key);
  if (!p) return null;
  return p.status === 'closed' ? 'closed' : 'open';
}

/** «10 من أصل 100» — العدّ بحصّته، بمنزلةٍ عشرية واحدة. */
export function washShare(companyCount, factor) {
  return round1((Number(companyCount) || 0) * (Number(factor) || 0));
}
