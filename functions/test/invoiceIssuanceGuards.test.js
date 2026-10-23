import { describe, it, expect } from 'vitest';
import { memoryFinanceDb } from '../../server/__tests__/financeFixtures.js';
import { issueDocument } from '../src/invoicing.js';
import { sellerIssuanceProblems, invoiceCustomerProblems, isSweaterBuyer } from '../src/invoiceReadiness.js';

const seller = { name: 'منشأة اختبار', address: 'عنوان اصطناعي', vatNumber: '300000000000003', vatRegistered: true };
const buyer = { name: 'عميل اختبار', address: 'عنوان عميل', vatNumber: '311111111111113' };
const policy = { value: { taxPolicyHistory: [{ effectiveFrom: '2026-01-01', vatRegistered: true, vatRate: 0.15, washPriceMode: 'exclusive' }] } };
const FV = { serverTimestamp: () => 'synthetic-clock' };
const sale = { type: 'invoice', invoiceKind: 'standard', issueDate: '2026-10-31', customer: buyer,
  paymentMethod: 'transfer', paymentStatus: 'unpaid', priceMode: 'exclusive', lines: [{ description: 'خدمة اختبار', quantity: 1, unitPrice: 20 }] };
function database(overrides = {}) {
  return memoryFinanceDb({ 'app_settings/company': { value: seller }, 'app_settings/accounting': policy,
    ...Object.fromEntries(['1010', '1020', '1100', '1101', '4000', '4001', '2100'].map(code => [`chart_of_accounts/${code}`, { code }])), ...overrides });
}
function settlementDb(overrides = {}) {
  return database({
    'sweater_settlements/2026-10': { status: 'approved', journalEntryId: 'approved-entry', figures: { services: { net: 40, vat: 6, gross: 46 } } },
    'posting_locks/sweater_settlement__2026-10': { entryId: 'approved-entry' },
    'journal_entries/approved-entry': { entryDate: '2026-10-31', status: 'posted', entryNumber: 9, sourceType: 'sweater_settlement', sourceId: '2026-10',
      lines: [{ accountId: '1101', debit: 46, credit: 0 }, { accountId: '4001', debit: 0, credit: 40 }, { accountId: '2100', debit: 0, credit: 6 }] }, ...overrides,
  });
}
const issue = (db, input = sale) => issueDocument(db, FV, input, { userId: 'test-user' });
const monthly = { type: 'invoice', settlementPeriodKey: '2026-10', issueDate: '2026-10-31', customer: buyer };

