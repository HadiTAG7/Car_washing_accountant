/**
 * تسعير سويتر — قاعدة اليوم لا قاعدة اليوم الحالي، و«لا أعرف» جوابٌ مشروع
 * ═══════════════════════════════════════════════════════════════════════════
 * الادعاء الحامل: **تعديل سعرٍ اليوم لا يحرّك ريالاً في شهرٍ مضى.** والادعاء
 * الثاني الذي يحميه: تاريخٌ لا قاعدة له **يمتنع** عن الجواب بدل أن يستعمل
 * أقرب سعر — لأن الاختراع هنا لا يُكتشف إلا بعد أشهر في رقمٍ لا أحد يعرف
 * مصدره، وهو بالضبط ما بُني `taxPolicyAt` ليمنعه.
 *
 * Run: npm run test:functions
 */
import { describe, it, expect } from 'vitest';
import {
  derivePrice, resolveServicePrice, sumSnapshots, priceRowProblems, SWEATER_PRICE_SEED,
} from '../src/sweater/pricing.js';
import { resolveDatedRow, activeRowsOn, datedRowProblems } from '../src/sweater/datedConfig.js';

const ROWS = [
  { id: 'p1', serviceType: 'wash', effectiveFrom: '2026-01-01', priceMode: 'exclusive',
    netRate: 20, vatRate: 0.15, grossRate: 23, status: 'active', createdAt: '2026-01-01' },
  { id: 'p2', serviceType: 'wash', effectiveFrom: '2026-06-01', priceMode: 'exclusive',
    netRate: 25, vatRate: 0.15, grossRate: 28.75, status: 'active', createdAt: '2026-05-20' },
  { id: 'p3', serviceType: 'polish', effectiveFrom: '2026-01-01', priceMode: 'inclusive',
    grossRate: 220, vatRate: 0.15, netRate: 191.3, status: 'active', createdAt: '2026-01-01' },
  { id: 'p4', serviceType: 'wash', effectiveFrom: '2026-09-01', priceMode: 'exclusive',
    netRate: 99, vatRate: 0.15, grossRate: 113.85, status: 'draft', createdAt: '2026-08-01' },
];

describe('derivePrice', () => {
  it('يشتقّ الإجمالي من الصافي', () => {
    expect(derivePrice({ netRate: 20, vatRate: 0.15, priceMode: 'exclusive' }))
      .toMatchObject({ net: 20, vat: 3, gross: 23 });
  });

  it('ويشتقّ الصافي من الإجمالي — والمجموع يعود بالضبط', () => {
    const d = derivePrice({ grossRate: 220, vatRate: 0.15, priceMode: 'inclusive' });
    expect(d).toMatchObject({ net: 191.3, vat: 28.7, gross: 220 });
    expect(d.net + d.vat).toBe(220);
  });

  it('ونسبة صفر تعطي ضريبة صفراً لا كسراً', () => {
    expect(derivePrice({ netRate: 50, vatRate: 0, priceMode: 'exclusive' }))
      .toMatchObject({ net: 50, vat: 0, gross: 50 });
  });
});

describe('resolveServicePrice — القاعدة السارية يوم الخدمة', () => {
  it('خدمةٌ في مايو تأخذ سعر يناير، لا سعر يونيو', () => {
    // الادعاء الحامل: رفع السعر في يونيو لا يعيد تسعير مايو.
    const hit = resolveServicePrice(ROWS, 'wash', '2026-05-20');
    expect(hit.known).toBe(true);
    expect(hit.snapshot).toMatchObject({ netRate: 20, grossRate: 23, effectiveFrom: '2026-01-01' });
  });

  it('وخدمةٌ في يونيو تأخذ الجديد', () => {
    expect(resolveServicePrice(ROWS, 'wash', '2026-06-15').snapshot)
      .toMatchObject({ netRate: 25, effectiveFrom: '2026-06-01' });
  });

  it('وتاريخٌ قبل أول قاعدة يمتنع ويسمّي الأساس — لا يستعمل أقرب سعر', () => {
    const hit = resolveServicePrice(ROWS, 'wash', '2025-12-31');
    expect(hit.known).toBe(false);
    expect(hit.reason).toBe('before-baseline');
    expect(hit.baselineFrom).toBe('2026-01-01');
  });

  it('وخدمةٌ لا جدول لها تمتنع — لا سعر افتراضي', () => {
    expect(resolveServicePrice(ROWS, 'ceramic_coating', '2026-05-20'))
      .toMatchObject({ known: false, reason: 'no-rows' });
  });

  it('وصفٌّ مسودة لا يسري ولو حلّ تاريخه', () => {
    // p4 يبدأ ١ سبتمبر لكنه draft — فسبتمبر يبقى على سعر يونيو.
    expect(resolveServicePrice(ROWS, 'wash', '2026-09-15').snapshot)
      .toMatchObject({ netRate: 25, effectiveFrom: '2026-06-01' });
  });

  it('وتاريخٌ فاسد يمتنع ولا ينهار', () => {
    expect(resolveServicePrice(ROWS, 'wash', 'غداً').known).toBe(false);
    expect(resolveServicePrice(ROWS, 'wash', null).reason).toBe('bad-date');
  });

  it('واللقطة تحمل مصدرها وتاريخها — الرقم يشرح نفسه بعد سنة', () => {
    const s = resolveServicePrice(ROWS, 'polish', '2026-03-01').snapshot;
    expect(s).toMatchObject({
      serviceType: 'polish', priceListId: 'p3', source: 'sweater_price_list',
      capturedFor: '2026-03-01', priceMode: 'inclusive', vatRate: 0.15,
    });
  });

  it('وسريانٌ منتهٍ بلا خلف يمتنع بدل أن يمتدّ', () => {
    const rows = [{ id: 'x', serviceType: 'promo', effectiveFrom: '2026-01-01',
      effectiveTo: '2026-03-31', netRate: 10, vatRate: 0.15, status: 'active' }];
    expect(resolveServicePrice(rows, 'promo', '2026-02-01').known).toBe(true);
    expect(resolveServicePrice(rows, 'promo', '2026-04-01'))
      .toMatchObject({ known: false, reason: 'expired', expiredOn: '2026-03-31' });
  });
});

