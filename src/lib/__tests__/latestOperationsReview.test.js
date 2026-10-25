import { expect, it, vi } from 'vitest';
import { readLatestOperationsReview } from '../latestOperationsReview';
import { operationsFixture } from '../../../server/__tests__/operationsFixture';

it('ignores targeted/sync/asset and imported reports, selects latest broad cut across pages within a day', async () => {
  const older = operationsFixture({ round: '0800', cutAtRiyadh: '2026-10-18T08:00:00+03:00' });
  const latest = operationsFixture();
  const targeted = operationsFixture({ kind: 'targeted', cutAtRiyadh: '2026-10-18T22:00:00+03:00' });
  const request = vi.fn().mockResolvedValueOnce({ items: [targeted, older], nextBefore: 'next' })
    .mockResolvedValueOnce({ items: [latest, { ...latest, dateRiyadh: '2026-10-17', archiveMode: 'historical_imported' }] })
    .mockResolvedValueOnce({ report: latest });
  expect(await readLatestOperationsReview(request, '2026-10-18')).toEqual(latest);
  expect(request.mock.calls.map(c => c[0])).toEqual([
    { action: 'list' }, { action: 'list', before: 'next' }, { action: 'read', reportId: latest.reportId, revision: 1 },
  ]);
});
it('returns unavailable, not targeted coverage or zero, if no eligible review exists', async () => {
  const request = vi.fn().mockResolvedValue({ items: [operationsFixture({ kind: 'targeted' }), operationsFixture({ kind: 'sync' }), operationsFixture({ kind: 'assets' })] });
  expect(await readLatestOperationsReview(request, '2026-10-18')).toBeNull();
  expect(request).toHaveBeenCalledTimes(1);
});
it('rejects mismatched revision, invalid payload, read failure and cursor loops', async () => {
  const report = operationsFixture();
  for (const payload of [{ report: { ...report, revision: 2 } }, { report: null }]) {
    const request = vi.fn().mockResolvedValueOnce({ items: [report] }).mockResolvedValueOnce(payload);
    await expect(readLatestOperationsReview(request, '2026-10-18')).rejects.toThrow();
  }
  await expect(readLatestOperationsReview(vi.fn().mockRejectedValue(new Error('offline')), '2026-10-18')).rejects.toThrow('offline');
  await expect(readLatestOperationsReview(vi.fn().mockResolvedValue({ items: [], nextBefore: 'loop' }), '2026-10-18')).rejects.toThrow();
});