describe('tax-document issuance guards — isolated memory only', () => {
  it.each(['name', 'address', 'vatNumber'])('missing seller %s refuses before counters or entries change', async key => {
    const db = database({ 'app_settings/company': { value: { ...seller, [key]: '' } } });
    const before = [...db.rows];
    await expect(issue(db)).rejects.toThrow(); expect([...db.rows]).toEqual(before);
  });
  it('blocks a registration conflict and unknown dated policy, including forged ready seller input', async () => {
    for (const db of [database({ 'app_settings/company': { value: { ...seller, vatRegistered: false } } }), database({ 'app_settings/accounting': {} })]) {
      const before = [...db.rows]; await expect(issue(db, { ...sale, seller })).rejects.toThrow(); expect([...db.rows]).toEqual(before);
    }
    expect(sellerIssuanceProblems(seller, { known: true, vatRegistered: true }, { pending: true })).not.toEqual([]);
  });
  it.each(['name', 'address', 'vatNumber'])('standard requires buyer %s server-side', async key => {
    const db = database(); await expect(issue(db, { ...sale, customer: { ...buyer, [key]: '' } })).rejects.toThrow(/عميل/);
    expect([...db.rows.keys()].some(k => k.startsWith('sales_documents/'))).toBe(false);
  });
  it('requires an explicit payment method and debits 1100 for uncollected invoices, not 1010/1020', async () => {
    const db = database(); await expect(issue(db, { ...sale, paymentMethod: '' })).rejects.toThrow(/طريقة السداد/);
    for (const paymentMethod of ['cash', 'card', 'transfer', 'credit']) {
      const res = await issue(db, { ...sale, paymentMethod }); const entry = db.rows.get(`journal_entries/${res.journalEntryId}`);
      expect(entry.lines.find(l => l.debit > 0)).toMatchObject({ accountId: '1100', debit: 23 });
      expect(entry.lines.some(l => ['1010', '1020'].includes(l.accountId))).toBe(false);
    }
  });
  it('stores full business buyer details and generates a simplified QR', async () => {
    const db = database(); const standard = await issue(db);
    expect(db.rows.get(`sales_documents/${standard.id}`).customer).toEqual(buyer);
    const simplified = await issue(db, { ...sale, invoiceKind: 'simplified', customer: null });
    expect(db.rows.get(`sales_documents/${simplified.id}`)).toMatchObject({ invoiceKind: 'simplified', paymentStatus: 'unpaid' });
    expect(simplified.qrPayload).toBeTruthy(); expect(invoiceCustomerProblems('standard', {})).toHaveLength(3);
  });
  it.each(['سويتر', 'شركة اللمسة العصرية التقنية', 'اللمسة العصرية', 'Sweater', 'شركه اللمسه العصريه التقنيه'])('rejects standalone Sweater buyer %s with no source metadata', async name => {
    const db = database(); expect(isSweaterBuyer({ name })).toBe(true);
    await expect(issue(db, { ...sale, customer: { ...buyer, name } })).rejects.toThrow(/تسويات سويتر/);
    expect([...db.rows.keys()].some(k => k.startsWith('sales_documents/'))).toBe(false);
  });
  it('monthly invoice uses approved posted amounts, ignores forged lines, creates no second journal, and claims the month once', async () => {
    const db = settlementDb(); const beforeEntries = [...db.rows].filter(([k]) => k.startsWith('journal_entries/'));
    const result = await issue(db, { ...monthly, lines: [{ description: 'forged', quantity: 1, unitPrice: 99999 }], invoiceKind: 'simplified', gross: 99999 });
    expect(result).toMatchObject({ net: 40, vat: 6, gross: 46, journalEntryId: null, linkedJournalEntryId: 'approved-entry', supplyDate: '2026-10-31' });
    expect([...db.rows].filter(([k]) => k.startsWith('journal_entries/'))).toEqual(beforeEntries);
    expect(db.rows.get(`sales_documents/${result.id}`)).toMatchObject({ invoiceKind: 'standard', settlementPeriodKey: '2026-10', paymentStatus: 'unpaid',
      customer: { name: 'شركة اللمسة العصرية التقنية', address: buyer.address, vatNumber: buyer.vatNumber } });
    expect(db.rows.get('sweater_settlements/2026-10')).toMatchObject({ status: 'invoiced', invoiceGross: 46 });
    await expect(issue(db, monthly)).rejects.toThrow(/سبق إصدار/);
  });
  it('refuses unapproved, altered figures, wrong source, reversed entry, early issue, or incomplete buyer without consuming a number', async () => {
    for (const [db, input] of [
      [settlementDb({ 'sweater_settlements/2026-10': { status: 'calculated' } }), monthly],
      [settlementDb({ 'sweater_settlements/2026-10': { status: 'approved', journalEntryId: 'approved-entry', figures: { services: { net: 99, vat: 6, gross: 105 } } } }), monthly],
      [settlementDb({ 'journal_entries/approved-entry': { status: 'reversed' } }), monthly],
      [settlementDb({ 'posting_locks/sweater_settlement__2026-10': { entryId: 'wrong' } }), monthly],
      [settlementDb(), { ...monthly, issueDate: '2026-10-23' }],
      [settlementDb(), { ...monthly, customer: {} }],
    ]) {
      const before = [...db.rows]; await expect(issue(db, input)).rejects.toThrow(); expect([...db.rows]).toEqual(before);
    }
  });
});
