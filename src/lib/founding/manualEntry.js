// ═══════════════════════════════════════════════════════════════════════════
// «قيد يدوي بموافقة» — أسطر يكتبها الأدمن، تُحفظ مقترحة وتُرحّل بموافقة هادي
// ═══════════════════════════════════════════════════════════════════════════
// حساب خالص: الخادم يعيد الفحص نفسه عند الحفظ وعند الترحيل، والنموذج يعرضه
// قبل الإرسال. لا قيد غير متوازن، ولا 3200 بلا سبب مكتوب لها، ولا تاريخ في شهر
// مقفل.

export const SETTLEMENTS_ACCOUNT = '3200';
export const MAX_MANUAL_LINES = 30;
const halala = value => Math.round(Number(value || 0) * 100);
// بالهللة: `0.07 * 100` في الفاصلة العائمة 7.000000000000001، فالمقارنة بتسامح لا بالمساواة.
const wholeHalala = value => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
const isMoney = value => value === 0 || (Number.isFinite(value) && value > 0 && wholeHalala(value));
const realDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
/** A partner's capital sub-account: `3000-<partnerId>`. */
export const partnerOfAccount = accountId => /^3000-(.+)$/.exec(String(accountId || ''))?.[1] || null;

export function manualEntryTotals(lines) {
  const debit = (lines || []).reduce((n, l) => n + halala(l.debit), 0), credit = (lines || []).reduce((n, l) => n + halala(l.credit), 0);
  return { debit: debit / 100, credit: credit / 100, difference: (debit - credit) / 100, balanced: debit === credit && debit > 0 };
}

/**
 * ما يمنع القيد من الحفظ أو الترحيل — رسائل عربية.
 * @param entry   { date, description, reason, settlementReason, lines: [{ accountId, debit, credit }] }
 * @param context { accounts: Set أكواد الدليل, partners: [{ id }], closedMonths: Set 'YYYY-MM' }
 */
export function manualEntryProblems(entry, { accounts = new Set(), partners = [], closedMonths = new Set() } = {}) {
  const problems = [], lines = Array.isArray(entry?.lines) ? entry.lines : [];
  if (!realDay(entry?.date)) problems.push('تاريخ القيد مطلوب بصيغة YYYY-MM-DD.');
  else if (closedMonths.has(entry.date.slice(0, 7))) problems.push(`الفترة ${entry.date.slice(0, 7)} مقفلة؛ لا يُقيَّد فيها.`);
  if (typeof entry?.description !== 'string' || entry.description.trim().length < 2) problems.push('بيان القيد مطلوب.');
  if (typeof entry?.reason !== 'string' || entry.reason.trim().length < 5) problems.push('سبب القيد مطلوب (خمسة أحرف على الأقل).');
  if (lines.length < 2) problems.push('القيد يحتاج سطرين على الأقل.');
  if (lines.length > MAX_MANUAL_LINES) problems.push(`أسطر كثيرة؛ الحد ${MAX_MANUAL_LINES} سطرًا.`);
  const partnerIds = new Set(partners.map(p => p.id));
  lines.forEach((line, index) => {
    const n = index + 1, debit = Number(line?.debit) || 0, credit = Number(line?.credit) || 0, account = String(line?.accountId || '').trim();
    if (!account) problems.push(`السطر ${n}: الحساب مطلوب.`);
    else if (!accounts.has(account) && !partnerIds.has(partnerOfAccount(account))) problems.push(`السطر ${n}: الحساب ${account} غير موجود في الدليل.`);
    if (!isMoney(debit) || !isMoney(credit)) problems.push(`السطر ${n}: المبلغ موجب بالهللة.`);
    else if ((debit > 0) === (credit > 0)) problems.push(`السطر ${n}: مدين أو دائن، واحد منهما فقط.`);
  });
  const totals = manualEntryTotals(lines);
  if (lines.length >= 2 && !totals.balanced) problems.push(`القيد غير متوازن: المدين ${totals.debit.toFixed(2)} والدائن ${totals.credit.toFixed(2)}.`);
  if (lines.some(l => String(l?.accountId) === SETTLEMENTS_ACCOUNT)
    && (typeof entry?.settlementReason !== 'string' || entry.settlementReason.trim().length < 5)) problems.push('سطر على 3200 يحتاج سبب استخدام 3200 مكتوبًا.');
  return problems;
}
