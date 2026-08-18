/**
 * إحصاءات السكن — الربط بالتطبيع، والقسمة التي ترفض الكذب
 * ═══════════════════════════════════════════════════════════════════════════
 * The load-bearing claims: a biker whose residence says «سكن النزهه» belongs
 * to «سكن النزهة» (ة/ه is the user's real data, not a nicety); a unit with
 * spend and no residents answers «التكلفة للساكن» with NULL — not Infinity,
 * not zero, both of which are numbers that lie; and unassigned money is
 * returned as an amount, never folded away.
 *
 * Run: npm test
 */
import { describe, it, expect } from 'vitest';
import {
  housingUnitDocId, residentsOf, unhousedBikers, perResident, buildHousingRows,
  rentByUnit, rentOnlyUnits,
} from '../housingStats';

const UNITS = ['سكن الشمال', 'سكن الغرب'];

const BIKERS = [
  { id: 'b1', name: 'أحمد', residence: 'سكن الشمال' },
  { id: 'b2', name: 'سالم', residence: 'سكن  الشمال ' },   // مسافة مكرّرة وذيل
  { id: 'b3', name: 'خالد', residence: 'سكن الغرب' },
  { id: 'b4', name: 'صالح', residence: 'حي النسيم' },      // نصٌّ لا يطابق سكناً
  { id: 'b5', name: 'ماجد', residence: '' },               // بلا سكن أصلاً
];

const ITEM = {
  id: 's1', itemName: 'تجهيز السكن', quantity: 50, plannedAmount: 15000,
  units: UNITS,
};

const ENTRIES = [
  { id: 'e1', startupCostId: 's1', description: 'مروحة', amount: 400, unit: 'سكن الشمال' },
  { id: 'e2', startupCostId: 's1', description: 'ثلاجه', amount: 600, unit: 'سكن الشمال' },
  { id: 'e3', startupCostId: 's1', description: 'سرير',  amount: 300, unit: 'سكن الغرب' },
  { id: 'e4', startupCostId: 's1', description: 'دهان',  amount: 200, unit: '' },
  // مصروف بندٍ آخر يحمل نفس اسم السكن — يجب ألّا يتسرّب.
  { id: 'x1', startupCostId: 's2', description: 'دباب', amount: 9999, unit: 'سكن الشمال' },
];

describe('housingUnitDocId', () => {
  it('حتميٌّ ومتطابق لإملاءي الاسم الواحد — ة/ه والمسافات لا تصنع وثيقتين', () => {
    expect(housingUnitDocId('سكن النزهة')).toBe(housingUnitDocId('سكن  النزهه '));
    expect(housingUnitDocId('سكن النزهة').length).toBeGreaterThan(0);
  });

  it('و«/» في الاسم لا يكسر معرّف Firestore', () => {
    expect(housingUnitDocId('سكن أ/ب')).not.toContain('/');
  });

  it('واسمٌ فارغ ⇐ معرّف فارغ، فلا وثيقة شبح', () => {
    expect(housingUnitDocId('')).toBe('');
    expect(housingUnitDocId('  ')).toBe('');
  });
});

describe('residentsOf', () => {
  it('يطابق رغم المسافات المكرّرة والذيول — سالم ساكنٌ في الشمال', () => {
    expect(residentsOf('سكن الشمال', BIKERS).map((b) => b.name)).toEqual(['أحمد', 'سالم']);
  });

  it('ويطابق رغم ة/ه — بيانات المستخدم الحقيقية', () => {
    const bikers = [{ id: 'b9', name: 'فهد', residence: 'سكن النزهه' }];
    expect(residentsOf('سكن النزهة', bikers)).toHaveLength(1);
  });

  it('وسكنٌ فارغ الاسم لا يبتلع من لا سكن لهم', () => {
    expect(residentsOf('', BIKERS)).toEqual([]);
  });
});

describe('unhousedBikers', () => {
  it('يلتقط الفارغ والمجهول معاً، ويحمل النص الخام ليُقرأ', () => {
    const rows = unhousedBikers(BIKERS, UNITS);
    expect(rows.map((r) => r.biker.name)).toEqual(['صالح', 'ماجد']);
    expect(rows[0].residenceText).toBe('حي النسيم');
    expect(rows[1].residenceText).toBe('');
  });
});

describe('perResident', () => {
  it('يقسم حين يوجد ساكنون', () => {
    expect(perResident(1000, 4)).toBe(250);
  });

  it('وصفر ساكن ⇐ null — لا Infinity يدّعي أن الحساب نجح ولا صفرٌ يدّعي المجانية', () => {
    expect(perResident(1000, 0)).toBeNull();
    expect(perResident(1000, null)).toBeNull();
  });
});

