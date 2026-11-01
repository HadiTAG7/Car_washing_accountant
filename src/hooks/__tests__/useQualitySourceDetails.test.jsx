// @vitest-environment jsdom
import { expect, it, vi, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
const mocks = vi.hoisted(() => ({ query: vi.fn(), fetch: vi.fn(), get:vi.fn(), role: 'admin', partner: false }));
vi.mock('../useAuth', () => ({ useAuth: () => ({ user: { id: 'synthetic-user' } }) }));
vi.mock('../../contexts/PartnerViewContext', () => ({ usePartnerView: () => ({ role: mocks.role, isPartnerView: mocks.partner }) }));
vi.mock('../useCompensationReview', () => ({ useCompensationReview: () => ({ refresh: vi.fn() }) }));
vi.mock('../useFirestoreQuery', () => ({ useFirestoreQuery: (...args) => mocks.query(...args) }));
vi.mock('../../lib/firebaseClient', () => ({ isFirebaseConfigured: true }));
vi.mock('../../lib/firestoreCrud', () => ({ fetchRows: (...args) => mocks.fetch(...args), getRow:(...args)=>mocks.get(...args), where: (...args) => args }));
import { useQualitySourceDetails } from '../useQualitySourceDetails';
afterEach(() => { cleanup(); vi.clearAllMocks(); mocks.role = 'admin'; mocks.partner = false; });
it.each([['partner',false],['admin',true],['accountant',false],['operator',false]])('disables every operational read for %s / partner=%s', (role, partner) => {
  mocks.role = role; mocks.partner = partner;
  mocks.query.mockReturnValue({ data: [], refetch: vi.fn() });
  renderHook(() => useQualitySourceDetails('2026-10'));
  expect(mocks.query.mock.calls.every(([, options]) => options.enabled === false)).toBe(true);
  expect(mocks.fetch).not.toHaveBeenCalled();
});
it('reads one month and batches raw observations for known cancellation identities only, without a writer', async () => {
  const booking = { record: { sspBookingId: 'B-42', rawStatus: 'Cancelled by Admin' } };
  mocks.query.mockImplementation((fn, options) => ({ data: options.cacheKey.startsWith('quality-bookings:') ? [booking] : [], refetch: vi.fn() }));
  mocks.fetch.mockResolvedValue([{ id: 'one',importRunId:'synthetic-run' }]);
  mocks.get.mockResolvedValue({coverage:{extractedAt:'2026-10-27T11:00:00Z'}});
  const read = renderHook(() => useQualitySourceDetails('2026-10'));
  const [bookingRead, bookingOptions] = mocks.query.mock.calls[0], [rawRead] = mocks.query.mock.calls[1];
  await bookingRead(); expect(mocks.fetch).toHaveBeenCalledWith('sweater_bookings', [['periodKey','==','2026-10']]);
  expect(bookingOptions.queryKey).toBe('synthetic-user');
  const raw=await rawRead(); expect(mocks.fetch).toHaveBeenCalledWith('sweater_raw_payloads', [['sspBookingId','in',['42','B-42','C-42','S-42']]]);
  expect(mocks.get).toHaveBeenCalledWith('sweater_import_runs','synthetic-run'); expect(raw[0].sourceReadAtIso).toBe('2026-10-27T11:00:00Z');
  expect(Object.keys(read.result.current).sort()).toEqual(['bookings','observations','refresh','reviews']);
});
