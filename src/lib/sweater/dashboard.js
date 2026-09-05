// ═══════════════════════════════════════════════════════════════════════════
// مؤشرات سويتر — كل رقمٍ يحمل ما بُني منه
// ═══════════════════════════════════════════════════════════════════════════
// المواصفة صريحة: «اعرض تفاصيل كل رقم، ولا تجعل البطاقات أرقامًا لا يمكن
// تتبع مصدرها». فكل مؤشرٍ هنا يرجع `{ value, basis }` — و`basis` هي
// الحجوزات التي كوّنته، لا وصفٌ لها. فالنقر على البطاقة يعرض الصفوف نفسها.
// ═══════════════════════════════════════════════════════════════════════════

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

/** ترشيحٌ مشترك: الفترة والسائق والمنطقة ونوع الخدمة. */
export function filterBookings(bookings, { driver = null, region = null, serviceType = null } = {}) {
  return (bookings || []).filter((b) => {
    const r = b.record ?? b;
    if (driver && r.driverName !== driver) return false;
    if (region && r.region !== region) return false;
    if (serviceType && r.serviceType !== serviceType) return false;
    return true;
  });
}

/**
 * المؤشرات التشغيلية.
 *
 * `onTimeRate` تُحسب من الحجوزات التي **لها وقتٌ مسجَّل** وحدها — لا من
 * الكل. حجزٌ بلا توقيت لا يعني «في الوقت»، وحسابه كذلك يرفع النسبة كذباً.
 * والمقام يُعرض دائماً معها لهذا السبب.
 */
export function operationalKpis(bookings, { adjustments = [], graceMinutes = 10 } = {}) {
  const rows = (bookings || []).map((b) => b.record ?? b);
  const total = rows.length;

  const completed = rows.filter((r) => r.normalizedStatus === 'payment_collection');
  const cancelled = rows.filter((r) => r.normalizedStatus === 'admin_cancelled');
  const unknown = rows.filter((r) => r.normalizedStatus === 'unknown');

  const rated = rows.filter((r) => num(r.rating) !== null);
  const ratingSum = rated.reduce((s, r) => s + num(r.rating), 0);
  const fiveStar = rated.filter((r) => num(r.rating) >= 5);
  const lowRated = rated.filter((r) => num(r.rating) < 4);

  // الالتزام بالوقت: من له وقت وصولٍ وبدء معاً.
  const timed = rows.filter((r) => r.arrivedAt && r.startedAt);
  const late = timed.filter((r) => {
    const gap = (Date.parse(r.startedAt) - Date.parse(r.arrivedAt)) / 60000;
    return Number.isFinite(gap) && gap > graceMinutes;
  });

  const byType = (kind) => (adjustments || []).filter((a) => a.kind === kind);
  const withDeduction = new Set(byType('deduction').map((a) => a.sspBookingId).filter(Boolean));
  const violations = (adjustments || []).filter((a) =>
    ['operational_or_traffic_violation', 'proven_damage'].includes(a.typeKey));
  const complaints = (adjustments || []).filter((a) =>
    ['proven_complaint_no_compensation', 'customer_compensation'].includes(a.typeKey));

  const sum = (list) => Math.round(list.reduce((s, a) => s + (Number(a.amount) || 0), 0) * 100) / 100;
  const approved = (list) => list.filter((a) => a.approvalStatus === 'approved');

  return {
    totalBookings: { value: total, basis: rows },
    completed: { value: completed.length, basis: completed },
    cancelled: { value: cancelled.length, basis: cancelled },
    unknownStatus: { value: unknown.length, basis: unknown },
    cancellationRate: { value: pct(cancelled.length, total), basis: cancelled, denominator: total },

    averageRating: {
      value: rated.length ? Math.round((ratingSum / rated.length) * 100) / 100 : null,
      basis: rated, denominator: rated.length,
    },
    fiveStarCount: { value: fiveStar.length, basis: fiveStar },
    lowRatedCount: { value: lowRated.length, basis: lowRated },

    // المقام مذكور: نسبةٌ من ٣ حجوزات موقّتة ليست نسبةَ الشهر.
    onTimeRate: {
      value: pct(timed.length - late.length, timed.length),
      basis: timed.filter((r) => !late.includes(r)),
      denominator: timed.length,
      note: timed.length < total
        ? `محسوبة على ${timed.length} حجزاً لها توقيت من ${total} — الباقي بلا وقت مسجَّل.`
        : null,
    },
    lateCount: { value: late.length, basis: late },

    withoutDeductions: {
      value: rows.filter((r) => !withDeduction.has(r.sspBookingId)).length,
      basis: rows.filter((r) => !withDeduction.has(r.sspBookingId)),
    },
    violations: { value: violations.length, basis: violations, amount: sum(approved(violations)) },
    complaints: { value: complaints.length, basis: complaints, amount: sum(approved(complaints)) },

    deductionsTotal: { value: sum(approved(byType('deduction'))), basis: approved(byType('deduction')) },
    incentivesTotal: { value: sum(approved(byType('incentive'))), basis: approved(byType('incentive')) },
    compensationsTotal: { value: sum(approved(byType('compensation'))), basis: approved(byType('compensation')) },
    pendingAdjustments: {
      value: (adjustments || []).filter((a) => a.approvalStatus !== 'approved').length,
      basis: (adjustments || []).filter((a) => a.approvalStatus !== 'approved'),
    },
  };
}

/** صفوف المطابقة الأربعة: المتوقع مقابل الكشف والفاتورة والتحصيل. */
export function reconciliationRows(settlement) {
  const presentNumber = (value) => value != null && String(value).trim() !== '' && Number.isFinite(Number(value));
  const f = settlement?.figures ?? {};
  const hasExpected = presentNumber(f.netDue);
  const expected = hasExpected ? Number(f.netDue) : null;
  const stated = Number(settlement?.statement?.statedNetDue);
  const invoiced = Number(settlement?.invoiceGross);
  const collected = Number(settlement?.collectedTotal) || 0;

  const row = (label, value, hasValue) => ({
    label,
    value: hasValue ? Math.round(value * 100) / 100 : null,
    difference: hasValue && hasExpected ? Math.round((value - expected) * 100) / 100 : null,
    matches: hasValue && hasExpected ? Math.abs(value - expected) < 0.01 : null,
  });

  return [
    { label: 'صافي المستحق المتوقع', value: hasExpected ? Math.round(expected * 100) / 100 : null, difference: null, matches: null, expected: true },
    row('كشف سويتر', stated, presentNumber(settlement?.statement?.statedNetDue)),
    row('الفاتورة الصادرة', invoiced, presentNumber(settlement?.invoiceGross)),
    row('المُحصَّل', collected, presentNumber(settlement?.collectedTotal) && (collected > 0 || settlement?.status === 'collected')),
  ];
}

/** قوائم التصفية المتاحة — تُشتقّ من البيانات لا تُكتب يدوياً. */
export function filterOptions(bookings) {
  const rows = (bookings || []).map((b) => b.record ?? b);
  const uniq = (key) => [...new Set(rows.map((r) => r[key]).filter(Boolean))].sort();
  return { drivers: uniq('driverName'), regions: uniq('region'), serviceTypes: uniq('serviceType') };
}
