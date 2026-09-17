/**
 * مؤشرات الشريك — الاسترداد، والتغيّر الشهري، ومنذ بداية السنة، وحال الفترة
 * ═══════════════════════════════════════════════════════════════════════════
 * Run: npm test
 */
import { describe, it, expect } from 'vitest';
import { roiSummary, momChange, ytdTotal, periodStatusOf, washShare } from '../partnerInsights.js';

const NETS = [
  { month: '2026-03', netProfit: 1000, hasActivity: true },
  { month: '2026-04', netProfit: 1500, hasActivity: true },
  { month: '2026-05', netProfit: 0, hasActivity: false },   // لم يُرحَّل — لا يدخل المتوسط
  { month: '2026-06', netProfit: 2000, hasActivity: true },
];

describe('استرداد رأس المال', () => {
  it('يجمع حصّته ويقسمها على ما دفعه، ويقدّر المتبقّي بمتوسط الأشهر التي فيها حركة', () => {
    const r = roiSummary({ nets: NETS, paid: 20000 });
    expect(r.cumulativeProfit).toBe(4500);
    expect(r.recoveredPercent).toBe(22.5);
    expect(r.remaining).toBe(15500);
    expect(r.recovered).toBe(false);
    // المتوسط على ٣ أشهر فيها حركة: (1000+1500+2000)/3 = 1500 → 15500/1500 = 10.33 → 11
    expect(r.avgRecent).toBe(1500);
    expect(r.monthsAveraged).toBe(3);
    expect(r.monthsToRecover).toBe(11);
    expect(r.firstMonth).toBe('2026-03');
    expect(r.lastMonth).toBe('2026-06');
  });

  it('استُردّ: نسبةٌ فوق ١٠٠ ولا تقدير', () => {
    const r = roiSummary({ nets: [{ month: '2026-01', netProfit: 25000 }], paid: 20000 });
    expect(r.recovered).toBe(true);
    expect(r.recoveredPercent).toBe(125);
    expect(r.remaining).toBe(0);
    expect(r.monthsToRecover).toBeNull();
  });

  it('متوسطٌ سالب أو صفر: لا تقدير — «غير محدد» أصدق من رقمٍ لا نهائي', () => {
    expect(roiSummary({ nets: [{ month: '2026-01', netProfit: -500 }], paid: 1000 }).monthsToRecover).toBeNull();
    expect(roiSummary({ nets: [], paid: 1000 }).monthsToRecover).toBeNull();
  });

  it('بلا دفعات: نسبةٌ صفر ولا استرداد', () => {
    const r = roiSummary({ nets: NETS, paid: 0 });
    expect(r.recoveredPercent).toBe(0);
    expect(r.recovered).toBe(false);
    expect(r.monthsToRecover).toBeNull();
  });

  it('الترتيب لا يهمّ، والأشهر المشوّهة تُستبعد', () => {
    const r = roiSummary({ nets: [NETS[3], { month: 'x' }, NETS[0]], paid: 100 });
    expect(r.cumulativeProfit).toBe(3000);
    expect(r.monthsCounted).toBe(2);
    expect(r.firstMonth).toBe('2026-03');
  });

  it('النافذة تحترم `window`', () => {
    const r = roiSummary({ nets: NETS, paid: 20000, window: 1 });
    expect(r.avgRecent).toBe(2000);
    expect(r.monthsAveraged).toBe(1);
  });
});

describe('التغيّر عن الشهر السابق', () => {
  it('صعودٌ بنسبة من السابق', () => {
    expect(momChange(1200, 1000)).toEqual({ delta: 200, percent: 20, direction: 'up' });
  });
  it('هبوطٌ، والنسبة على القيمة المطلقة للسابق — خسارةٌ صغرت تحسّنٌ', () => {
    expect(momChange(-500, -1000)).toEqual({ delta: 500, percent: 50, direction: 'up' });
    expect(momChange(800, 1000)).toEqual({ delta: -200, percent: -20, direction: 'down' });
  });
  it('سابقٌ صفر: فرقٌ بلا نسبة؛ ولا سابق: لا شيء', () => {
    expect(momChange(300, 0)).toEqual({ delta: 300, percent: null, direction: 'up' });
    expect(momChange(300, null)).toEqual({ delta: null, percent: null, direction: 'flat' });
  });
});

describe('منذ بداية السنة وحال الفترة', () => {
  it('يجمع أشهر السنة وحدها', () => {
    expect(ytdTotal([...NETS, { month: '2025-12', netProfit: 9999 }], '2026')).toBe(4500);
    expect(ytdTotal(NETS, '2025')).toBe(0);
  });
  it('حال الفترة من مستندها — بأي معرّف', () => {
    const periods = [{ id: '2026-05', status: 'closed' }, { periodKey: '2026-06', status: 'open' }];
    expect(periodStatusOf(periods, '2026-05')).toBe('closed');
    expect(periodStatusOf(periods, '2026-06')).toBe('open');
    expect(periodStatusOf(periods, '2026-07')).toBeNull();
  });
  it('حصّة الغسلات بمنزلةٍ عشرية', () => {
    expect(washShare(100, 0.1)).toBe(10);
    expect(washShare(25, 0.1)).toBe(2.5);
    expect(washShare(100, 0)).toBe(0);
  });
});
