import { monthlyStatement } from './monthlyStatement.js';
import { sourceKindOf } from './reports.js';
import { splitVatBalanced } from './vat.js';
import { resolvePurchaseTax } from './purchaseTax.js';
import { expenseAccountFor } from './postingRules.js';
import { mapWash } from '../mappers.js';
import { ownerWashTaxSplit } from '../sweater/ownerWashTax.js';
import { isRealCalendarDate } from '../vatFields.js';

const round2 = n => Math.round(n * 100) / 100;
const recognized = e => ['posted', 'reversed'].includes(e.status) && !e.reversalOf;
const key = (kind, id) => `${kind}:${id}`;

// One source contributes through its recorded journal OR its operational
// record. No synthetic journal, cash movement or posting is constructed.
export function liveIncomeStatement({ accounts = [], entries = [], lines = [], periodKey, feeRules, scalingFactor = 1,
  sources = {}, policyAt = () => ({ known: true, vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15 }) } = {}) {
  const posted = new Map(entries.filter(recognized).map(e => [key(sourceKindOf(e), e.sourceId), e]));
  const postedSsp = new Set();
  for (const settlement of sources.settlements || []) {
    if (posted.has(key('sweater_settlement', settlement.id))) {
      for (const row of settlement.figures?.lines?.eligible || []) postedSsp.add(row.sspBookingId);
    }
  }
  for (const booking of sources.bookings || []) if (booking.postedEntryId || booking.processingStatus === 'posted') postedSsp.add(booking.sspBookingId);
  const rawWashes = sources.washes || [];
  // If any duplicate local wash has already posted, its shared SSP execution
  // cannot reappear as a second unposted wash under another document id.
  for (const raw of rawWashes) if (raw.ssp_booking_id && posted.has(key('wash', raw.id))) postedSsp.add(raw.ssp_booking_id);
  const seenWashes = new Set(); const seenExpenses = new Set(); const operationalItems = []; const issues = [];
  for (const raw of rawWashes) {
    const w = mapWash(raw); const identity = w.sspBookingId || w.id;
    if (w.status !== 'مكتملة' || w.washDate.slice(0, 7) !== periodKey || seenWashes.has(identity)) continue;
    seenWashes.add(identity);
    if (posted.has(key('wash', w.id)) || postedSsp.has(w.sspBookingId)) continue;
    let split = ownerWashTaxSplit(w);
    if (!split) {
      if (w.revenueOrigin === 'sweater' && w.collectionStatus === 'confirmed_by_owner') { issues.push({ sourceId: w.id, reason: 'missing_owner_tax_split' }); continue; }
      const policy = policyAt(w.washDate);
      if (policy.known === false) { issues.push({ sourceId: w.id, reason: 'unknown_tax_policy' }); continue; }
      split = splitVatBalanced(w.quantity * w.price, { mode: w.priceMode || policy.washPriceMode, taxable: policy.vatRegistered, rate: policy.vatRate });
    }
    operationalItems.push({ sourceKind: 'wash', sourceId: w.id, sspBookingId: w.sspBookingId,
      accountCode: '4000', date: w.washDate, amount: split.net, vat: split.vat, gross: split.gross, description: w.bikerName });
  }
  const addExpense = (kind, row, amount, date, camel = false) => {
    const identity = key(kind, row.id);
    if (!isRealCalendarDate(date) || date.slice(0, 7) !== periodKey || amount <= 0 || seenExpenses.has(identity)
      || posted.has(identity) || posted.has(key('expense', row.id))) return;
    seenExpenses.add(identity);
    const accountCode = expenseAccountFor(kind === 'voucher' ? 'monthly' : kind);
    if (accounts.find(a => String(a.code) === accountCode)?.accountType !== 'expense') return;
    const field = (snake, camelName) => row[camel ? camelName : snake];
    try {
      const tax = resolvePurchaseTax({ amount, recordDate: date, priceMode: field('price_mode', 'priceMode') || 'inclusive',
        isTaxInvoice: field('is_tax_invoice', 'isTaxInvoice') === true, vatDeductible: field('vat_deductible', 'vatDeductible') !== false,
        invoiceNumber: field('invoice_number', 'invoiceNumber'), invoiceDate: field('invoice_date', 'invoiceDate'), supplier: row.supplier,
        vatAmount: field('vat_amount', 'vatAmount') ?? null, vatRate: field('vat_rate', 'vatRate') ?? null }, { policyAt });
      operationalItems.push({ sourceKind: kind, sourceId: row.id, accountCode, date, amount: tax.net,
        documentNumber: field('invoice_number', 'invoiceNumber'), invoiceDate: field('invoice_date', 'invoiceDate'),
        supplier: row.supplier, taxSnapshot: tax.snapshot,
        description: row.expense_name || row.description || row.templateName || '' });
    } catch { issues.push({ sourceId: row.id, reason: 'unresolved_purchase_tax' }); }
  };
  const dateOf = row => isRealCalendarDate(row.invoice_date) ? row.invoice_date : row.logged_date || row.spent_date;
  for (const row of sources.variables || []) addExpense('variable', row, Number(row.total_variable_cost) || 0, dateOf(row));
  // Recurring templates and annual budgets are plans. Only their dated
  // vouchers/spend entries are expenses; startup/fixed assets/advances and
  // partner capital never enter this operational P&L.
  for (const row of sources.monthlies || []) if (row.recurrence === 'one_time') addExpense('monthly', row, Number(row.total_monthly_cost) || 0, dateOf(row));
  for (const row of sources.annualEntries || []) addExpense('annual', row, Number(row.amount) || 0, dateOf(row));
  for (const row of sources.vouchers || []) if (row.status !== 'cancelled') addExpense('voucher', row, Number(row.amount) || 0,
    isRealCalendarDate(row.invoiceDate) ? row.invoiceDate : row.dueDate, true);
  const statement = monthlyStatement({ accounts, entries, lines, periodKey, feeRules, scalingFactor, operationalItems, includeExpenseBreakdown: true });
  const ledger = monthlyStatement({ accounts, entries, lines, periodKey, feeRules, scalingFactor });
  return { ...statement, basis: 'ledger_and_registered_operations', ledgerNetRevenue: ledger.netRevenue,
    unpostedNetRevenue: round2(operationalItems.filter(row => row.accountCode === '4000').reduce((sum, row) => sum + row.amount, 0) * scalingFactor), issues };
}
