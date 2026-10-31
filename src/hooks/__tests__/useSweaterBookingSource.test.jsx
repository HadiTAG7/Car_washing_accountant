// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { useSweaterBookingSource } from '../useSweaterBookingSource';
const mock = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('../../lib/firebaseClient', () => ({ isFirebaseConfigured: true }));
vi.mock('../../lib/firestoreCrud', () => ({ fetchRows: (...args) => mock.fetch(...args), where: (...args) => args }));
afterEach(() => { cleanup(); mock.fetch.mockReset(); });
it('reads only one natural booking across stored prefixes and hides old results when the selected identity changes', async () => {
  mock.fetch.mockResolvedValueOnce([{ id: 'test-first' }]).mockResolvedValueOnce([{ id: 'test-second' }]);
  const { result, rerender } = renderHook(({ id }) => useSweaterBookingSource(id), { initialProps: { id: 'B-101' } });
  await waitFor(() => expect(result.current.data).toEqual([{ id: 'test-first' }]));
  expect(mock.fetch.mock.calls[0]).toEqual(['sweater_raw_payloads', [['sspBookingId', 'in', ['B-101', '101', 'C-101', 'S-101']]]]);
  rerender({ id: 'C-102' }); expect(result.current.data).not.toEqual([{ id: 'test-first' }]);
  await waitFor(() => expect(result.current.data).toEqual([{ id: 'test-second' }]));
  expect(mock.fetch).toHaveBeenCalledTimes(2);
});
