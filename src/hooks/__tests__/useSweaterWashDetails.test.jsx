// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const fs = vi.hoisted(() => ({ calls: [], docs: {} }));
vi.mock('../../lib/firebaseClient', () => ({ db: {}, isFirebaseConfigured: true }));
vi.mock('firebase/firestore', () => ({
  collection: (_db, name) => ({ name }),
  documentId: () => '__id__',
  where: (field, op, values) => ({ field, op, values }),
  query: (ref, clause) => ({ ref, clause }),
  getDocs: async ({ clause }) => {
    fs.calls.push(clause.values.length);
    const docs = clause.values.filter(id => fs.docs[id]).map(id => ({ id, data: () => fs.docs[id] }));
    return { docs };
  },
}));
import { useSweaterWashDetails } from '../useSweaterWashDetails';
afterEach(() => { cleanup(); fs.calls = []; fs.docs = {}; });

it('reads thirty tickets per request, keeps only matching bookings, and reads nothing on return', async () => {
  const ids = Array.from({ length: 65 }, (_, i) => `SB/${String(i).padStart(3, '0')}`);
  for (const id of ids) fs.docs[encodeURIComponent(id)] = { sspBookingId: id };
  fs.docs[encodeURIComponent('SB/007')] = { sspBookingId: 'another' };
  const first = renderHook(() => useSweaterWashDetails(ids, true));
  await waitFor(() => expect(first.result.current.loading).toBe(false));
  expect(fs.calls).toEqual([30, 30, 5]);
  expect(first.result.current.bookings).toHaveLength(64);
  expect(first.result.current.bookings.map(b => b.sspBookingId)).not.toContain('another');
  first.unmount();
  const again = renderHook(() => useSweaterWashDetails([...ids].reverse(), true));
  expect(again.result.current.bookings).toHaveLength(64);
  expect(fs.calls).toHaveLength(3);
});
