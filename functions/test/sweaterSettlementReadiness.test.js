import { describe, it, expect, vi } from 'vitest';
import { computeSettlement } from '../src/sweater/settlement.js';
import { settlementApprovalReadiness } from '../src/sweater/settlementReadiness.js';
import { sweaterApproveSettlement } from '../src/sweater/handlers.js';
import { memoryFinanceDb } from '../../server/__tests__/financeFixtures.js';
import { postSource } from '../src/ledger.js';
vi.mock('../src/ledger.js', async importOriginal => ({ ...await importOriginal(), postSource: vi.fn(async () => ({ entryId: 'isolated-journal', entryNumber: 1 })) }));
const booking = { sspBookingId: 'S-1', serviceDate: '2026-10-02', serviceType: 'wash', normalizedStatus: 'payment_collection' };
const price = { id: 'price', serviceType: 'wash', effectiveFrom: '2026-10-01', status: 'active', netRate: 20, vatRate: 0.15, priceMode: 'exclusive' };
const policy = { id: 'policy', key: 'default', effectiveFrom: '2026-10-01', status: 'active', eligibleStatuses: ['payment_collection'], excludedStatuses: ['admin_cancelled'] };
const figures = computeSettlement({ bookings: [booking], priceRows: [price], policyRows: [policy] });
const settlement = { periodKey: '2026-10', status: 'statement_received', figures, statement: { statedNetDue: 23 } };
function database(s = settlement, more = {}) { return memoryFinanceDb({ 'sweater_settlements/2026-10': structuredClone(s),
  'sweater_bookings/S-1': { periodKey: '2026-10', record: booking }, 'sweater_price_list/price': price,
  'sweater_recognition_policy/policy': policy, ...more }); }
describe('settlement approval checks', () => {
  it('requires calculation, includes unknown bookings, and never treats a missing statement as zero', () => {
    expect(settlementApprovalReadiness().allowed).toBe(false);
    expect(settlementApprovalReadiness({ settlement: { ...settlement, statement: null } }).problems.join(' ')).toContain('كشف');
    const result = settlementApprovalReadiness({ settlement: { ...settlement, figures: { ...figures, counts: { ...figures.counts, unknownStatus: 1 } } } });
    expect(result.reviewCount).toBe(1); expect(result.allowed).toBe(false);
  });
  it('requires a written matching reason even when a difference was marked resolved', () => {
    const s = { ...settlement, statement: { statedNetDue: 20 } };
    const variance = { kind: 'statement_vs_expected', difference: -3, resolution: 'accepted' };
    expect(settlementApprovalReadiness({ settlement: s, variances: [variance] }).allowed).toBe(false);
    expect(settlementApprovalReadiness({ settlement: s, variances: [{ ...variance, reasonAr: 'فرق موثق باختبار معزول' }] }).allowed).toBe(true);
    expect(settlementApprovalReadiness({ settlement: s, variances: [{ ...variance, difference: -2, reasonAr: 'سبب لفرق آخر' }] }).allowed).toBe(false);
  });
  it('ignores JSON object key order, but rejects changed amounts and newly imported bookings', () => {
    // Deep key reorder mirrors jsonb storage, not altered source values.
    const reverse = x => Array.isArray(x) ? x.map(reverse) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).reverse().map(([k,v]) => [k,reverse(v)])) : x;
    expect(settlementApprovalReadiness({ settlement: { ...settlement, figures: reverse(figures) }, freshFigures: figures, bookings: [booking] }).allowed).toBe(true);
    expect(settlementApprovalReadiness({ settlement, freshFigures: { ...figures, netDue: 25 } }).allowed).toBe(false);
    expect(settlementApprovalReadiness({ settlement, bookings: [booking, { ...booking, sspBookingId: 'S-2' }] }).allowed).toBe(false);
  });
  it.each(['statement', 'review', 'variance', 'new-booking', 'changed-policy'])('server rejects %s before ANY status, audit or journal write', async kind => {
    const s = structuredClone(settlement), extra = {};
    if (kind === 'statement') delete s.statement;
    if (kind === 'review') s.figures.counts.needsReview = 1;
    if (kind === 'variance') { s.statement.statedNetDue = 20; extra['sweater_variances/v'] = { periodKey: '2026-10', kind: 'statement_vs_expected', difference: -3, resolution: 'accepted' }; }
    if (kind === 'new-booking') extra['sweater_bookings/S-2'] = { periodKey: '2026-10', record: { ...booking, sspBookingId: 'S-2' } };
    if (kind === 'changed-policy') extra['sweater_recognition_policy/policy'] = { ...policy, eligibleStatuses: [] };
    const db = database(s, extra), before = JSON.stringify([...db.rows]); postSource.mockClear();
    await expect(sweaterApproveSettlement(db, { serverTimestamp: () => 'isolated' }, { periodKey: '2026-10' })).rejects.toThrow();
    expect(JSON.stringify([...db.rows])).toBe(before); expect(postSource).not.toHaveBeenCalled();
  });
});
