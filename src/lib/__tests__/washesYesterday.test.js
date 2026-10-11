import { expect, it } from 'vitest';
import { completedWashesYesterday, riyadhTodayISO } from '../washesYesterday';
import { loadEnglish, translate } from '../../i18n/locale';
it('uses Riyadh midnight regardless of the viewer timezone', () => {
  expect(riyadhTodayISO(new Date('2026-10-10T20:59:59Z'))).toBe('2026-10-10');
  expect(riyadhTodayISO(new Date('2026-10-10T21:00:00Z'))).toBe('2026-10-11');
});
it.each([
  ['2026-01-01', '2025-12-31'],
  ['2026-03-01', '2026-02-28'],
  ['2028-03-01', '2028-02-29'],
])('includes the previous calendar day at month/year/leap boundaries: %s', (today, yesterday) => {
  expect(completedWashesYesterday([
    { washDate: yesterday, status: 'مكتملة', quantity: 6 },
    { washDate: today, status: 'مكتملة', quantity: 10 },
  ], today)).toBe(6);
});
it('ignores invalid dates and quantities rather than inventing historical activity', () => {
  const rows = ['', null, '2026-02-30', '2026-2-01', 'not-a-date'].map(washDate => ({ washDate, status: 'مكتملة', quantity: 9 }));
  rows.push(...[NaN, Infinity, -1, null, undefined].map(quantity => ({ washDate: '2026-10-10', status: 'مكتملة', quantity })));
  rows.push({ washDate: '2026-10-10', status: 'مكتملة', quantity: 3 });
  expect(completedWashesYesterday(rows, '2026-10-11')).toBe(3);
});
it('counts quantities for yesterday only, not earlier, today, future or incomplete washes', () => {
  const rows = [
    { washDate: '2026-10-09', status: 'مكتملة', quantity: 100 },
    { washDate: '2026-10-10', status: 'مكتملة', quantity: 3 },
    { washDate: '2026-10-10', status: 'مكتملة', quantity: 2 },
    { washDate: '2026-10-10', status: 'قيد التنفيذ', quantity: 10 },
    { washDate: '2026-10-11', status: 'مكتملة', quantity: 20 },
    { washDate: '2026-10-12', status: 'مكتملة', quantity: 30 },
  ];
  expect(completedWashesYesterday(rows, '2026-10-11')).toBe(5);
});
it.each(['', null, '2026-02-30', '2026-2-01'])('rejects invalid reporting days: %s', today => {
  expect(completedWashesYesterday([{ washDate: '2026-02-28', status: 'مكتملة', quantity: 3 }], today)).toBe(0);
});
it('provides reviewed English labels for the new card', async () => {
  await loadEnglish();
  expect(translate('غسلات أمس', 'en')).toBe("Yesterday's washes");
  expect(translate('الغسلات المكتملة المسجلة ليوم أمس فقط — بتوقيت الرياض', 'en')).toBe('Recorded completed washes for yesterday only — Riyadh time');
});
