/**
 * مؤشرات سويتر — المقام يُذكر، والرقم يحمل ما بُني منه
 * ═══════════════════════════════════════════════════════════════════════════
 * الادعاء الحامل: **نسبة الالتزام بالوقت تُحسب على الموقَّت وحده**. حجزٌ بلا
 * توقيت ليس «في الوقت»، وحسابه كذلك يرفع النسبة كذباً — ومديرٌ يرى ١٠٠٪ على
 * ثلاثة حجوزات من مئة يظن أن شهره ممتاز.
 *
 * Run: npm test
 */
import { describe, it, expect } from 'vitest';
import {
  operationalKpis, reconciliationRows, filterBookings, filterOptions,
} from '../../lib/sweater/dashboard';

const b = (over = {}) => ({
  record: {
    sspBookingId: 'B1', normalizedStatus: 'payment_collection',
    driverName: 'أحمد', region: 'الرياض', serviceType: 'wash', ...over,
  },
});

describe('operationalKpis', () => {
  const rows = [
    b({ sspBookingId: 'B1', rating: 5, arrivedAt: '2026-05-01T10:00:00Z', startedAt: '2026-05-01T10:05:00Z' }),
    b({ sspBookingId: 'B2', rating: 3, arrivedAt: '2026-05-01T11:00:00Z', startedAt: '2026-05-01T11:25:00Z' }),
    b({ sspBookingId: 'B3', normalizedStatus: 'admin_cancelled' }),
    b({ sspBookingId: 'B4', normalizedStatus: 'unknown' }),
    b({ sspBookingId: 'B5' }),                                     // بلا تقييم ولا توقيت
  ];
  const adjustments = [
    { kind: 'deduction', typeKey: 'lateness', amount: 25, sspBookingId: 'B2', approvalStatus: 'approved' },
    { kind: 'deduction', typeKey: 'proven_damage', amount: 300, sspBookingId: 'B1', approvalStatus: 'pending_review' },
    { kind: 'incentive', typeKey: 'completed_order_incentive', amount: 3, approvalStatus: 'approved' },
  ];
  const k = operationalKpis(rows, { adjustments });

  it('يعدّ الحجوزات وحالاتها', () => {
    expect(k.totalBookings.value).toBe(5);
    expect(k.completed.value).toBe(3);
    expect(k.cancelled.value).toBe(1);
    expect(k.unknownStatus.value).toBe(1);
    expect(k.cancellationRate.value).toBe(20);
  });

  it('ونسبة الالتزام على الموقَّت وحده — والمقام مذكور', () => {
    // الادعاء الحامل: اثنان فقط لهما توقيت، وأحدهما تأخّر ⇒ ٥٠٪ لا ٨٠٪.
    expect(k.onTimeRate.denominator).toBe(2);
    expect(k.onTimeRate.value).toBe(50);
    expect(k.onTimeRate.note).toContain('2');
    expect(k.lateCount.value).toBe(1);
  });

  it('والتقييم على المقيَّم وحده — لا يُحسب غير المقيَّم صفراً', () => {
    // لو حُسب B3/B4/B5 أصفاراً لصار المتوسط ١٫٦ بدل ٤.
    expect(k.averageRating.denominator).toBe(2);
    expect(k.averageRating.value).toBe(4);
    expect(k.fiveStarCount.value).toBe(1);
    expect(k.lowRatedCount.value).toBe(1);
  });

  it('والمعتمدة وحدها تدخل المبالغ — المعلّقة تُعدّ ولا تُجمع', () => {
    expect(k.deductionsTotal.value).toBe(25);        // ٣٠٠ معلّقة فلا تُحتسب
    expect(k.incentivesTotal.value).toBe(3);
    expect(k.pendingAdjustments.value).toBe(1);
  });

  it('وكل بطاقةٍ تحمل صفوفها — الرقم يُتتبَّع لا يُصدَّق', () => {
    expect(k.cancelled.basis.map((r) => r.sspBookingId)).toEqual(['B3']);
    expect(k.lateCount.basis.map((r) => r.sspBookingId)).toEqual(['B2']);
    expect(k.withoutDeductions.basis.map((r) => r.sspBookingId).sort())
      .toEqual(['B3', 'B4', 'B5']);
  });

  it('وقائمةٌ فارغة تعطي أصفاراً وnull لا NaN', () => {
    const e = operationalKpis([], {});
    expect(e.totalBookings.value).toBe(0);
    expect(e.averageRating.value).toBeNull();
    expect(e.onTimeRate.value).toBeNull();
    expect(e.cancellationRate.value).toBeNull();
  });
});

describe('reconciliationRows', () => {
  it('يقارن الثلاثة بالمتوقع ويسمّي الفرق', () => {
    const rows = reconciliationRows({
      figures: { netDue: 216 },
      statement: { statedNetDue: 204 },
      invoiceGross: 216,
      collectedTotal: 204,
    });
    expect(rows[0]).toMatchObject({ value: 216, matches: null });
    expect(rows[1]).toMatchObject({ value: 204, difference: -12, matches: false });
    expect(rows[2]).toMatchObject({ value: 216, matches: true });
    expect(rows[3]).toMatchObject({ value: 204, difference: -12 });
  });

  it('وما لم يصل بعد يبقى null لا صفراً — «لم يُستلم» ليست «صفر»', () => {
    const rows = reconciliationRows({ figures: { netDue: 100 } });
    expect(rows[1].value).toBeNull();
    expect(rows[2].value).toBeNull();
    expect(rows[1].difference).toBeNull();
  });
});

describe('الترشيح', () => {
  const rows = [
    b({ sspBookingId: 'B1', driverName: 'أحمد', region: 'الرياض' }),
    b({ sspBookingId: 'B2', driverName: 'سالم', region: 'جدة', serviceType: 'polish' }),
  ];

  it('يرشّح بالسائق والمنطقة والخدمة', () => {
    expect(filterBookings(rows, { driver: 'أحمد' })).toHaveLength(1);
    expect(filterBookings(rows, { region: 'جدة' })).toHaveLength(1);
    expect(filterBookings(rows, { serviceType: 'polish' })).toHaveLength(1);
    expect(filterBookings(rows, { driver: 'أحمد', region: 'جدة' })).toHaveLength(0);
    expect(filterBookings(rows, {})).toHaveLength(2);
  });

  it('وخيارات الترشيح تُشتقّ من البيانات لا تُكتب يدوياً', () => {
    expect(filterOptions(rows)).toEqual({
      drivers: ['أحمد', 'سالم'], regions: ['الرياض', 'جدة'], serviceTypes: ['polish', 'wash'],
    });
  });
});
