import { expect, it } from 'vitest';
import { washDailySummary } from '../washDailySummary';
const wash = (washDate, quantity, price = 20, status = 'مكتملة') => ({ washDate, quantity, price, status });
it('uses the newest completed service day, not yesterday or insertion order', () => {
  const data = washDailySummary([wash('2026-10-18', 3), wash('2026-10-16', 2), wash('2026-10-18', 4), wash('2026-10-19', 9, 20, 'قيد التنفيذ')]);
  expect(data.latest).toEqual({date:'2026-10-18', quantity:7, revenue:140});
  expect(data.days.map(d => d.date)).toEqual(['2026-10-18', '2026-10-16']);
  expect(data.completed).toBe(9); expect(data.revenue).toBe(180);
});
it('preserves varying prices, batch quantities, and current partner scaling', () => {
  const data = washDailySummary([wash('2026-10-18', 3, 25), wash('2026-10-18', 1, 10), wash('2026-10-17', 2, 30)], .5);
  expect(data.days.map(d => d.revenue)).toEqual([42.5,30]);
  expect(data.revenue).toBe(72.5); expect(data.completed).toBe(3);
});
it('does not invent zero days or confuse missing dates with the latest date', () => {
  const data = washDailySummary([wash('2026-02-30', 2),wash(null,1),wash('2026-10-03',4)]);
  expect(data.latest.date).toBe('2026-10-03');
  expect(data.days).toHaveLength(2); expect(data.days[1]).toEqual({date:null,quantity:3,revenue:60});
  expect(data.days.reduce((sum,d) => sum+d.revenue,0)).toBe(data.revenue);
});
it('leaves empty and entirely undated registers without a fabricated latest date', () => {
  expect(washDailySummary([])).toMatchObject({latest:null,days:[],completed:0,revenue:0});
  expect(washDailySummary([wash(undefined,2)]).latest).toBeNull();
});
