import { expect, it } from 'vitest';
import { vatFilingDeadline, vatDaysRemaining, registeredVatPeriods, reportedVatFilings, TAX_FILING_REPORT_ID, buildVatDashboardReport, groupVatGaps } from '../vatDashboard';
import { composeTaxInvoices } from '../taxInvoiceFeed';
const settings = { vatRegistered: true, vatRate: .15, washPriceMode: 'inclusive', vatFilingPeriod: 'quarterly', taxPolicyHistory: [{ effectiveFrom: '2026-05-01', vatRegistered: true, vatRate: .15, washPriceMode: 'inclusive' }] };
const wash = (id, date, origin = 'sweater') => ({ id, washDate: date, price: 23, quantity: 1, status: 'مكتملة', revenueOrigin: origin });
const sources = { settings, today: '2026-10-26', period: '2026-Q4', filing: 'quarterly' };
it.each([['2026-Q2', '2026-07-31'], ['2026-Q3', '2026-10-31'], ['2026-Q4', '2027-01-31'], ['2024-01', '2024-02-29'], ['2026-12', '2027-01-31'], ['bad', null], ['2026-13', null]])('filing deadline %s is %s', (period, expected) => {
  expect(vatFilingDeadline(period)).toBe(expected);
});
it('counts calendar days across years and keeps historical missing evidence separate', () => {
  expect(vatDaysRemaining('2027-01-31', '2026-10-26')).toBe(97);
  expect(vatDaysRemaining('2026-10-31', '2026-10-26')).toBe(5);
  expect(registeredVatPeriods(settings, '2026-10-26')).toEqual(['2026-Q2', '2026-Q3', '2026-Q4']);
  expect(registeredVatPeriods({}, '2026-10-26')).toEqual([]);
});
it('labels the specific saved Q3 observation reported, never owner-confirmed or received', () => {
  const report = { reportId: TAX_FILING_REPORT_ID, sourceRole: 3, dateRiyadh: '2026-10-24',
    visibleWarnings: [{ id: 'historical-q3', text: 'مرجع65011830763' }], cases: [{ caseId: 'TAX-Q3-FILED-CREDIT-PRESENTATION-20261015' }] };
  expect(reportedVatFilings(report)['2026-Q3']).toMatchObject({ status: 'reported', reference: '65011830763', submittedAt: '2026-10-15' });
  expect(reportedVatFilings({ ...report, sourceRole: 1 })).toEqual({});
  expect(reportedVatFilings({ ...report, visibleWarnings: [] })).toEqual({});
  expect(reportedVatFilings(null)).toEqual({});
});
it('always exposes operational and ledger output, using operational net even when ledger exists', () => {
  const report = buildVatDashboardReport({ ...sources, washes: [wash('a', '2026-10-01')], entries: [{ id: 'e', entryDate: '2026-10-02', status: 'posted' }], lines: [{ entryId: 'e', accountId: '2100', credit: 1, debit: 0 }] });
  expect(report.output.tax).toBe(3); expect(report.ledgerOutput.tax).toBe(1); expect(report.outputMismatch).toBe(2); expect(report.netTax).toBe(3);
  expect(buildVatDashboardReport({ ...sources, period: '2026-Q3', washes: [wash('a', '2026-10-01')] }).output.tax).toBe(0);
});
it('replaces only Sweater VAT for approved months, preserves direct sales and does not add twice', () => {
  const base = { ...sources, washes: [wash('a', '2026-10-01'), wash('direct', '2026-10-01', 'direct')],
    settlements: [{ periodKey: '2026-10', status: 'approved', figures: { services: { vat: 9, net: 60, gross: 69, count: 3 } } }] };
  const copy = JSON.stringify(base); expect(buildVatDashboardReport(base).output.tax).toBe(12);
  expect(buildVatDashboardReport(base).output).toMatchObject({ net: 80, gross: 92, count: 4 });
  expect(buildVatDashboardReport({ ...base, settlements: [{ ...base.settlements[0], status: 'calculated' }] }).output.tax).toBe(6);
  expect(buildVatDashboardReport({ ...base, settlements: [...base.settlements, ...base.settlements] }).outputUnavailable).toBe(true);
  expect(JSON.stringify(base)).toBe(copy);
});
it('excludes future records and separates undated gaps from the selected quarter totals', () => {
  const report = buildVatDashboardReport({ ...sources, washes: [wash('future', '2026-10-27'), wash('now', '2026-10-26')], inputs: [{ id: 'x', sourceKind: 'variable', amount: 115, isTaxInvoice: true, supplier: 'شركة', vatAmount: 15, invoiceNumber: '1' }] });
  expect(report.output.tax).toBe(3); expect(report.ineligible).toHaveLength(0); expect(report.unassigned).toHaveLength(1); expect(report.forfeitedTax).toBe(0);
});
it('groups overlapping missing fields explicitly but counts suppliers once per invoice', () => {
  const result = groupVatGaps([{ id: 'a', supplier: 'شركة', amount: 115, documentVat: 15, missing: ['رقم الفاتورة', 'تاريخ الفاتورة'] }, { id: 'b', supplier: 'شركة', amount: 230, documentVat: 30, missing: ['رقم الفاتورة'] }]);
  expect(result.reasons.find(row => row.key === 'رقم الفاتورة')).toMatchObject({ count: 2, amount: 345, tax: 45 });
  expect(result.suppliers[0]).toMatchObject({ count: 2, amount: 345, tax: 45 });
});
it('normalises non-tax documents for gap display without making them tax invoices or duplicating vouchers', () => {
  const report = composeTaxInvoices({ includeNonTax: true, monthlyExpenses: [{ id: 'm', isTaxInvoice: false, totalMonthlyCost: 100, recurrence: 'one_time', loggedDate: '2026-10-01' }],
    variableExpenses: [{ id: 'v', isTaxInvoice: false, totalVariableCost: 50, loggedDate: '2026-10-01' }], voucherItems: [{ id: 'voucher', templateId: 'm', status: 'pending', amount: 100, dueDate: '2026-10-01', isTaxInvoice: false }] });
  expect(report.map(row => row.id).sort()).toEqual(['v', 'voucher']);
  expect(report.every(row => row.isTaxInvoice === false)).toBe(true);
});
