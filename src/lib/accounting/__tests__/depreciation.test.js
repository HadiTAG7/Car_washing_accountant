import { describe, it, expect } from 'vitest';
import {
  addMonths, monthsBetween, periodEndDate, validateAsset, depreciableBase,
  depreciationSchedule, accumulatedThrough, netBookValue, depreciationForPeriod,
  buildDepreciationEntry, buildDisposalEntry, registerSummary,
  unpostedDepreciationPeriods, hasChargedPeriods, firstDepreciationPeriod,
  lastDepreciationPeriod, missingChargedPeriods, reconcileDepreciation,
} from '../depreciation';
import { round2, validateEntry, isBalanced, totalsOf } from '../journal';
import { ACC } from '../chartOfAccounts';

const WASHER = {
  id: 'a1', name: 'ماكينة ضغط عالي', cost: 12000, salvageValue: 0,
  usefulLifeMonths: 60, inServiceDate: '2026-01-15',
};

describe('حساب الفترات', () => {
  it('يزيح الأشهر عبر حدّ السنة في الاتجاهين', () => {
    expect(addMonths('2026-01', 11)).toBe('2026-12');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-06', 0)).toBe('2026-06');
  });

  it('يعدّ الأشهر بين فترتين', () => {
    expect(monthsBetween('2026-01', '2026-12')).toBe(11);
    expect(monthsBetween('2026-12', '2026-01')).toBe(-11);
    expect(monthsBetween('2025-11', '2026-02')).toBe(3);
  });

  it('يعطي آخر يوم في الشهر — بما فيه فبراير الكبيسة', () => {
    expect(periodEndDate('2026-01')).toBe('2026-01-31');
    expect(periodEndDate('2026-02')).toBe('2026-02-28');
    expect(periodEndDate('2028-02')).toBe('2028-02-29');
    expect(periodEndDate('2026-04')).toBe('2026-04-30');
  });
});

describe('التحقق من الأصل', () => {
  it('الأصل السليم بلا ملاحظات', () => {
    expect(validateAsset(WASHER)).toEqual([]);
  });

  it('يرفض قيمة تخريدية تساوي التكلفة أو تتجاوزها', () => {
    expect(validateAsset({ ...WASHER, salvageValue: 12000 })[0]).toMatch(/تقل عن التكلفة/);
    expect(validateAsset({ ...WASHER, salvageValue: 15000 })[0]).toMatch(/تقل عن التكلفة/);
  });

  it('يرفض عمراً إنتاجياً صفراً أو كسرياً', () => {
    expect(validateAsset({ ...WASHER, usefulLifeMonths: 0 })[0]).toMatch(/شهراً واحداً/);
    expect(validateAsset({ ...WASHER, usefulLifeMonths: -12 })[0]).toMatch(/شهراً واحداً/);
  });

  it('يرفض استبعاداً قبل التشغيل', () => {
    expect(validateAsset({ ...WASHER, disposalDate: '2025-12-01' })[0]).toMatch(/قبل تاريخ التشغيل/);
  });

  it('يرفض تكلفة صفرية وتاريخاً غير صالح', () => {
    expect(validateAsset({ ...WASHER, cost: 0 })[0]).toMatch(/أكبر من صفر/);
    expect(validateAsset({ ...WASHER, inServiceDate: '2026-1-5' })[0]).toMatch(/غير صالح/);
  });
});

