// A read-only projection of a saved report. Never use live balances to fill
// historical gaps, or parse narrative numbers as financial metrics.
import { readableExecutiveText } from './executiveOwnerSummary.js';

export const FINANCE_NUMBER_ROWS = [
  { id: 'monthly-revenue', label: 'الإيراد', basis: 'operational', monthly: true },
  { id: 'monthly-expenses', label: 'المصروفات', basis: 'operational', monthly: true },
  { id: 'monthly-result', label: 'نتيجة الشهر', basis: 'operational', monthly: true },
  { id: 'bank-ledger', label: 'البنك', basis: 'ledger' },
  { id: 'cash-ledger', label: 'الصندوق', basis: 'ledger' },
  { id: 'monthly-vat-net', label: 'الضريبة المستحقة', basis: 'operational', monthly: true },
];
const currency = /^(?:ريال|ريال سعودي|ر\.?\s?س\.?|SAR)$/i;
export const financeMoney = value => new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
export function savedFinanceNumbers(report, previous = null) {
  return FINANCE_NUMBER_ROWS.map(row => {
    const metric = report?.metrics.find(item => item.id === row.id && item.basis === row.basis && currency.test(item.unit)
      && Date.parse(item.asOf) <= Date.parse(report.cutAtRiyadh));
    const before = previous?.sourceRole === report?.sourceRole && previous?.period.kind === report?.period.kind
      && Date.parse(previous.cutAtRiyadh) < Date.parse(report.cutAtRiyadh)
      && (!row.monthly || previous.dateRiyadh.slice(0, 7) === report.dateRiyadh.slice(0, 7))
      ? previous.metrics.find(item => item.id === row.id && item.basis === row.basis && currency.test(item.unit)
        && Date.parse(item.asOf) <= Date.parse(previous.cutAtRiyadh)) : null;
    return { ...row, value: metric?.value ?? null, asOf: metric?.asOf || null, coverage: metric?.coverage || null,
      change: Number.isFinite(metric?.value) && Number.isFinite(before?.value) ? Math.round((metric.value - before.value) * 100) / 100 : null };
  });
}
export const readableFinanceText = value => readableExecutiveText(value)
  .replace(/([ء-ي])([A-Za-z])/gu, '$1 $2').replace(/([A-Za-z])([ء-ي])/gu, '$1 $2');

