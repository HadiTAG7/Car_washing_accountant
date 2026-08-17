/**
 * اقتراح السكن من الوصف — والتطبيع الذي بدونه لا يطابق شيء
 * ═══════════════════════════════════════════════════════════════════════════
 * The owner typed «سكن النزهه» on twenty-seven expenses and may well type
 * «سكن النزهة» in the unit list. Compared raw those are different strings and
 * the tool finds nothing at all — so the ة/ه case is not a nicety here, it is
 * the difference between a working feature and an empty screen.
 *
 * The other load-bearing rule: ambiguity yields NOTHING. A description naming
 * two units is a row the person must read, and a machine picking a winner
 * writes a wrong answer that nothing downstream can detect.
 *
 * Run: npm test
 */
import { describe, it, expect } from 'vitest';
import {
  suggestUnitFor, suggestUnitAssignments, unassignedCount,
  groupEntriesByUnit, UNASSIGNED,
} from '../unitSuggest';

const UNITS = ['سكن النزهة', 'سكن الشمال', 'سكن الروضة'];

describe('suggestUnitFor', () => {
  it('يطابق رغم اختلاف ة/ه — وهي الحالة الحقيقية في بيانات المستخدم', () => {
    expect(suggestUnitFor('تزويد سكن النزهه بمروحة اضافية — فاتورة رقم 25', UNITS))
      .toBe('سكن النزهة');
  });

  it('ويطابق بالجزء المميّز وحده، لأن الوصف يذكر المكان لا الاسم الكامل', () => {
    expect(suggestUnitFor('ثلاجة لسكن الروضه', UNITS)).toBe('سكن الروضة');
    expect(suggestUnitFor('صيانة تكييف النزهة', UNITS)).toBe('سكن النزهة');
  });

  it('ويتجاوز الحركات والتطويل والمسافات المكرّرة', () => {
    expect(suggestUnitFor('مروحة  لسِكن  النَزهــة', UNITS)).toBe('سكن النزهة');
  });

  it('ويعامل أ/إ/آ و ى/ي كحرفٍ واحد', () => {
    expect(suggestUnitFor('اثاث لسكن الأحمدي', ['سكن الاحمدى'])).toBe('سكن الاحمدى');
  });

  it('ووصفٌ يذكر سكنين ⇒ لا اقتراح، لا الأطول ولا الأول', () => {
    // The machine cannot know whether this is a purchase FOR the north or a
    // transfer FROM النزهة. So it says nothing and the person reads it.
    expect(suggestUnitFor('نقل اثاث من سكن النزهة الى سكن الشمال', UNITS)).toBeNull();
  });

  it('وكلمة «سكن» وحدها لا تنسب المصروف لأي سكن', () => {
    // Every unit contains it, so matching on it would file the whole ledger
    // under whichever unit happened to be first.
    expect(suggestUnitFor('مروحة عمود كهربائية 80 واط للسكن', UNITS)).toBeNull();
  });

  it('وبند اسمه «سكن» فقط لا يبتلع كل شيء', () => {
    expect(suggestUnitFor('مروحة للسكن', ['سكن'])).toBeNull();
  });

  it('ولا قائمة ولا وصف ⇒ لا اقتراح', () => {
    expect(suggestUnitFor('أي وصف', [])).toBeNull();
    expect(suggestUnitFor('', UNITS)).toBeNull();
    expect(suggestUnitFor(null, UNITS)).toBeNull();
  });

  it('والاسم المكرّر بإملاءين ليس غموضاً — هو مكانٌ واحد', () => {
    expect(suggestUnitFor('مروحة لسكن النزهه', ['سكن النزهة', 'سكن النزهه']))
      .toBe('سكن النزهة');
  });
});

describe('suggestUnitAssignments', () => {
  const ENTRIES = [
    { id: 'a', description: 'مروحة لسكن النزهه', amount: 139 },
    { id: 'b', description: 'دهان عام', amount: 200 },
    { id: 'c', description: 'ثلاجة لسكن الشمال', amount: 900, unit: 'سكن الروضة' },
  ];

  it('يقترح لغير المُسنَد فقط — ولا يمسّ إجابة أعطاها المستخدم', () => {
    // `c` already names a unit; re-suggesting over it would overwrite a
    // correction with the mistake it was correcting.
    const rows = suggestUnitAssignments(ENTRIES, UNITS);
    expect(rows.map((r) => r.entryId)).toEqual(['a', 'b']);
    expect(rows[0].suggested).toBe('سكن النزهة');
    expect(rows[1].suggested).toBeNull();
    expect(rows[0].amount).toBe(139);
  });

  it('وعدّاد غير المُسنَد يقرّر ظهور الزر أصلاً', () => {
    expect(unassignedCount(ENTRIES)).toBe(2);
    expect(unassignedCount([{ id: 'x', unit: 'سكن الشمال' }])).toBe(0);
    expect(unassignedCount([])).toBe(0);
  });
});

describe('groupEntriesByUnit', () => {
  it('السكن بلا مصاريف يظهر بصفر — القائمة تصف الواقع لا ما صُرف فقط', () => {
    const groups = groupEntriesByUnit([{ id: '1', unit: 'سكن النزهة', amount: 139 }], UNITS);
    expect(groups.map((g) => g.label)).toEqual(UNITS);
    expect(groups[0].total).toBe(139);
    expect(groups[1].total).toBe(0);
  });

  it('و«غير محدد» آخر مجموعة دائماً، ولا تظهر إن لم توجد', () => {
    const withUnassigned = groupEntriesByUnit([
      { id: '1', unit: 'سكن الشمال', amount: 50 }, { id: '2', amount: 100 },
    ], UNITS);
    expect(withUnassigned.at(-1).key).toBe(UNASSIGNED);
    expect(withUnassigned.at(-1).total).toBe(100);

    const allAssigned = groupEntriesByUnit([{ id: '1', unit: 'سكن الشمال', amount: 50 }], UNITS);
    expect(allAssigned.some((g) => g.key === UNASSIGNED)).toBe(false);
  });

  it('وسكنٌ أُعيدت تسميته لا يُخفي مصاريفه — يظهر بمجموعته باسمه القديم', () => {
    // The same principle the category grouping follows: a value the lookup
    // does not recognise must never make money disappear from the screen.
    const groups = groupEntriesByUnit([
      { id: '1', unit: 'سكن قديم', amount: 500 },
      { id: '2', unit: 'سكن الشمال', amount: 50 },
    ], UNITS);
    const orphan = groups.find((g) => g.label === 'سكن قديم');
    expect(orphan.total).toBe(500);
    expect(groups.reduce((n, g) => n + g.items.length, 0)).toBe(2);
  });

  it('ومجموع المجموعات = مجموع المصاريف، مهما كان الإسناد', () => {
    const entries = [
      { id: '1', unit: 'سكن النزهة', amount: 139 },
      { id: '2', unit: 'سكن قديم', amount: 500 },
      { id: '3', amount: 61 },
    ];
    const total = groupEntriesByUnit(entries, UNITS).reduce((s, g) => s + g.total, 0);
    expect(total).toBe(700);
  });
});
