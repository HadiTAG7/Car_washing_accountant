import { describe, expect, it } from 'vitest';
import { reconcilePartnerCapital, partnerPaymentDescription, paymentHref } from '../partnerCapitalReconciliation';
import { canonicalTabId, resolveTab, visibleGroupsFor, TAB_GROUPS } from '../navGroups';

describe('partner capital receipts versus posted capital', () => {
  const partners = [{ id: 'a', partnerName: 'الشريك', workersCount: 2 }];
  const receipt = { id: 'r', partnerId: 'a', amount: 20000, paymentDate: '2026-09-25', paymentMethod: 'bank_transfer' };
  it('shows missing source postings without assuming equal manual journals are receipts', () => {
    const entries = [{ id: 'manual', status: 'posted', sourceType: 'manual', sourceId: 'r' }];
    const lines = [{ entryId: 'manual', accountId: '3000-a', credit: 5000 }];
    const report = reconcilePartnerCapital(partners, [receipt], entries, lines);
    expect(report.rows[0]).toMatchObject({ required: 40000, recorded: 20000, posted: 5000, difference: 15000 });
    expect(report.rows[0].pending[0]).toMatchObject({ difference: 20000, reason: 'لا يوجد قيد مرتبط بسند القبض' });
  });
  it('nets reversed originals and their mirrors, including a replacement', () => {
    const entry = { id: 'old', status: 'reversed', sourceKind: 'partner_payment', sourceId: 'r' };
    const mirror = { id: 'mirror', status: 'posted', reversalOf: 'old' };
    const replacement = { id: 'new', status: 'posted', sourceKind: 'partner_payment', sourceId: 'r' };
    const lines = [{ entryId: 'old', accountId: '3000-a', credit: 20000 }, { entryId: 'mirror', accountId: '3000-a', debit: 20000 }];
    const reversed = reconcilePartnerCapital(partners, [receipt], [entry, mirror], lines).rows[0];
    expect(reversed.posted).toBe(0); expect(reversed.pending[0].reason).toBe('قيد السند معكوس');
    const replaced = reconcilePartnerCapital(partners, [receipt], [entry, mirror, replacement], [...lines, { entryId: 'new', accountId: '3000-a', credit: 20000 }]).rows[0];
    expect(replaced.difference).toBe(0); expect(replaced.pending).toEqual([]);
  });
  it('excludes drafts and exposes orphan receipts', () => {
    const report = reconcilePartnerCapital(partners, [receipt, { ...receipt, id: 'orphan', partnerId: 'missing' }],
      [{ id: 'draft', sourceType: 'partner_payment', sourceId: 'r', status: 'draft' }], [{ entryId: 'draft', accountId: '3000-a', credit: 20000 }]);
    expect(report.totals).toMatchObject({ recorded: 20000, posted: 0, difference: 20000 });
    expect(report.rows[0].pending[0].reason).toBe('قيد السند غير مرحّل'); expect(report.orphanPayments).toHaveLength(1);
  });
  it('changes only the display of dated opening balances and links the exact receipt', () => {
    const opening = Object.freeze({ ...receipt, paymentDate: '2026-07-03', notes: 'رصيد افتتاحي مُرحّل (تحويل تلقائي إلى سجل الدفعات)' });
    expect(partnerPaymentDescription(opening)).toBe('رصيد افتتاحي (التاريخ الفعلي غير مسجل)');
    expect(partnerPaymentDescription({ ...opening, paymentDate: '2026-07-04' })).toBe(opening.notes);
    expect(opening.notes).toContain('مُرحّل'); expect(paymentHref(receipt)).toContain('partnerId=a&paymentId=r#partner-payment-r');
  });
});

describe('separate partners section and legacy URLs', () => {
  it('puts its four pages directly after finance with no duplicate finance entries', () => {
    expect(TAB_GROUPS[2].title).toBe('الشركاء');
    expect(TAB_GROUPS[2].tabs.map(tab => tab.id)).toEqual(['partners_list', 'partner_payments', 'partner_capital', 'partner_accounts']);
    expect(TAB_GROUPS[1].tabs.some(tab => /partners|payments/.test(tab.id))).toBe(false);
    expect(canonicalTabId('partners')).toBe('partners_list'); expect(canonicalTabId('payments')).toBe('partner_payments');
    const admin = visibleGroupsFor({ role: 'admin' }).flatMap(g => g.tabs.map(t => t.id));
    expect(resolveTab('partners', { allowedTabIds: admin })).toBe('partners_list');
    expect(resolveTab('payments', { allowedTabIds: admin })).toBe('partner_payments');
  });
  it('does not give a partner or preview access to administrative pages through aliases', () => {
    const allowed = visibleGroupsFor({ role: 'partner', isPartnerView: true }).flatMap(g => g.tabs.map(t => t.id));
    for (const page of ['partners', 'payments', 'partner_capital', 'partner_accounts']) expect(resolveTab(page, { investorMode: true, allowedTabIds: allowed })).toBe('investor');
    expect(visibleGroupsFor({ role: 'accountant' }).flatMap(g => g.tabs.map(t => t.id))).not.toContain('partner_accounts');
  });
});
