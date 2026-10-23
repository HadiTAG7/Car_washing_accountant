// Shared read-only approval checks. No policy defaults, recalculation writes or posting.
const presentNumber = value => ['number', 'string'].includes(typeof value) && String(value).trim() !== '' && Number.isFinite(Number(value));
const canonical = value => Array.isArray(value) ? value.map(canonical).sort((a, b) => String(a?.sspBookingId || '').localeCompare(String(b?.sspBookingId || '')))
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export function reviewLines(figures) {
  return [...(figures?.lines?.review || []), ...(figures?.lines?.unknown || [])];
}
export function settlementReviewCount(figures) {
  return Math.max(reviewLines(figures).length, (Number(figures?.counts?.needsReview) || 0) + (Number(figures?.counts?.unknownStatus) || 0));
}
export function settlementApprovalReadiness({ settlement, variances = [], bookings, freshFigures, readsPending = false, readError = false } = {}) {
  const figures = settlement?.figures;
  const problems = [];
  if (readsPending || readError) problems.push(readError ? 'تعذرت قراءة متطلبات الاعتماد؛ لا يمكن تأكيد اكتمالها.' : 'جارٍ قراءة متطلبات الاعتماد.');
  if (!figures || !presentNumber(figures?.netDue)) problems.push('الشهر لم يُحتسب.');
  const reviewCount = settlementReviewCount(figures);
  if (reviewCount) problems.push(`${reviewCount} حجزًا يحتاج مراجعة قبل الاعتماد.`);
  if (!presentNumber(settlement?.statement?.statedNetDue)) problems.push('كشف سويتر لم يُسجّل.');
  const hasReason = row => Boolean(String(row?.reasonAr || row?.reviewerNote || '').trim());
  const differences = variances.filter(row => presentNumber(row.difference) && Math.abs(Number(row.difference)) >= 0.01);
  const statementDifference = presentNumber(settlement?.statement?.statedNetDue) && presentNumber(figures?.netDue)
    ? Math.round((Number(settlement.statement.statedNetDue) - Number(figures.netDue)) * 100) / 100 : 0;
  if (differences.some(row => !hasReason(row)) || (Math.abs(statementDifference) >= 0.01 && !differences.some(row =>
    row.kind === 'statement_vs_expected' && Math.abs(Number(row.difference) - statementDifference) < 0.01 && hasReason(row)))) {
    problems.push('يوجد فرق بلا سبب مكتوب؛ راجع المطابقة والفروق.');
  }
  // An old saved result must not silently approve a newly imported population.
  if (figures && bookings) {
    const saved = Object.values(figures.lines || {}).flat().map(row => row.sspBookingId).sort();
    const current = bookings.map(row => (row.record ?? row).sspBookingId).sort();
    if (JSON.stringify(saved) !== JSON.stringify(current)) problems.push('الحجوزات تغيّرت بعد آخر احتساب؛ يلزم إعادة الاحتساب بعد المراجعة.');
  }
  if (freshFigures && JSON.stringify(canonical(freshFigures)) !== JSON.stringify(canonical(figures))) problems.push('مصادر الشهر أو إعداداته تغيّرت؛ يلزم إعادة الاحتساب قبل الاعتماد.');
  if (figures && !(Number(figures.services?.gross) > 0)) problems.push('لا خدمات مؤهّلة للترحيل.');
  if (settlement && !['statement_received', 'under_review', 'disputed'].includes(settlement.status)) problems.push('حالة الشهر لا تسمح باعتماد جديد؛ يلزم تسجيل الكشف بعد الاحتساب.');
  return { allowed: problems.length === 0, problems, reviewCount };
}
