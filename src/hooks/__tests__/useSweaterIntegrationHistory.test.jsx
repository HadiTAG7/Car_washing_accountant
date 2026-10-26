// @vitest-environment jsdom
import { it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), call: vi.fn().mockResolvedValue([]) }));
vi.mock('../../lib/firebaseClient', () => ({ isFirebaseConfigured: true }));
vi.mock('../../lib/ledgerTransport', () => ({ callServer: mocks.call }));
vi.mock('../../lib/firestoreCrud', () => ({ fetchRows: mocks.fetch, sortBy: x => x,
  where: (...args) => args, orderBy: (...args) => args, limit: (...args) => args }));
import { useSweaterIntegration } from '../useSweater';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('reads only the seven-day range and returns every saved run without writes', async () => {
  const now = Date.now();
  const rows = Array.from({ length: 60 }, (_, i) => ({ id: String(i), startedAtIso: new Date(now - (i + 1) * 36e5).toISOString() }));
  mocks.fetch.mockImplementation(async name => name === 'sweater_import_runs' ? [...rows, { id: 'old', startedAtIso: new Date(now - 200 * 36e5).toISOString() }] : []);
  const { result } = renderHook(() => useSweaterIntegration());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.runs).toHaveLength(60);
  const constraint = mocks.fetch.mock.calls.find(([name]) => name === 'sweater_import_runs')[1][0];
  expect(constraint.slice(0, 2)).toEqual(['startedAtIso', '>=']);
  expect(Math.abs(Date.parse(constraint[2]) - (now - 7 * 86400000))).toBeLessThan(1000);
  expect(mocks.call.mock.calls.every(([name]) => name === 'sweaterListIntegrationKeys')).toBe(true);
});
