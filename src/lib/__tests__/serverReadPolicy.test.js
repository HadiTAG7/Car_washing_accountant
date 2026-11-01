import { beforeEach, expect, it } from 'vitest';
import { cachedRead, peekCached, __resetReadCache } from '../readCache';
import { invalidateAfterServerCall } from '../serverReadPolicy';
beforeEach(__resetReadCache);
it('retains reads for true dry-run; saved calculation and lookalike flags invalidate', async () => {
  for (const flag of [true, false, undefined, 'true', 1]) {
    await cachedRead('TEST', async () => 'source');
    invalidateAfterServerCall('sweaterCalculateSettlement', { dryRun: flag });
    expect(Boolean(peekCached('TEST'))).toBe(flag === true);
  }
});
it('still invalidates writes even with a caller-supplied dryRun flag', async () => {
  await cachedRead('TEST', async () => 'source');
  invalidateAfterServerCall('sweaterApproveSettlement', { dryRun: true });
  expect(peekCached('TEST')).toBeNull();
});
