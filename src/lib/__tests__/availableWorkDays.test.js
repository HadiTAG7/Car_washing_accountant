import { expect, it } from 'vitest';
import { availableWorkDays } from '../availableWorkDays';

it('uses the same leave proportion for full and elapsed windows, excludes today and includes zero-wash days', () => {
  const full = availableWorkDays({ periodKey: '2026-10' });
  const elapsed = availableWorkDays({ periodKey: '2026-10', beforeDate: '2026-10-26' });
  expect(full).toMatchObject({ calendarDays: 31, workDays: 29 });
  expect(elapsed.calendarDays).toBe(25); expect(elapsed.workDays).toBeCloseTo(25 * 29 / 31, 12);
});
it('clips join/end dates and leap months, with no available time before joining or on the first day', () => {
  const partial = availableWorkDays({ periodKey: '2026-10', startDate: '2026-10-15', endDate: '2026-10-20', beforeDate: '2026-10-26' });
  expect(partial.calendarDays).toBe(6); expect(partial.workDays).toBeCloseTo(6 * 29 / 31, 12);
  expect(availableWorkDays({ periodKey: '2026-10', startDate: '2026-10-26', beforeDate: '2026-10-26' }).workDays).toBe(0);
  expect(availableWorkDays({ periodKey: '2026-10', beforeDate: '2026-10-01' }).workDays).toBe(0);
  expect(availableWorkDays({ periodKey: '2024-02', beforeDate: '2024-03-01' })).toMatchObject({ calendarDays: 29, workDays: 27 });
});
it('rejects malformed dates and leave assumptions instead of inventing availability', () => {
  for (const extra of [{ startDate: '2026-02-30' }, { endDate: 'bad' }, { beforeDate: 'bad' }, { monthlyDaysOff: -1 }, { monthlyDaysOff: 32 }]) {
    expect(availableWorkDays({ periodKey: '2026-10', ...extra })).toBeNull();
  }
});