describe('buildHousingRows', () => {
  const META = [{ id: 'm1', name: 'سكن الشمال', capacity: 14, notes: 'عقد ٢٠٢٦' }];
  const rows = () => buildHousingRows({
    items: [ITEM, { id: 's2', itemName: 'الدباب', quantity: 1, plannedAmount: 9000, units: [] }],
    entries: ENTRIES, bikers: BIKERS, metaRows: META,
  });

  it('بندٌ بلا تقسيمات لا يظهر أصلاً — الدباب ليس سكناً', () => {
    expect(rows().map((r) => r.itemId)).toEqual(['s1']);
  });

  it('ومصاريف بندٍ آخر لا تتسرّب ولو تطابق اسم السكن', () => {
    const north = rows()[0].units.find((u) => u.name === 'سكن الشمال');
    // 400 + 600 فقط — الـ9999 لبند s2 مهما قال حقل unit فيه.
    expect(north.cost).toBe(1000);
    expect(north.entryCount).toBe(2);
  });

  it('والتقدير للساكن من خطة البند: 15,000 ÷ 50 = 300', () => {
    expect(rows()[0].benchmark).toBe(300);
  });

  it('والتكلفة للساكن والفارق عن التقدير يُحسبان من الساكنين المربوطين', () => {
    const north = rows()[0].units.find((u) => u.name === 'سكن الشمال');
    expect(north.residents.map((b) => b.name)).toEqual(['أحمد', 'سالم']);
    expect(north.perResident).toBe(500);              // 1000 ÷ 2
    expect(north.vsBenchmarkPct).toBeCloseTo(66.67, 1); // (500−300)/300
  });

  it('والميتا تصل سكنها بالمعرّف المطبَّع، ومن لا ميتا له سعتُه null لا 0', () => {
    const [row] = rows();
    const north = row.units.find((u) => u.name === 'سكن الشمال');
    const west  = row.units.find((u) => u.name === 'سكن الغرب');
    expect(north.capacity).toBe(14);
    expect(north.notes).toBe('عقد ٢٠٢٦');
    expect(west.capacity).toBeNull();
  });

  it('و«غير محدد» مبلغٌ صريح — المال لا يختبئ خلف تجميعة لم يدخلها', () => {
    const [row] = rows();
    expect(row.unassignedCost).toBe(200);
    expect(row.unassignedCount).toBe(1);
  });

  it('ومجموع السكنات + غير المحدد = مجموع مصاريف البند، دائماً', () => {
    const [row] = rows();
    const total = row.units.reduce((s, u) => s + u.cost, 0) + row.unassignedCost;
    expect(total).toBe(1500);
  });

  it('وسكنٌ بمصاريف وبلا ساكنين ⇐ perResident null والفارق null', () => {
    const alone = buildHousingRows({ items: [ITEM], entries: ENTRIES, bikers: [], metaRows: [] });
    const north = alone[0].units.find((u) => u.name === 'سكن الشمال');
    expect(north.perResident).toBeNull();
    expect(north.vsBenchmarkPct).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// الإيجار — يُقرأ من المصاريف السنوية، ولا يُجمع مع التجهيز
// ═══════════════════════════════════════════════════════════════════════════
// الإيجار مسجَّل في الدفاتر أصلاً؛ حقلٌ ثانٍ على بطاقة السكن كان سيعني رقمين
// لشيءٍ واحد ينجرفان. فالادعاءات الحاملة ثلاثة: أن الإيجار يُقرأ من حيث هو
// مقسوماً بالتطبيع نفسه؛ أن دفعةً بلا سكن **تُعَدّ ولا تُبتلع**؛ وأن الإيجار
// يبقى حقلاً مستقلاً لا يُضاف إلى `cost` أبداً — فالتجهيز رأسمالٌ صُرف مرةً
// والإيجار تكلفةٌ تتكرر كل سنة، ولهما مرجعان مختلفان.

const RENT_ITEMS = [
  { id: 'a1', expenseName: 'إيجار السكن', annualCost: 40000, units: UNITS },
  // بندٌ سنويٌّ بلا تقسيمات — لا يدخل الحساب إطلاقاً.
  { id: 'a2', expenseName: 'رخصة البلدية', annualCost: 1200, units: [] },
];

const RENT_ENTRIES = [
  { id: 'r1', annualExpenseId: 'a1', amount: 24000, unit: 'سكن الشمال' },
  { id: 'r2', annualExpenseId: 'a1', amount: 16000, unit: 'سكن  الغرب ' },  // إملاء آخر
  { id: 'r3', annualExpenseId: 'a1', amount: 3000,  unit: '' },             // بلا سكن
  { id: 'r4', annualExpenseId: 'a2', amount: 1200,  unit: '' },             // بندٌ بلا تقسيم
];

describe('rentByUnit', () => {
  it('يجمع الإيجار لكل سكن بالتطبيع، ويتجاهل بنداً بلا تقسيمات', () => {
    const idx = rentByUnit({ annualItems: RENT_ITEMS, annualEntries: RENT_ENTRIES });
    // المفتاح هو الاسم المطبَّع، لا النص كما ورد على الدفعة.
    expect([...idx.byUnit.keys()].sort()).toEqual(['سكن الغرب', 'سكن الشمال'].sort());
    const north = [...idx.byUnit.values()].find((u) => u.name === 'سكن الشمال');
    const west  = [...idx.byUnit.values()].find((u) => u.name === 'سكن الغرب');
    expect(north.total).toBe(24000);
    expect(west.total).toBe(16000);   // «سكن  الغرب » طابق «سكن الغرب»
    expect(west.entryCount).toBe(1);
    expect(north.itemNames).toEqual(['إيجار السكن']);
  });

  it('ودفعةٌ بلا سكن تُعَدّ صراحةً — مالٌ لا يختفي خلف تجميعٍ لم يسعه', () => {
    const idx = rentByUnit({ annualItems: RENT_ITEMS, annualEntries: RENT_ENTRIES });
    // ٣٠٠٠ من بند الإيجار وحده؛ الـ١٢٠٠ في بندٍ بلا تقسيمات فخارج الحساب كلياً.
    expect(idx.unassigned).toBe(3000);
    expect(idx.unassignedCount).toBe(1);
  });

  it('وبنودٌ عدّة على سكنٍ واحد تُجمع فيه — السكن مكانٌ لا ميزانية', () => {
    const idx = rentByUnit({
      annualItems: [...RENT_ITEMS, { id: 'a3', expenseName: 'كهرباء السكن', units: ['سكن الشمال'] }],
      annualEntries: [...RENT_ENTRIES, { id: 'r5', annualExpenseId: 'a3', amount: 5000, unit: 'سكن الشمال' }],
    });
    const north = [...idx.byUnit.values()].find((u) => u.name === 'سكن الشمال');
    expect(north.total).toBe(29000);
    expect(north.itemNames).toEqual(['إيجار السكن', 'كهرباء السكن']);
  });

  it('وبلا بنودٍ سنوية: خريطةٌ فارغة لا انهيار', () => {
    expect(rentByUnit().byUnit.size).toBe(0);
    expect(rentByUnit({}).unassigned).toBe(0);
  });
});

describe('buildHousingRows مع الإيجار', () => {
  const rentIndex = rentByUnit({ annualItems: RENT_ITEMS, annualEntries: RENT_ENTRIES });
  const rows = buildHousingRows({
    items: [ITEM], entries: ENTRIES, bikers: BIKERS, rentIndex,
  });
  const north = rows[0].units.find((u) => u.name === 'سكن الشمال');

  it('الإيجار يصل بطاقة السكن مقسوماً على ساكنيه', () => {
    expect(north.rent).toBe(24000);
    expect(north.residents).toHaveLength(2);
    expect(north.rentPerResident).toBe(12000);
  });

  it('ولا يُجمع مع التجهيز — الحقلان منفصلان لأن مرجعيهما مختلفان', () => {
    // الادعاء الحامل: `cost` هو التجهيز وحده. لو جُمعا لصار ٢٤٬١٠٠٠ ولانهارت
    // المقارنة بالتقدير ٣٠٠ التي بُني التاب كله عليها.
    expect(north.cost).toBe(1000);
    expect(north.perResident).toBe(500);
    expect(north.cost + north.rent).not.toBe(north.cost);
  });

  it('وسكنٌ بلا إيجار موسوم يقرأ صفراً لا undefined — والقسمة null', () => {
    const bare = buildHousingRows({ items: [ITEM], entries: ENTRIES, bikers: [] })[0]
      .units.find((u) => u.name === 'سكن الغرب');
    expect(bare.rent).toBe(0);
    expect(bare.rentPerResident).toBeNull();   // لا ساكن ⇒ لا قسمة
  });
});

describe('rentOnlyUnits', () => {
  it('يُسمّي سكناً عليه إيجار ولا بطاقة له — إيجارٌ لا يراه أحد أسوأ من إيجارٍ لم يُسجَّل', () => {
    const idx = rentByUnit({
      annualItems: [{ id: 'a1', expenseName: 'إيجار', units: ['سكن الشمال', 'سكن الشرق'] }],
      annualEntries: [
        { id: 'r1', annualExpenseId: 'a1', amount: 10000, unit: 'سكن الشمال' },
        { id: 'r2', annualExpenseId: 'a1', amount: 8000,  unit: 'سكن الشرق' },
      ],
    });
    const stray = rentOnlyUnits(idx, ['سكن الشمال', 'سكن الغرب']);
    expect(stray.map((u) => u.name)).toEqual(['سكن الشرق']);
    expect(stray[0].total).toBe(8000);
  });

  it('ويطابق بالتطبيع — «سكن الشمال» المغطّى لا يُبلَّغ عنه بإملاءٍ آخر', () => {
    const idx = rentByUnit({
      annualItems: [{ id: 'a1', expenseName: 'إيجار', units: ['سكن  الشمال '] }],
      annualEntries: [{ id: 'r1', annualExpenseId: 'a1', amount: 10000, unit: 'سكن  الشمال ' }],
    });
    expect(rentOnlyUnits(idx, ['سكن الشمال'])).toEqual([]);
  });

  it('وبلا فهرسٍ إطلاقاً: قائمةٌ فارغة', () => {
    expect(rentOnlyUnits(null, ['سكن الشمال'])).toEqual([]);
  });
});
