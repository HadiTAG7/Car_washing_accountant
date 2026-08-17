/**
 * إحصاءات البايكر — والاختبار الأهم فيها اختبار الانجراف
 * ═══════════════════════════════════════════════════════════════════════════
 * `washStatsFor` re-derives what `variableItemsForMonth` already computes for
 * the Variable Expenses page. Two implementations of «عمولة أحمد هذا الشهر»
 * WILL drift one day — a status string changes, a trim is forgotten — and the
 * day they drift, the biker profile and the P&L drill-down quote two
 * different figures for the same person, confidently, with nothing looking
 * wrong. So the first test here drives BOTH over the same rows and demands
 * the same answer, name by name.
 *
 * Run: npm test
 */
import { describe, it, expect } from 'vitest';
import {
  washStatsFor, pendingAdvancesFor, iqamaStatus, netSalary,
  unregisteredBikerNames, IQAMA_WARN_DAYS,
} from '../bikerStats';
import { variableItemsForMonth, DEFAULT_DYNAMIC_UNIT_COST } from '../variableExpenseTotals';

const MONTH = '2026-08';
const WASHES = [
  { bikerName: 'أحمد',   status: 'مكتملة',      washDate: '2026-08-02', quantity: 5 },
  { bikerName: ' أحمد ', status: 'مكتملة',      washDate: '2026-08-10', quantity: 3 }, // مسافات — نفس الشخص
  { bikerName: 'أحمد',   status: 'قيد التنفيذ', washDate: '2026-08-11', quantity: 9 }, // غير مكتملة
  { bikerName: 'أحمد',   status: 'مكتملة',      washDate: '2026-07-30', quantity: 7 }, // شهر آخر
  { bikerName: 'سالم',   status: 'مكتملة',      washDate: '2026-08-15', quantity: 2 },
  { bikerName: '',        status: 'مكتملة',      washDate: '2026-08-20', quantity: 4 }, // بلا اسم
];

describe('washStatsFor', () => {
  it('يعدّ المكتملة في الشهر فقط، ويطبّع الاسم كما تطبّعه صفحة المصاريف', () => {
    expect(washStatsFor('أحمد', WASHES, MONTH)).toEqual({
      washCount: 8,
      commission: 8 * DEFAULT_DYNAMIC_UNIT_COST,
    });
    expect(washStatsFor('سالم', WASHES, MONTH).commission).toBe(8);
    expect(washStatsFor('غائب', WASHES, MONTH)).toEqual({ washCount: 0, commission: 0 });
    expect(washStatsFor('', WASHES, MONTH)).toEqual({ washCount: 0, commission: 0 });
  });

  it('انجراف: يطابق variableItemsForMonth اسماً باسم', () => {
    const virtualRows = variableItemsForMonth({
      manualItems: [],
      categories: [{ id: 'biker-commissions', isDynamic: true }],
      selectedMonth: MONTH,
      washes: WASHES,
    }).filter((r) => r.isVirtual && r.bikerName !== 'بدون اسم بايكر');

    expect(virtualRows.length).toBeGreaterThan(0);
    for (const row of virtualRows) {
      const mine = washStatsFor(row.bikerName, WASHES, MONTH);
      expect(mine.washCount, `عدد غسلات ${row.bikerName}`).toBe(row.quantity);
      expect(mine.commission, `عمولة ${row.bikerName}`).toBe(row.totalVariableCost);
    }
  });
});

describe('pendingAdvancesFor', () => {
  const TEMPS = [
    { id: 't1', bikerId: 'b1', status: 'pending',   amount: 300 },
    { id: 't2', bikerId: 'b1', status: 'recovered', amount: 500 },
    { id: 't3', bikerId: 'b2', status: 'pending',   amount: 200 },
    { id: 't4', bikerId: null,  status: 'pending',   amount: 999 }, // عهدة عامة، ليست سلفة بايكر
  ];

  it('يجمع pending المربوطة بالمعرّف فقط', () => {
    const { advances, total } = pendingAdvancesFor('b1', TEMPS);
    expect(advances.map((a) => a.id)).toEqual(['t1']);
    expect(total).toBe(300);
  });

  it('وبلا معرّف لا شيء — العهد العامة ليست سلف أحد', () => {
    expect(pendingAdvancesFor(null, TEMPS)).toEqual({ advances: [], total: 0 });
    expect(pendingAdvancesFor(undefined, TEMPS)).toEqual({ advances: [], total: 0 });
  });
});

describe('iqamaStatus', () => {
  const TODAY = '2026-08-17';

  it('حدود الشهرين بالضبط: 59/60 قريبة، 61 سليمة', () => {
    // 60 يوماً من 2026-08-17 = 2026-10-16
    expect(iqamaStatus('2026-10-15', TODAY)).toBe('soon');   // 59
    expect(iqamaStatus('2026-10-16', TODAY)).toBe('soon');   // 60 — الحد داخل
    expect(iqamaStatus('2026-10-17', TODAY)).toBe('ok');     // 61
    expect(IQAMA_WARN_DAYS).toBe(60);
  });

  it('اليوم نفسه «قريبة» لا «منتهية»، والأمس منتهية', () => {
    expect(iqamaStatus(TODAY, TODAY)).toBe('soon');
    expect(iqamaStatus('2026-08-16', TODAY)).toBe('expired');
  });

  it('وبلا تاريخ صالح لا حكم', () => {
    expect(iqamaStatus('', TODAY)).toBeNull();
    expect(iqamaStatus(null, TODAY)).toBeNull();
    expect(iqamaStatus('ليس تاريخاً', TODAY)).toBeNull();
  });
});

describe('netSalary', () => {
  it('راتب − سلف = صافٍ، ويقبل صفوفاً أو أرقاماً', () => {
    expect(netSalary(2000, [{ amount: 300 }, { amount: 200 }]))
      .toEqual({ gross: 2000, deducted: 500, net: 1500, exceedsSalary: false });
    expect(netSalary(2000, [700]).net).toBe(1300);
    expect(netSalary(2000, []).net).toBe(2000);
  });

  it('الخصم الأكبر من الراتب يُسمّى ولا يُسكَت عنه', () => {
    const r = netSalary(500, [{ amount: 800 }]);
    expect(r.net).toBe(0);            // لا «راتب سالب»
    expect(r.exceedsSalary).toBe(true); // والواجهة تمنع الإرسال بها
  });

  it('راتب سالب أو فاسد يعامل صفراً', () => {
    expect(netSalary(-5, []).gross).toBe(0);
    expect(netSalary('abc', []).gross).toBe(0);
  });
});

describe('unregisteredBikerNames', () => {
  it('أسماء الغسلات غير المسجَّلة، مطبَّعةً وبلا تكرار', () => {
    const names = unregisteredBikerNames(
      [
        { bikerName: 'أحمد' }, { bikerName: ' أحمد ' },
        { bikerName: 'سالم' }, { bikerName: '' }, { bikerName: 'فهد' },
      ],
      [{ name: 'سالم' }],
    );
    expect(names).toEqual(['أحمد', 'فهد']);
  });

  it('سجل مكتمل ⇒ لا شيء يُستورد', () => {
    expect(unregisteredBikerNames(
      [{ bikerName: 'أحمد' }],
      [{ name: 'أحمد' }],
    )).toEqual([]);
  });
});
