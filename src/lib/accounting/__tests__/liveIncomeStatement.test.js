import { describe, expect, it } from 'vitest';
import { liveIncomeStatement } from '../liveIncomeStatement';
import { monthlyStatement, operationalWashSales } from '../monthlyStatement';
import { mapWash } from '../../mappers';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../chartOfAccounts';
import { outputTaxFromWashes } from '../vatReturn';

const snapshot = { source: 'owner_statement', clarificationId: 'synthetic-tax', currency: 'SAR', priceMode: 'exclusive', quantity: 1, net: 20, vat: 3, gross: 23 };
const wash = (id = 'synthetic-1', extra = {}) => ({ id, ssp_booking_id: id, biker_name: 'Synthetic worker', quantity: 1, price: 20,
  wash_date: '2026-10-03', status: 'مكتملة', revenue_origin: 'sweater', collection_status: 'confirmed_by_owner', owner_tax_snapshot: snapshot, ...extra });
const options = extra => ({ accounts: DEFAULT_CHART_OF_ACCOUNTS, entries: [], lines: [], periodKey: '2026-10', feeRules: [{ key: 'none', rate: 0 }], ...extra });
const posted = (kind, sourceId, rows, extra = {}) => ({ id: `entry-${kind}-${sourceId}`, sourceKind: kind, sourceType: kind === 'variable' ? 'expense' : kind,
  sourceId, entryDate: '2026-10-03', status: 'posted', lines: rows.map(([accountId, debit, credit]) => ({ accountId, debit, credit })), ...extra });
const linesOf = e => e.lines.map((line, i) => ({ ...line, entryId: e.id, id: `${e.id}:${i}` }));

describe('live income combines registered sources once, without tax revenue or invented journal entries', () => {
  it('shows twelve saved washes immediately as net240, while tax36 and gross276 remain separate and ledger income stays0', () => {
    const washes = Array.from({ length: 12 }, (_, i) => wash(`synthetic-${i}`));
    const input = options({ sources: { washes } }); const before = structuredClone(input);
    const result = liveIncomeStatement(input);
    expect(result).toMatchObject({ netRevenue: 240, ledgerNetRevenue: 0, unpostedNetRevenue: 240 });
    expect(result.operationalItems.reduce((sum, row) => sum + row.vat, 0)).toBe(36);
    expect(operationalWashSales(washes.map(mapWash), { periodKey: '2026-10' })).toMatchObject({ net: 240, vat: 36, gross: 276 });
    expect(outputTaxFromWashes(washes.map(mapWash), { period: '2026-Q4' })).toMatchObject({ net: 240, tax: 36, gross: 276 });
    expect(monthlyStatement(input).netRevenue).toBe(0); expect(input).toEqual(before);
  });
  it('posting the exact wash replaces its operational contribution, never doubles it; returns and reversals remain effective', () => {
    const sources = { washes: [wash()] }; const sale = posted('wash', 'synthetic-1', [['1020', 23, 0], ['4000', 0, 20], ['2100', 0, 3]]);
    const before = liveIncomeStatement(options({ sources }));
    const after = liveIncomeStatement(options({ sources, entries: [sale], lines: linesOf(sale) }));
    expect(before.netRevenue).toBe(20); expect(after.netRevenue).toBe(20); expect(after.unpostedNetRevenue).toBe(0);
    const credit = posted('credit_note', 'credit', [['4010', 20, 0], ['2100', 3, 0], ['1020', 0, 23]]);
    expect(liveIncomeStatement(options({ sources, entries: [sale, credit], lines: [...linesOf(sale), ...linesOf(credit)] })).netRevenue).toBe(0);
    sale.status = 'reversed'; const mirror = posted('adjustment', null, [['4000', 20, 0], ['2100', 3, 0], ['1020', 0, 23]], { reversalOf: sale.id });
    expect(liveIncomeStatement(options({ sources, entries: [sale, mirror], lines: [...linesOf(sale), ...linesOf(mirror)] })).netRevenue).toBe(0);
  });
  it('deduplicates SSP executions and removes only the bookings actually included in a posted monthly settlement', () => {
    const sources = { washes: [wash('one'), wash('duplicate', { ssp_booking_id: 'one' }), wash('two')],
      settlements: [{ id: '2026-10', figures: { lines: { eligible: [{ sspBookingId: 'one' }] } } }] };
    expect(liveIncomeStatement(options({ sources })).netRevenue).toBe(40);
    const settlement = posted('sweater_settlement', '2026-10', [['1140', 23, 0], ['4000', 0, 20], ['2100', 0, 3]]);
    const result = liveIncomeStatement(options({ sources, entries: [settlement], lines: linesOf(settlement) }));
    expect(result.netRevenue).toBe(40); expect(result.unpostedNetRevenue).toBe(20);
  });
  it('uses frozen posted values instead of a subsequently edited source or tax policy', () => {
    const e = posted('wash', 'one', [['1020', 23, 0], ['4000', 0, 20], ['2100', 0, 3]]);
    expect(liveIncomeStatement(options({ sources: { washes: [wash('one', { price: 999 })] }, entries: [e], lines: linesOf(e) })).netRevenue).toBe(20);
  });
  it('adds registered operating purchases, separates input tax, replaces on posting, and excludes capital, budgets and advances', () => {
    const variable = { id: 'expense-1', total_variable_cost: 115, logged_date: '2026-10-03', is_tax_invoice: true,
      invoice_number: 'synthetic-invoice', invoice_date: '2026-10-03', supplier: 'Synthetic supplier', vat_amount: 15, price_mode: 'inclusive' };
    const sources = { variables: [variable], startups: [{ amount: 9999 }], fixedAssets: [{ cost: 9999 }],
      temporaryExpenses: [{ amount: 9999 }], monthlies: [{ id: 'budget', total_monthly_cost: 9999, recurrence: 'monthly' }], annuals: [{ annual_cost: 9999 }] };
    const before = liveIncomeStatement(options({ sources })); expect(before.directCosts).toBe(100); expect(before.totalCosts).toBe(100);
    const e = posted('variable', 'expense-1', [['5100', 100, 0], ['1200', 15, 0], ['1020', 0, 115]]);
    const after = liveIncomeStatement(options({ sources, entries: [e], lines: linesOf(e) })); expect(after.totalCosts).toBe(100);
    expect(after.operationalItems).toHaveLength(0);
  });
  it('counts dated annual spends and monthly vouchers, not their budget/template a second time', () => {
    const result = liveIncomeStatement(options({ sources: { annualEntries: [{ id: 'annual', amount: 30, spent_date: '2026-10-03' }],
      vouchers: [{ id: 'voucher', amount: 20, dueDate: '2026-10-03', status: 'unpaid' }, { id: 'cancelled', amount: 99, dueDate: '2026-10-03', status: 'cancelled' }] } }));
    expect(result.totalCosts).toBe(50); expect(result.operatingExpenses).toBe(50);
  });
  it('does not invent VAT from an unclarified owner price or include noncompleted/out-of-period washes', () => {
    const result = liveIncomeStatement(options({ sources: { washes: [wash('unknown', { owner_tax_snapshot: null }), wash('cancelled', { status: 'قيد التنفيذ' }), wash('old', { wash_date: '2026-09-30' })] } }));
    expect(result.netRevenue).toBe(0); expect(result.issues).toHaveLength(1);
  });
});
