// @vitest-environment jsdom
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { afterEach, it, expect, vi } from 'vitest';
vi.mock('../../lib/firebaseClient', () => ({ isFirebaseConfigured: true }));
vi.mock('../../lib/accounting/firestoreInvoicing', () => ({ fetchDocuments: async () => [], sequenceGaps: () => [],
  fetchSellerProfile: async () => ({ name: 'منشأة اصطناعية', address: 'عنوان اختبار', vatNumber: '', vatRegistered: false }) }));
import { useSalesDocuments } from '../useSalesDocuments';
afterEach(cleanup);
it('preserves the seller object instead of silently converting it into an empty array', async () => {
  const { result } = renderHook(() => useSalesDocuments());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.seller).toEqual({ name: 'منشأة اصطناعية', address: 'عنوان اختبار', vatNumber: '', vatRegistered: false });
});
