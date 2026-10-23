import { describe, expect, it } from 'vitest';
import { balanceNature, ledgerAccountGroups, ledgerMovementContext, ledgerSourceIdentity, ledgerSourcePlan, matchesLedgerMovement, safeDocumentUrl } from '../ledgerPresentation';

describe('read-only ledger presentation', () => {
  it('marks opposite-side balances abnormal, including credit-normal and contra accounts', () => {
    for (const normalBalance of ['debit', 'credit']) {
      expect(balanceNature(-12, { normalBalance })).toEqual({ abnormal: true, label: 'رصيد غير طبيعي' });
      expect(balanceNature(12, { normalBalance }).abnormal).toBe(false);
    }
    expect(balanceNature(0, {}).label).toBe('رصيد صفري');
  });
  it('groups by account type with all unused accounts at the end', () => {
    const accounts = [{ code: '1', accountType: 'asset' }, { code: '2', accountType: 'asset' }, { code: '3', accountType: 'equity' }];
    expect(ledgerAccountGroups(accounts, new Set(['1', '3'])).map((g) => g.accounts[0].code)).toEqual(['1', '3', '2']);
  });
  it('follows explicit original links, bounds cycles and reads frozen supplier/invoice first', () => {
    const entryIndex = new Map([
      ['old', { id: 'old', sourceKind: 'startup', sourceId: 'invoice', purchaseTaxSnapshot: { supplier: 'المورد التاريخي', invoiceNumber: 'INV-4' } }],
      ['reverse', { id: 'reverse', sourceType: 'adjustment', reversalOf: 'old', reversalReason: 'تصحيح وسيلة الدفع' }],
      ['cycle', { id: 'cycle', reversalOf: 'cycle' }],
    ]);
    expect(ledgerSourceIdentity(entryIndex.get('reverse'), entryIndex)).toEqual({ kind: 'startup', id: 'invoice' });
    expect(ledgerSourceIdentity(entryIndex.get('cycle'), entryIndex)).toBeNull();
    const documents = new Map([['startup_cost_entries/invoice', { description: 'شراء جوالات', supplier: 'اسم تغيّر', invoice_url: 'https://example.com/invoice' }]]);
    const context = ledgerMovementContext({ entryId: 'old', description: 'سداد' }, entryIndex, documents);
    expect(context).toMatchObject({ description: 'شراء جوالات', supplier: 'المورد التاريخي', documentNumber: 'INV-4' });
    expect(ledgerMovementContext({ entryId: 'reverse' }, entryIndex, documents)).toMatchObject({ originalId: 'old', reason: 'تصحيح وسيلة الدفع' });
    expect(safeDocumentUrl('javascript:alert(1)')).toBeNull();
  });
  it('deduplicates and bounds source reads to ten IDs per query', () => {
    const entries = Array.from({ length: 23 }, (_, i) => ({ id: `${i}`, sourceKind: 'variable', sourceId: `doc${i}` }));
    const plan = ledgerSourcePlan([...entries, entries[0]], new Map());
    expect(plan.map((p) => p.ids.length)).toEqual([10, 10, 3]);
  });
  it('searches Arabic/English amounts, supplier, description and invoice without changing rows or balances', () => {
    const row = Object.freeze({ debit: 0, credit: 1234.5, balance: -1234.5, sourceType: 'expense', description: 'سداد', entryNumber: 12 });
    const context = { description: 'شراء جوالات', supplier: 'متجر النور', documentNumber: 'INV-12' };
    for (const query of ['1,234.50', '١٬٢٣٤٫٥٠', 'متجر', 'جوالات', 'INV-12']) expect(matchesLedgerMovement(row, context, query, 'expense')).toBe(true);
    expect(matchesLedgerMovement(row, context, '', 'manual')).toBe(false);
    expect(row.balance).toBe(-1234.5);
  });
});
