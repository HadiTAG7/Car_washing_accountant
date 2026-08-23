// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useFirestoreQuery } from '../useFirestoreQuery';

describe('useFirestoreQuery result shape', () => {
  it('preserves a single Firestore document when requested', async () => {
    const settings = { vatRegistered: true, vatRate: 0.15, taxPolicyHistory: [] };
    const fetcher = vi.fn().mockResolvedValue(settings);
    const { result } = renderHook(() => useFirestoreQuery(fetcher, {
      fallback: {},
      preserveResult: true,
    }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(settings);

    await act(async () => {
      expect(await result.current.refetch()).toEqual(settings);
    });
  });

  it('keeps collection queries normalised to arrays by default', async () => {
    const { result } = renderHook(() => useFirestoreQuery(
      () => Promise.resolve({ unexpected: true }),
      { fallback: [] },
    ));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual([]);
  });
});