function plain(value) {
  return readableFinanceText(value)
    .replace(/\b(?:CFO|Q4|EXPENSE|TAX|OPS|finance)[-_][A-Za-z0-9_-]+\b/g, '')
    .replace(/\b[A-Za-z0-9_-]{18,}\b/g, '')
    .replace(/(?:المستند|المصدر|الأصل|مرجع|أداة)\s*\d+(?:\s*[،/و–-]\s*\d+)*/gu, match => match.replace(/\s*\d.*$/u, ''))
    .replace(/\s+/g, ' ').replace(/^[\s:—،؛-]+|[\s:—،؛-]+$/gu, '').trim();
}
export function financeSentence(value, maxWords = 20) {
  const sentence = plain(value).split(/(?:[؛؟!]|\.(?!\d))/u)[0].trim();
  const words = sentence.split(/\s+/u).filter(Boolean);
  return words.length > maxWords ? `${words.slice(0, maxWords).join(' ')}…` : sentence;
}
// Only amounts explicitly labelled as money. Invoice numbers, dates, IDs,
// account codes and quantities must never determine monetary priority.
export function mentionedMoney(text) {
  const value = readableFinanceText(text).replace(/([\d])([A-Za-z])/g, '$1 $2');
  const amounts = [...value.matchAll(/(-?\d[\d,]*(?:\.\d{1,2})?)\s*(?:ريال|ر\.\s?س|SAR)(?=$|[^\p{L}])/giu),
    ...value.matchAll(/(?:بمبلغ|مبلغ|رصيد|قيمة|تكلفة|فرق)\s*[:=]?[\s]*(-?\d[\d,]*(?:\.\d{1,2})?)/gu)]
    .map(match => Math.abs(Number(match[1].replaceAll(',', '')))).filter(Number.isFinite);
  return amounts.length ? Math.max(...amounts) : null;
}
export function financePriority(text, severity = 'open') {
  const cash = /الصندوق|البنك|النقد|نقدي|رأس\s*المال|رؤوس\s*الأموال|\b(?:cash|bank|capital)\b/iu.test(readableFinanceText(text));
  const amount = mentionedMoney(text);
  return { cash, amount, critical: cash || amount > 1000 || severity === 'critical' };
}
const byPriority = (a, b) => Number(b.cash) - Number(a.cash) || Number(b.critical) - Number(a.critical) || (b.amount || 0) - (a.amount || 0);
function warningText(warning) {
  const text = readableFinanceText(warning.text);
  if (/سيولة|غير\s*مجرود|غير\s*مطابق.*كشف/u.test(text)) return 'أرصدة البنك والصندوق دفترية؛ المطابقة مع كشف البنك وجرد الصندوق غير مكتملة.';
  if (/مرشح.*صفوف|غياب بيانات|مصدر العمليات غير متاح/u.test(text)) return 'بيانات الغسلات غير مكتملة؛ لا يمكن تأكيد الإيراد أو التحصيل من غياب السجلات.';
  if (/فجوة.*بنود|قدرة بنود|تجزئة متعددة البنود/u.test(text)) return 'تسجيل الفواتير متعددة البنود غير مكتمل؛ بعض المصروفات ما زالت معلقة.';
  return financeSentence(text);
}
const technicalOnly = text => /حد الاستخدام|حمولة|مركز القيادة|حارس التنفيذ|أحداث|HTTP|أداة|جولات|تحقق.*ذاتي|رقابة مستقلة/iu.test(text);
export function financeOwnerView(report, previous = null) {
  if (!report) return null;
  const numbers = savedFinanceNumbers(report, previous), cash = numbers.find(row => row.id === 'cash-ledger');
  const candidates = report.visibleWarnings.filter(w => !technicalOnly(w.text) || financePriority(w.text, w.severity).critical).map(w => ({ id: w.id, text: warningText(w),
    ...financePriority(w.text, w.severity), original: w.text }));
  if (Number.isFinite(cash.value) && cash.value < 0) candidates.unshift({ id: 'saved-negative-cash', cash: true, critical: true,
    amount: Math.abs(cash.value), text: `الصندوق الدفتري سالب بمبلغ ${financeMoney(Math.abs(cash.value))} ريال.`, original: cash.coverage });
  const seen = new Set();
  const notes = candidates.sort(byPriority).filter(note => {
    const key = /الصندوق|أرصدة البنك/u.test(note.text) ? 'cash' : note.text;
    if (seen.has(key)) return false; seen.add(key); return true;
  }).slice(0, 3);
  const major = notes.filter(note => note.id === 'saved-negative-cash' || (note.amount == null || note.amount >= 500)
    && (!/فاتورة|بنود|مسجلة|مستند|تصحيح/u.test(note.original || '') || note.amount >= 500));
  // A short owner summary is selected from the saved financial issues, not
  // a fresh interpretation of internal work logs. The original remains below.
  const summary = major.slice(0, 2).map(note => financeSentence(note.text));
  if (!summary.length) {
    const sentences = readableFinanceText(report.summary).split(/[؛!؟]|\.(?!\d)/u).filter(Boolean);
    for (const sentence of sentences) {
      if (summary.length === 2) break;
      if (technicalOnly(sentence) || /\b(?:CFO|Q4|EXPENSE)[-_]|المستند\s*\d|المصدر\s*\d|قيد|معرف|حُفظ|صُحح|نسخة/u.test(sentence)) continue;
      const amount = mentionedMoney(sentence);
      if (amount !== null && amount < 500) continue;
      const clean = financeSentence(sentence); if (clean && /[ء-ي]/u.test(clean)) summary.push(clean);
    }
  }
  if (!summary.length) summary.push('لا تتوفر خلاصة مالية واضحة في النص المحفوظ؛ راجع التفاصيل.');
  const previousCash = previous?.metrics.find(item => item.id === 'cash-ledger' && item.basis === 'ledger');
  const result = numbers.find(row => row.id === 'monthly-result');
  const headline = cash.value < 0 ? previousCash?.value < 0 ? 'الصندوق ما زال سالب' : 'رصيد الصندوق سالب'
    : result.value !== null ? result.value < 0 ? 'نتيجة الشهر خسارة' : result.value > 0 ? 'نتيجة الشهر ربح' : 'نتيجة الشهر متعادلة'
      : financeSentence(major[0]?.text || (/فاتورة|مستند|المصدر|تصحيح|CFO|Q4/u.test(report.title) ? 'ملخص المالية' : report.title), 12) || 'ملخص المالية';
  const decisions = report.cases.filter(item => item.status === 'awaiting_owner').map(item => ({ id: item.caseId,
    text: /[ء-ي]/u.test(item.next) ? financeSentence(item.next) : 'طلب قرار محفوظ دون صياغة عربية واضحة؛ راجع تفاصيله.',
    ...financePriority(`${item.title} ${item.next}`) })).sort(byPriority);
  return { numbers, notes, decisions, summary, headline, savedCount: numbers.filter(row => row.asOf).length };
}
export function financeReportUrl(report) {
  return `https://app.hadialghanim.com/?page=finance_reports&report=${encodeURIComponent(report.reportId)}&revision=${report.revision}`;
}
export function financeArchiveSearch(report, query) {
  return readableFinanceText(JSON.stringify(report)).toLocaleLowerCase('ar-SA').includes(readableFinanceText(query).toLocaleLowerCase('ar-SA').trim());
}
export const financeDateLabel = day => new Intl.DateTimeFormat('ar-SA-u-ca-gregory', { day: 'numeric', month: 'long', year: 'numeric', numberingSystem: 'latn', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
