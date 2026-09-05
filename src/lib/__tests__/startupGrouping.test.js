/**
 * تجميع بنود التأسيس — الترتيب، والمجاميع، والبند الذي لا يجوز أن يختفي
 * ═══════════════════════════════════════════════════════════════════════════
 * The one that matters most is «تصنيف محذوف»: grouping by a lookup means a
 * missing key can silently swallow rows, and a startup item that vanishes
 * from the page is money the owner stops seeing. It falls to the
 * uncategorised bucket instead — visible, counted, and obviously in need of
 * a category.
 *
 * Run: npm test
 */
import { describe, it, expect } from 'vitest';
import { groupStartupItems, UNCATEGORIZED } from '../startupGrouping';

const CATS = [
  { id: 'housing', label: 'تجهيز السكن', sortOrder: 2 },
  { id: 'legal', label: 'تراخيص', sortOrder: 1 },
];
const item = (over) => ({ plannedAmount: 0, actualAmount: 0, ...over });

describe('groupStartupItems', () => {
  it('يجمع بالتصنيف ويرتّب بـ sortOrder لا بترتيب الورود', () => {
    const groups = groupStartupItems([
      item({ id: 'a', category: 'housing' }),
      item({ id: 'b', category: 'legal' }),
      item({ id: 'c', category: 'housing' }),
    ], CATS);

    expect(groups.map((g) => g.id)).toEqual(['legal', 'housing']);
    expect(groups[1].label).toBe('تجهيز السكن');
    expect(groups[1].items.map((i) => i.id)).toEqual(['a', 'c']);
  });

  it('والمجاميع الفرعية مجموع بنودها، والتجاوز يظهر كفرق سالب', () => {
    const [g] = groupStartupItems([
      item({ id: 'a', category: 'housing', plannedAmount: 300, actualAmount: 100 }),
      item({ id: 'b', category: 'housing', plannedAmount: 200, actualAmount: 450 }),
    ], CATS);

    expect(g.planned).toBe(500);
    expect(g.actual).toBe(550);
    // تجاوز قدره 50 يبقى ظاهرًا في المجموع.
    expect(g.remaining).toBe(-50);
  });

  it('و«بدون تصنيف» آخر مجموعة دائماً', () => {
    const groups = groupStartupItems([
      item({ id: 'a' }),
      item({ id: 'b', category: 'housing' }),
    ], CATS);
    expect(groups.map((g) => g.id)).toEqual(['housing', UNCATEGORIZED]);
    expect(groups.at(-1).label).toBe('بدون تصنيف');
  });

  it('وتصنيفٌ حُذف من القائمة لا يُسقط بنوده — يجمعها في «بدون تصنيف»', () => {
    const groups = groupStartupItems([
      item({ id: 'ghost', category: 'deleted-cat', plannedAmount: 700 }),
      item({ id: 'b', category: 'legal', plannedAmount: 100 }),
    ], CATS);

    expect(groups.flatMap((g) => g.items).map((i) => i.id).sort()).toEqual(['b', 'ghost']);
    const orphan = groups.find((g) => g.id === UNCATEGORIZED);
    expect(orphan.items.map((i) => i.id)).toEqual(['ghost']);
    expect(orphan.planned).toBe(700);
  });

  it('ولا مجموعة فارغة — رأسٌ يعد بصفوف ولا يعطيها', () => {
    const groups = groupStartupItems([item({ id: 'a', category: 'legal' })], CATS);
    expect(groups.map((g) => g.id)).toEqual(['legal']);
  });

  it('وقائمة فارغة ⇒ لا مجموعات', () => {
    expect(groupStartupItems([], CATS)).toEqual([]);
    expect(groupStartupItems()).toEqual([]);
  });

  it('ولا يفقد بنداً مهما كانت التصنيفات', () => {
    const items = [
      item({ id: '1', category: 'housing' }), item({ id: '2', category: 'legal' }),
      item({ id: '3', category: 'gone' }), item({ id: '4' }),
    ];
    const total = groupStartupItems(items, CATS).reduce((n, g) => n + g.items.length, 0);
    expect(total).toBe(items.length);
  });
});
