import { expect, it } from 'vitest';
import { balanceUnposted } from '../balanceUnposted';
const statement = { details: { netRevenue: { items: [{ status: 'unposted', amount: 20, source: { tax: { vat: 3 } } }] } },
  salaryAccrual: { unposted: 100, estimated: true }, issues: [] };
it('reads unposted net revenue/VAT and distinguishes approved documents from missing ones', () => {
  const r = balanceUnposted({ statement, asOf: '2026-10-23', entries: [{ id: 'e', entryDate: '2026-10-01', status: 'posted', sourceKind: 'variable', sourceId: 'posted' }],
    workbench: { complete: true, items: [
      { kind: 'variable', sourceId: 'posted', amount: 999, date: '2026-10-01', workflowStage: 'complete' },
      { kind: 'variable', sourceId: 'approved', amount: 80, date: '2026-10-01', workflowStage: 'approved' },
      { kind: 'variable', sourceId: 'missing', amount: 50, date: '2026-10-01', workflowStage: 'incomplete' },
      { kind: 'startup', sourceId: 'reversed', amount: 900, date: '2026-10-01', workflowStage: 'incomplete', workflowNote: 'له قيد معكوس' },
      { kind: 'variable', sourceId: 'future', amount: 70, date: '2026-11-01', workflowStage: 'approved' },
    ] } });
  expect(r).toMatchObject({ payroll: 100, revenue: 20, vat: 3, documents: { count: 2, amount: 130, approvedCount: 1, approvedAmount: 80 } });
});
it('missing VAT or document reads do not become zero', () => {
  const r = balanceUnposted({ statement: { ...statement, details: { netRevenue: { items: [{ status: 'unposted', amount: 20, source: {} }] } } }, entries: [], asOf: '2026-10-23' });
  expect(r.vat).toBeNull(); expect(r.documents).toBeNull();
});