describe('جدول الإهلاك بالقسط الثابت', () => {
  it('يبدأ من شهر التشغيل وينتهي بعد العمر الإنتاجي', () => {
    const rows = depreciationSchedule(WASHER);
    expect(rows).toHaveLength(60);
    expect(firstDepreciationPeriod(WASHER)).toBe('2026-01');
    expect(rows[0].periodKey).toBe('2026-01');
    expect(rows[59].periodKey).toBe('2030-12');
    expect(lastDepreciationPeriod(WASHER)).toBe('2030-12');
  });

  it('القسط الشهري = (التكلفة − التخريدية) ÷ العمر', () => {
    expect(depreciableBase(WASHER)).toBe(12000);
    expect(depreciationSchedule(WASHER)[0].amount).toBe(200);
  });

  it('يخصم القيمة التخريدية من الأساس ولا يهلكها', () => {
    const a = { ...WASHER, cost: 12000, salvageValue: 2000, usefulLifeMonths: 50 };
    const rows = depreciationSchedule(a);
    expect(depreciableBase(a)).toBe(10000);
    expect(rows[0].amount).toBe(200);
    expect(rows[rows.length - 1].netBookValue).toBe(2000);   // lands ON salvage
  });

  it('الشهر الأخير يستوعب فروق التقريب — الإجمالي يساوي الأساس بالضبط', () => {
    // 10000 / 3 = 3333.33 × 3 = 9999.99. The last month must absorb the halala.
    const rows = depreciationSchedule({ ...WASHER, cost: 10000, usefulLifeMonths: 3 });
    expect(rows.map((r) => r.amount)).toEqual([3333.33, 3333.33, 3333.34]);
    expect(round2(rows.reduce((s, r) => s + r.amount, 0))).toBe(10000);
  });

  it('لا ينزل الرصيد الدفتري تحت التخريدية في أي شهر', () => {
    const a = { ...WASHER, cost: 7777.77, salvageValue: 777.77, usefulLifeMonths: 7 };
    for (const r of depreciationSchedule(a)) {
      expect(r.netBookValue).toBeGreaterThanOrEqual(777.77 - 0.005);
    }
  });

  it('الرصيد الدفتري يصل إلى صفر تماماً بلا قيمة تخريدية', () => {
    const rows = depreciationSchedule({ ...WASHER, cost: 999.99, usefulLifeMonths: 7 });
    expect(rows[rows.length - 1].netBookValue).toBe(0);
  });

  it('عمر شهر واحد يُهلك الأصل دفعة واحدة', () => {
    const rows = depreciationSchedule({ ...WASHER, usefulLifeMonths: 1 });
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(12000);
  });

  it('أصل غير صالح يعطي جدولاً فارغاً بدل جدول مضلّل', () => {
    expect(depreciationSchedule({ ...WASHER, cost: 0 })).toEqual([]);
    expect(depreciationSchedule({ ...WASHER, inServiceDate: '' })).toEqual([]);
  });

  it('الاستبعاد يوقف الجدول عند الشهر السابق للاستبعاد', () => {
    const rows = depreciationSchedule({ ...WASHER, disposalDate: '2026-04-10' });
    expect(rows.map((r) => r.periodKey)).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('الاستبعاد في شهر التشغيل نفسه لا يُنتج أي إهلاك', () => {
    expect(depreciationSchedule({ ...WASHER, disposalDate: '2026-01-30' })).toEqual([]);
  });
});

describe('المجمّع والقيمة الدفترية', () => {
  it('يتراكم شهراً بشهر', () => {
    expect(accumulatedThrough(WASHER, '2026-01')).toBe(200);
    expect(accumulatedThrough(WASHER, '2026-06')).toBe(1200);
    expect(accumulatedThrough(WASHER, '2030-12')).toBe(12000);
  });

  it('قبل التشغيل لا يوجد مجمّع', () => {
    expect(accumulatedThrough(WASHER, '2025-12')).toBe(0);
    expect(netBookValue(WASHER, '2025-12')).toBe(12000);
  });

  it('بعد نهاية العمر يتوقف عند الأساس ولا يتجاوزه', () => {
    expect(accumulatedThrough(WASHER, '2035-01')).toBe(12000);
    expect(netBookValue(WASHER, '2035-01')).toBe(0);
  });
});

describe('إهلاك الشهر عبر السجل', () => {
  const REGISTER = [
    WASHER,
    { id: 'a2', name: 'مكنسة صناعية', cost: 3600, usefulLifeMonths: 36, inServiceDate: '2026-03-01' },
    { id: 'a3', name: 'أثاث مكتبي', cost: 6000, usefulLifeMonths: 60, inServiceDate: '2027-01-01' },
  ];

  it('يجمع الأصول العاملة في الشهر فقط', () => {
    const jan = depreciationForPeriod(REGISTER, '2026-01');
    expect(jan.rows.map((r) => r.assetId)).toEqual(['a1']);
    expect(jan.total).toBe(200);

    const mar = depreciationForPeriod(REGISTER, '2026-03');
    expect(mar.rows.map((r) => r.assetId)).toEqual(['a1', 'a2']);
    expect(mar.total).toBe(300);
  });

  it('يتجاهل أصلاً لم يبدأ تشغيله بعد', () => {
    expect(depreciationForPeriod(REGISTER, '2026-06').rows.map((r) => r.assetId))
      .not.toContain('a3');
  });

  it('يتجاهل أصلاً معطَّلاً', () => {
    const off = [{ ...WASHER, active: false }];
    expect(depreciationForPeriod(off, '2026-01').rows).toEqual([]);
  });

  it('شهر بلا استحقاق يعطي إجمالي صفر', () => {
    expect(depreciationForPeriod(REGISTER, '2025-06')).toMatchObject({ total: 0, rows: [] });
  });
});

describe('قيد الإهلاك', () => {
  const REGISTER = [
    WASHER,
    { id: 'a2', name: 'مكنسة صناعية', cost: 3600, usefulLifeMonths: 36, inServiceDate: '2026-03-01' },
  ];

  it('متوازن ومؤرَّخ في آخر يوم من الشهر', () => {
    const built = buildDepreciationEntry('2026-03', REGISTER);
    expect(built.entry.entryDate).toBe('2026-03-31');
    expect(built.entry.periodKey).toBe('2026-03');
    expect(isBalanced(built.lines)).toBe(true);
    expect(validateEntry(built.entry, built.lines)).toEqual([]);
  });

  it('مدين مصروف الإهلاك ودائن مجمع الإهلاك — سطر لكل أصل', () => {
    const built = buildDepreciationEntry('2026-03', REGISTER);
    const debits = built.lines.filter((l) => l.debit > 0);
    const credits = built.lines.filter((l) => l.credit > 0);
    expect(debits).toHaveLength(2);
    expect(credits).toHaveLength(2);
    expect(debits.every((l) => l.accountId === ACC.DEPRECIATION)).toBe(true);
    expect(credits.every((l) => l.accountId === ACC.ACCUM_DEPRECIATION)).toBe(true);
    expect(totalsOf(built.lines).debit).toBe(300);
  });

  it('يحمل مفتاح الفترة كمصدر — وهو ما يمنع تكرار الشهر', () => {
    const built = buildDepreciationEntry('2026-03', REGISTER);
    expect(built.entry.sourceType).toBe('depreciation');
    expect(built.entry.sourceId).toBe('2026-03');
  });

  it('شهر بلا استحقاق لا يُنتج قيداً فارغاً', () => {
    expect(buildDepreciationEntry('2025-01', REGISTER)).toBeNull();
  });

  it('لا يحمل القيد أي سطر بصفر', () => {
    const built = buildDepreciationEntry('2026-01', REGISTER);
    expect(built.lines.every((l) => l.debit > 0 || l.credit > 0)).toBe(true);
  });
});

describe('قيد الاستبعاد', () => {
  // 12 months charged by the end of 2026 → accumulated 2400, NBV 9600.
  it('البيع بأعلى من القيمة الدفترية يعطي ربحاً', () => {
    const built = buildDisposalEntry(WASHER, { disposalDate: '2027-01-10', proceeds: 11000 });
    expect(built.accumulated).toBe(2400);
    expect(built.bookValue).toBe(9600);
    expect(built.result).toBe(1400);
    expect(isBalanced(built.lines)).toBe(true);
    expect(built.lines.find((l) => l.accountId === ACC.ASSET_DISPOSAL_GAIN).credit).toBe(1400);
  });

  it('البيع بأقل من القيمة الدفترية يعطي خسارة', () => {
    const built = buildDisposalEntry(WASHER, { disposalDate: '2027-01-10', proceeds: 5000 });
    expect(built.result).toBe(-4600);
    expect(built.lines.find((l) => l.accountId === ACC.ASSET_DISPOSAL_LOSS).debit).toBe(4600);
    expect(isBalanced(built.lines)).toBe(true);
  });

  it('الإخراج بلا متحصلات خسارة بكامل القيمة الدفترية', () => {
    const built = buildDisposalEntry(WASHER, { disposalDate: '2027-01-10', proceeds: 0 });
    expect(built.result).toBe(-9600);
    expect(built.lines.some((l) => l.accountId === ACC.CASH)).toBe(false);
    expect(isBalanced(built.lines)).toBe(true);
  });

  it('يقفل الأصل بتكلفته ويقفل مجمّعه بالكامل', () => {
    const built = buildDisposalEntry(WASHER, { disposalDate: '2027-01-10', proceeds: 11000 });
    expect(built.lines.find((l) => l.accountId === ACC.FIXED_ASSETS).credit).toBe(12000);
    expect(built.lines.find((l) => l.accountId === ACC.ACCUM_DEPRECIATION).debit).toBe(2400);
  });

  it('أصل مهلك بالكامل يخرج بلا رصيد دفتري', () => {
    const built = buildDisposalEntry(WASHER, { disposalDate: '2031-06-01', proceeds: 0 });
    expect(built.bookValue).toBe(0);
    expect(built.result).toBe(0);
    expect(isBalanced(built.lines)).toBe(true);
    expect(validateEntry(built.entry, built.lines)).toEqual([]);
  });

  it('البيع في شهر التشغيل: لا مجمّع، والخسارة بكامل التكلفة', () => {
    const built = buildDisposalEntry(WASHER, { disposalDate: '2026-01-20', proceeds: 0 });
    expect(built.accumulated).toBe(0);
    expect(built.result).toBe(-12000);
  });

  it('يرفض تاريخ استبعاد غير صالح', () => {
    expect(() => buildDisposalEntry(WASHER, { disposalDate: 'غداً' })).toThrow(/غير صالح/);
  });
});

describe('ملخص السجل', () => {
  const REGISTER = [
    WASHER,
    { id: 'a2', name: 'مكنسة', cost: 3600, usefulLifeMonths: 36, inServiceDate: '2026-03-01' },
    { id: 'a3', name: 'مباع', cost: 1000, usefulLifeMonths: 10, inServiceDate: '2026-01-01', disposalDate: '2026-05-01' },
  ];

  it('يجمع التكلفة والمجمّع والقيمة الدفترية', () => {
    const s = registerSummary(REGISTER, '2026-06');
    expect(s.count).toBe(2);        // the disposed one is out
    expect(s.disposed).toBe(1);
    expect(s.cost).toBe(15600);
    expect(s.accumulated).toBe(1600);   // 1200 + 400
    expect(s.netBookValue).toBe(14000);
  });

  it('التكلفة = المجمّع + القيمة الدفترية دائماً', () => {
    for (const p of ['2026-01', '2026-06', '2027-12', '2031-01']) {
      const s = registerSummary(REGISTER, p);
      expect(round2(s.accumulated + s.netBookValue)).toBe(s.cost);
    }
  });
});

describe('الأشهر غير المُرحّلة', () => {
  const REGISTER = [{ ...WASHER, usefulLifeMonths: 4 }];

  it('يسرد كل شهر مستحق لم يُرحَّل بعد', () => {
    expect(unpostedDepreciationPeriods(REGISTER, { postedPeriods: new Set() }))
      .toEqual(['2026-01', '2026-02', '2026-03', '2026-04']);
  });

  it('يتخطّى ما رُحّل', () => {
    expect(unpostedDepreciationPeriods(REGISTER, {
      postedPeriods: new Set(['2026-01', '2026-03']),
    })).toEqual(['2026-02', '2026-04']);
  });

  it('يحترم سقف «حتى شهر»', () => {
    expect(unpostedDepreciationPeriods(REGISTER, { postedPeriods: new Set(), through: '2026-02' }))
      .toEqual(['2026-01', '2026-02']);
  });

  it('سجل فارغ لا يقترح أي شهر', () => {
    expect(unpostedDepreciationPeriods([], { postedPeriods: new Set() })).toEqual([]);
  });
});

describe('الأشهر الناقصة قبل الاستبعاد', () => {
  it('يسرد كل شهر مستحق لم يُرحّل حتى الشهر السابق للاستبعاد', () => {
    expect(missingChargedPeriods(WASHER, new Set(), { through: '2026-03' }))
      .toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('ولا شيء إذا كانت الدفاتر محدّثة', () => {
    const posted = new Set(['2026-01', '2026-02', '2026-03']);
    expect(missingChargedPeriods(WASHER, posted, { through: '2026-03' })).toEqual([]);
  });

  it('يتجاهل الأشهر بعد سقف التاريخ', () => {
    expect(missingChargedPeriods(WASHER, new Set(['2026-01']), { through: '2026-02' }))
      .toEqual(['2026-02']);
  });
});

describe('مطابقة المُرحَّل بالسجل', () => {
  const entry = (id, periodKey) => ({
    id, sourceType: 'depreciation', sourceId: periodKey, status: 'posted',
  });

  it('لا فرق عندما يطابق المُرحَّل السجل', () => {
    const lines = [{ entryId: 'e1', accountId: '5400', debit: 200, credit: 0 }];
    expect(reconcileDepreciation([WASHER], [entry('e1', '2026-01')], lines)).toEqual([]);
  });

  it('يرصد أصلاً أُضيف بأثر رجعي إلى شهر مُرحَّل', () => {
    const register = [
      WASHER,
      { id: 'a2', name: 'مكنسة', cost: 3600, usefulLifeMonths: 36, inServiceDate: '2026-01-05' },
    ];
    const lines = [{ entryId: 'e1', accountId: '5400', debit: 200, credit: 0 }];
    expect(reconcileDepreciation(register, [entry('e1', '2026-01')], lines))
      .toEqual([{ periodKey: '2026-01', expected: 300, posted: 200, difference: 100 }]);
  });

  it('يتجاهل القيود المعكوسة وغير الإهلاكية', () => {
    const entries = [
      { id: 'e1', sourceType: 'depreciation', sourceId: '2026-01', status: 'reversed' },
      { id: 'e2', sourceType: 'wash', sourceId: 'w1', status: 'posted' },
    ];
    const lines = [{ entryId: 'e1', accountId: '5400', debit: 999, credit: 0 }];
    expect(reconcileDepreciation([WASHER], entries, lines)).toEqual([]);
  });
});

describe('حماية الجدول بعد الترحيل', () => {
  it('أصل رُحّل أحد أشهره لا يُعاد تسعيره', () => {
    expect(hasChargedPeriods(WASHER, new Set(['2026-03']))).toBe(true);
  });

  it('وأصل لم يُرحّل له شيء يبقى قابلاً للتعديل', () => {
    // The month was posted, but this asset only enters service later.
    const later = { ...WASHER, id: 'a9', inServiceDate: '2027-01-01' };
    expect(hasChargedPeriods(later, new Set(['2026-03']))).toBe(false);
    expect(hasChargedPeriods(WASHER, new Set())).toBe(false);
  });
});