describe('priceRowProblems', () => {
  it('صفوف الزرع الابتدائية صالحة — والتلميع يتفق مع ٢٢٠ شاملاً', () => {
    for (const row of SWEATER_PRICE_SEED) {
      expect(priceRowProblems({ ...row, effectiveFrom: '2026-01-01' })).toEqual([]);
    }
  });

  it('وثلاثيةٌ متناقضة تُرفض بالرقم المتوقع — ١٩١ مع ٢٢٠ عند ١٥٪ لا تتفق', () => {
    // هذا نصّ الدليل حرفياً، وهو ما دفعنا لزرع التلميع شاملاً بـ٢٢٠.
    const problems = priceRowProblems({
      serviceType: 'polish', effectiveFrom: '2026-01-01', priceMode: 'exclusive',
      netRate: 191, vatRate: 0.15, grossRate: 220,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('219.65');
  });

  it('ونسبة ضريبة كنسبة مئوية (١٥ بدل ٠٫١٥) تُرفض', () => {
    const problems = priceRowProblems({
      serviceType: 'wash', effectiveFrom: '2026-01-01', netRate: 20, vatRate: 15,
    });
    expect(problems.some((p) => p.includes('كسراً'))).toBe(true);
  });

  it('وسعرٌ صفر أو سالب يُرفض', () => {
    expect(priceRowProblems({ serviceType: 'w', effectiveFrom: '2026-01-01', netRate: 0, vatRate: 0.15 }))
      .not.toEqual([]);
  });
});

describe('sumSnapshots', () => {
  it('يجمع اللقطات كما ثُبِّتت — لا إعادة حساب تراكم كسورها', () => {
    const snaps = Array.from({ length: 3 }, () =>
      resolveServicePrice(ROWS, 'polish', '2026-03-01').snapshot);
    expect(sumSnapshots(snaps)).toEqual({ net: 573.9, vat: 86.1, gross: 660, count: 3 });
  });

  it('وقائمةٌ فارغة تعطي أصفاراً لا NaN', () => {
    expect(sumSnapshots()).toEqual({ net: 0, vat: 0, gross: 0, count: 0 });
  });
});

describe('datedConfig — المشترك بين الأسعار والحالات وأنواع الخصومات', () => {
  it('صفّان بنفس تاريخ السريان: الأحدث كتابةً يفوز — تصحيحٌ لا منافس', () => {
    const rows = [
      { key: 'k', effectiveFrom: '2026-01-01', v: 'قديم', createdAt: '2026-01-01', status: 'active' },
      { key: 'k', effectiveFrom: '2026-01-01', v: 'مصحّح', createdAt: '2026-01-05', status: 'active' },
    ];
    expect(resolveDatedRow(rows, 'k', '2026-02-01').row.v).toBe('مصحّح');
  });

  it('و`activeRowsOn` تعطي السارية لكل مفتاح في يومٍ ما', () => {
    const active = activeRowsOn(ROWS, '2026-05-20', { keyField: 'serviceType' });
    expect(active.map((r) => r.id).sort()).toEqual(['p1', 'p3']);
  });

  it('و`datedRowProblems` يرفض نهايةً قبل بداية', () => {
    expect(datedRowProblems({ key: 'k', effectiveFrom: '2026-05-01', effectiveTo: '2026-04-01' })
      .some((p) => p.includes('قبل بدايته'))).toBe(true);
  });
});
