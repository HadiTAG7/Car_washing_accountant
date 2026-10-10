import { describe, expect, it } from 'vitest';
import { mapWash } from '../../src/lib/mappers.js';
import { liveIncomeStatement } from '../../src/lib/accounting/liveIncomeStatement.js';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../../src/lib/accounting/chartOfAccounts.js';

// Characterization only: an execution writer must not rely on these fallbacks
// to interpret missing prices. No production writer or pricing policy changes.
const execution = extra => ({ id: 'synthetic-unpriced-execution', ssp_booking_id: 'S-990099',
  biker_id: 'synthetic-worker', biker_name: 'Synthetic worker', quantity: 1,
  status: 'مكتملة', wash_date: '2026-10-08', revenue_origin: 'sweater',
  collection_status: 'pending', payment_method: null, price: null, ...extra });
const statement = washes => liveIncomeStatement({ accounts: DEFAULT_CHART_OF_ACCOUNTS,
  periodKey: '2026-10', entries: [], lines: [], sources: { washes } });

describe('unpriced execution requires an explicit pricing/report contract', () => {
  it('current mapper loses the difference between unknown price and an evidenced zero', () => {
    const unknown = mapWash(execution());
    const zero = mapWash(execution({ price: 0 }));
    expect(unknown.price).toBe(0);
    expect(unknown.price).toBe(zero.price);
    expect(unknown.paymentMethod).toBeNull();
  });
  it('current report silently interprets unknown price as zero but estimates VAT when an arbitrary price is inserted', () => {
    const unpriced = statement([execution()]);
    expect(unpriced.netRevenue).toBe(0);
    expect(unpriced.issues).toEqual([]);
    const arbitrary = statement([execution({ price: 23 })]);
    expect(arbitrary.netRevenue).toBe(20);
    expect(arbitrary.operationalItems[0]).toMatchObject({ vat: 3, gross: 23 });
    // Neither fallback establishes a project price or tax basis from execution.
  });
});
