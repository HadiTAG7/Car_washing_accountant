import { it, expect } from 'vitest';
import { operationalKpis } from '../sweater/dashboard.js';
import { reviewGroups, dataPeriods, registeredMetric } from '../sweater/settlementDisplay.js';
it('missing, blank and zero ratings are not low ratings', () => {
  const result = operationalKpis([null, undefined, '', 0, 6].map(rating => ({ rating })));
  expect(result.averageRating.value).toBe(null); expect(result.lowRatedCount.value).toBe(0);
  expect(operationalKpis([{ rating: 3 }, { rating: 5 }, { rating: null }]).averageRating.value).toBe(4);
});
it('groups every review and unknown row without the old 40 booking truncation', () => {
  const result = reviewGroups({ lines: { review: Array.from({ length: 112 }, (_, i) => ({ sspBookingId: `S-${i}`, reasonCode: 'no_recognition_policy' })), unknown: [{ sspBookingId: 'U', reasonCode: 'unknown_status' }] } });
  expect(result.map(g => g.rows.length)).toEqual([112, 1]); expect(result[0].href).toContain('app.hadialghanim.com');
});
it('starts at the first data month instead of inventing the preceding 12 months', () => {
  expect(dataPeriods('2026-08', ['2026-09'], '2026-10')).toEqual(['2026-10', '2026-09', '2026-08']);
  expect(dataPeriods(null, [], '2026-10')).toEqual(['2026-10']);
});
it('compares like units and does not infer event counts from money', () => {
  expect(registeredMetric([], 'cancelledByBiker', 'count').value).toBe(0);
  expect(registeredMetric([{ typeKey: 'cancelled_by_biker', amount: 20 }], 'cancelledByBiker', 'count').value).toBe(null);
  expect(registeredMetric([{ typeKey: 'proven_damage', amount: 12.5 }], 'damages', 'sar').value).toBe(12.5);
});
