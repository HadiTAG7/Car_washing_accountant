// Synthetic visual-test fixture. Reference financial totals supplied by Hadi;
// no credentials, live SDK reads, financial writes or real worker identities.
import { overviewOperations } from '../../src/lib/overviewDashboard';
const today = '2026-10-21';
const bikers = [{ id: 'TEST-A', driverExternalId: 'TEST-A', name: 'بايكر اختبار أ', nameEnglish: 'Test biker A', currentStatus: 'working', iqamaExpiry: '2026-11-01' },
  { id: 'TEST-B', driverExternalId: 'TEST-B', name: 'بايكر اختبار ب', nameEnglish: 'Test biker B', currentStatus: 'training', iqamaExpiry: '' }];
const quantities = [0, 0, 7, 5, 4, 11, 14, 23, 15, 25, 23, 17, 22, 29, 33, 25, 44, 36, 20, 29, 0];
const washes = quantities.flatMap((quantity, index) => Array.from({ length: quantity }, (_, i) => ({ id: `TEST-${index}-${i}`, sspBookingId: `TEST-${index}-${i}`, bikerId: bikers[i % bikers.length].id,
  bikerName: bikers[i % bikers.length].name, washDate: `2026-10-${String(index + 1).padStart(2, '0')}`, status: 'مكتملة', quantity: 1 })));
const ready = items => ({ items, loading: false, error: null });
export function useOverviewDashboard(periodKey) {
  const selected = periodKey === '2026-10';
  const statement = { periodKey, netRevenue: selected ? 7640 : 0, totalCosts: selected ? 30036.57 : 0, netProfit: selected ? -22396.57 : 0, salaryAccrual: { estimated: true }, issues: [] };
  return { finance: { statement, previous: null, loading: false }, operations: overviewOperations({ washes, bikers, periodKey, today }),
    workers: { bikers, loading: false, error: null }, washes: ready(washes), dueVouchers: [], retry: () => {},
    bookings: ready([{ record: { sspBookingId: 'TEST-19-0', serviceDate: '2026-10-20', driverExternalId: 'TEST-A', startedAt: '2026-10-20T09:00:00+03:00', completedAt: '2026-10-20T09:09:00+03:00' } }]),
    settlements: ready([]), adjustments: ready([]) };
}
