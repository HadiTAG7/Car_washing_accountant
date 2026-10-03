import { describe, expect, it } from 'vitest';
import { groupInitialJourneyItems } from '../partnerCapitalJourneyGroups';

const item = (groupKey, amount, extra = {}) => ({
  groupKey, kind: 'startup', description: 'بند', amount, ...extra,
});

describe('تجميع عرض التأسيس حسب المصدر المؤكد', () => {
  it('يجمع الفرنشايز والدباب وقوى ويطرح العكس من فئته بالهللة', () => {
    const rows = [
      item('startup:franchise', 12000, { description: 'رسوم الفرنشايز' }),
      item('startup:franchise', 38000, { description: 'رسوم الفرنشايز' }),
      item('startup:bike', 38800, { description: 'الدباب' }),
      item('startup:bike', 38799.97, { description: 'الدباب' }),
      item('startup:bike', -38800, { description: 'عكس / استرداد', reversal: true }),
      item('annual:qiwa', 215.05, { kind: 'annual', description: 'قوى' }),
      item('annual:qiwa', 215.05, { kind: 'annual', description: 'قوى' }),
    ];
    const before = structuredClone(rows);
    rows.forEach(Object.freeze); Object.freeze(rows);
    const groups = groupInitialJourneyItems(rows);
    expect(groups.map(g => g.amount)).toEqual([50000, 38799.97, 430.1]);
    expect(groups[1]).toMatchObject({ description: 'الدباب', classified: true, reversal: true });
    expect(groups.reduce((sum, g) => sum + Math.round(g.amount * 100), 0)).toBe(8923007);
    expect(rows).toEqual(before);
  });

  it('لا يدمج خطتين مختلفتين أو السنوي والتأسيس ولو تطابقت الأسماء', () => {
    const rows = [item('startup:a', 1), item('startup:b', 2), item('annual:a', 3, { kind: 'annual' })];
    expect(groupInitialJourneyItems(rows).map(g => g.amount)).toEqual([1, 2, 3]);
  });

  it('العكس بلا ربط مؤكد يبقى منفصلاً وسالباً دون تخمين من الاسم', () => {
    const groups = groupInitialJourneyItems([
      item('startup:bike', 100, { description: 'الدباب' }),
      item(null, -40, { description: 'الدباب', reversal: true }),
      item('annual:bike', -10, { description: 'الدباب', reversal: true }),
    ]);
    expect(groups.map(g => g.amount)).toEqual([100, -40, -10]);
    expect(groups.slice(1).every(g => !g.classified && g.reversal)).toBe(true);
  });

  it('لا يسقط السجلات المتكررة أو المجموع الصفري أو السالب', () => {
    const groups = groupInitialJourneyItems([
      item('startup:a', 0.29, { id: 'same' }), item('startup:a', 0.29, { id: 'same' }),
      item('startup:zero', 38.8), item('startup:zero', -38.8, { reversal: true }),
      item('startup:negative', -0.01, { reversal: true }),
    ]);
    expect(groups.map(g => g.amount)).toEqual([0.58, 0, -0.01]);
    expect(groupInitialJourneyItems([])).toEqual([]);
  });

  it('يحفظ كل هللة في مجموعة كبيرة ولا يغير نطاق البيانات الممرر', () => {
    const rows = Array.from({ length: 1001 }, (_, i) => item('startup:a', i % 2 ? -0.01 : 0.03));
    expect(groupInitialJourneyItems(rows)[0].amount).toBe(10.03);
    expect(groupInitialJourneyItems([item('startup:a', 20)])[0].amount).toBe(20);
  });
});
