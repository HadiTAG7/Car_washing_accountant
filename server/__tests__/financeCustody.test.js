import { describe, expect, it } from 'vitest';
import { FieldValue } from 'firebase-admin/firestore';
import { financeWorkbench } from '../financeWorkbench.js';
import { reverseEntry } from '../../functions/src/ledger.js';
import { ADAPTERS } from '../../functions/src/posting.js';
import { calculatePayrollPreview } from '../../functions/src/payroll.js';
import { financeProblems } from '../../functions/src/financeReview.js';
import { cashRecoveryAmount, cashRecoveryDue, outstandingCustody } from '../../functions/src/custodyRecovery.js';
import { ADAPTERS as CLIENT } from '../../src/lib/accounting/sourceAdapters.js';
import { expensePatch, memoryFinanceDb } from './financeFixtures.js';

const auth = { uid: 'test-admin' };
const seed = () => ({
  'users/test-admin': { role: 'admin' }, 'variable_expense_categories/test-category': {},
  'app_settings/accounting': { value: { vatRegistered: false } },
  'chart_of_accounts/5100': {}, 'chart_of_accounts/1300': {}, 'chart_of_accounts/1010': {},
  'bikers/b1': { name: 'سالم', driver_external_id: 'D1', salary: 3000, start_date: '2026-01-01' },
  'bikers/b2': { name: 'ماجد', driver_external_id: 'D2' },
  'temporary_expenses/t1': { biker_id: 'b1', title: 'عهدة أولى', amount: 100, spent_date: '2026-10-01', status: 'pending', recovered_amount: 0, payment_method: 'cash' },
  'temporary_expenses/t2': { biker_id: 'b1', title: 'عهدة ثانية', amount: 50, spent_date: '2026-10-05', status: 'pending', recovered_amount: 0, payment_method: 'cash' },
  'temporary_expenses/t3': { biker_id: 'b1', title: 'مستردة', amount: 30, spent_date: '2026-09-01', status: 'recovered', recovered_date: '2026-09-30', recovered_amount: 30 },
  'temporary_expenses/t4': { biker_id: 'b2', title: 'عهدة ماجد', amount: 20, spent_date: '2026-10-02', status: 'pending', recovered_amount: 0, payment_method: 'cash' },
});
const wb = (db, request) => financeWorkbench(db, auth, request);
const custody = (overrides = {}) => expensePatch({ amount: 120, quantity: 1, paymentMethod: 'custody', paymentStatus: 'paid', paidDate: '2026-10-18',
  fundingType: 'custody', custodyBikerId: 'b1', fundingReference: 'إيصال سلّمه سالم', ...overrides });
async function capture(db, requestId, patch) {
  const preview = await wb(db, { action: 'previewCapture', kind: 'variable', requestId, patch });
  const saved = await wb(db, { action: 'capture', kind: 'variable', requestId, patch, previewHash: preview.previewHash, reason: 'اختبار العهدة', confirm: true });
  return saved.sourceId;
}
async function approveAndPost(db, sourceId) {
  let detail = await wb(db, { action: 'read', kind: 'variable', sourceId });
  expect(detail).toMatchObject({ issues: [], approvalReady: true });
  await wb(db, { action: 'approve', kind: 'variable', sourceId, sourceHash: detail.sourceHash, postingHash: detail.postingPreview.postingHash, reason: 'اعتماد', confirm: true });
  detail = await wb(db, { action: 'read', kind: 'variable', sourceId });
  const posted = await wb(db, { action: 'post', kind: 'variable', sourceId, sourceHash: detail.sourceHash, confirm: true });
  return db.rows.get(`journal_entries/${posted.verification.journalIds[0]}`);
}
const advance = (db, id) => ({ id, ...db.rows.get(`temporary_expenses/${id}`) });
const holders = async db => Object.fromEntries((await wb(db, { action: 'options', kind: 'variable' })).custodyHolders.map(h => [h.id, h.outstanding]));

describe('expenses paid from an employee’s custody', () => {
  it('lists every employee with his open custody, and names the holder from the registry', async () => {
    const db = memoryFinanceDb(seed());
    expect((await wb(db, { action: 'options', kind: 'variable' })).custodyHolders).toEqual([
      { id: 'b1', name: 'سالم', left: false, outstanding: 150 }, { id: 'b2', name: 'ماجد', left: false, outstanding: 20 }]);
    // «دفع موظف» needs the employee; the holder must exist and goes with a custody funding only.
    const unnamed = await wb(db, { action: 'previewCapture', kind: 'variable', requestId: 'u1', patch: custody({ fundingType: 'employee', custodyBikerId: null }) });
    expect(unnamed.issues).toContain('الموظف الذي دفع غير محدد.');
    await expect(wb(db, { action: 'previewCapture', kind: 'variable', requestId: 'u2', patch: custody({ custodyBikerId: 'nobody' }) })).rejects.toMatchObject({ code: 'not-found' });
    await expect(wb(db, { action: 'previewCapture', kind: 'variable', requestId: 'u3', patch: custody({ fundingType: 'company_cash', paymentMethod: 'cash' }) }))
      .rejects.toMatchObject({ code: 'invalid-argument' });
    const id = await capture(db, 'c1', custody({ custodian: 'اسم مكتوب يدويًا' }));
    expect(db.rows.get(`variable_expenses/${id}`).finance_metadata).toMatchObject({ fundingType: 'custody', custodyBikerId: 'b1', custodian: 'سالم' });
  });

  it('posts Dr expense / Cr 1300 and settles the oldest open custody first, so payroll deducts only the rest', async () => {
    const db = memoryFinanceDb(seed());
    const id = await capture(db, 'c2', custody());
    const entry = await approveAndPost(db, id);
    expect(entry.lines.map(l => [l.accountId, l.debit, l.credit])).toEqual([['5100', 120, 0], ['1300', 0, 120]]);
    expect(entry.custodyRecovery).toEqual({ bikerId: 'b1', amount: 120, excess: 0, allocations: [{ advanceId: 't1', amount: 100 }, { advanceId: 't2', amount: 20 }] });
    expect(advance(db, 't1')).toMatchObject({ status: 'recovered', recovered_amount: 100, recovered_date: '2026-10-18', recovery_method: 'expense_document',
      document_recoveries: [{ kind: 'variable', sourceId: id, entryId: entry.id ?? expect.any(String), amount: 100, date: '2026-10-18' }] });
    expect(advance(db, 't2')).toMatchObject({ status: 'pending', recovered_amount: 20 });
    expect(advance(db, 't3')).toMatchObject({ status: 'recovered', recovered_amount: 30 });
    expect(await holders(db)).toMatchObject({ b1: 30, b2: 20 });
    // Payroll deducts what is left (30), not the 150 handed out.
    const payroll = calculatePayrollPreview({ periodKey: '2026-10', bikers: [{ id: 'b1', name: 'سالم', salary: 3000, start_date: '2026-01-01' }],
      washes: [], advances: [advance(db, 't1'), advance(db, 't2'), advance(db, 't3')], automaticAdvanceDeduction: true });
    expect(payroll.lines.find(l => l.bikerId === 'b1').advanceDeduction).toBe(30);
    // No cash recovery for what a document settled; a cash return later posts only the remainder.
    expect(cashRecoveryDue(advance(db, 't1'))).toBe(false);
    expect(ADAPTERS.recovery.approved(advance(db, 't1'))).toBe(false);
    expect(CLIENT.recovery.isApproved(advance(db, 't1'))).toBe(false);
    const returned = { ...advance(db, 't2'), status: 'recovered', recovered_date: '2026-10-25', recovery_method: 'cash' };
    expect(outstandingCustody(returned)).toBe(0);
    expect(cashRecoveryAmount(returned)).toBe(30);
    expect(ADAPTERS.recovery.build(returned, 't2').lines.map(l => [l.accountId, l.debit, l.credit])).toEqual([['1010', 30, 0], ['1300', 0, 30]]);
    expect(CLIENT.recovery.build(returned).lines.map(l => [l.accountId, l.debit, l.credit])).toEqual([['1010', 30, 0], ['1300', 0, 30]]);
  });

  it('«دفع موظف» beyond his open custody: the excess stays owed to him and nothing more is deducted', async () => {
    const db = memoryFinanceDb(seed());
    const id = await capture(db, 'c3', custody({ amount: 50, fundingType: 'employee', custodyBikerId: 'b2', fundingReference: 'دفعه ماجد من جيبه' }));
    const entry = await approveAndPost(db, id);
    expect(entry.lines.map(l => [l.accountId, l.debit, l.credit])).toEqual([['5100', 50, 0], ['1300', 0, 50]]);
    expect(entry.custodyRecovery).toMatchObject({ bikerId: 'b2', amount: 50, excess: 30, allocations: [{ advanceId: 't4', amount: 20 }] });
    expect(advance(db, 't4')).toMatchObject({ status: 'recovered', recovered_amount: 20, recovery_method: 'expense_document' });
    expect(await holders(db)).toMatchObject({ b2: 0 });
  });

  it('a reversal reopens what the entry settled, unless the custody was since recovered another way', async () => {
    const db = memoryFinanceDb(seed());
    const id = await capture(db, 'c4', custody());
    const entry = await approveAndPost(db, id), entryId = [...db.rows].find(([, v]) => v === entry)[0].split('/')[1];
    // t2 returned in cash after the document: reversing would leave it inconsistent, so it is refused.
    db.rows.set('temporary_expenses/t2', { ...db.rows.get('temporary_expenses/t2'), status: 'recovered', recovered_date: '2026-10-25', recovery_method: 'cash' });
    await expect(reverseEntry(db, FieldValue, entryId, { entryDate: '2026-10-28', userId: 'test-admin' })).rejects.toThrow(/استُردت بعده/);
    db.rows.set('temporary_expenses/t2', { ...db.rows.get('temporary_expenses/t2'), status: 'pending', recovered_date: null, recovery_method: null });
    await reverseEntry(db, FieldValue, entryId, { entryDate: '2026-10-28', userId: 'test-admin' });
    expect(advance(db, 't1')).toMatchObject({ status: 'pending', recovered_amount: 0, recovered_date: null, recovery_method: null, document_recoveries: [] });
    expect(advance(db, 't2')).toMatchObject({ status: 'pending', recovered_amount: 0, document_recoveries: [] });
    expect(await holders(db)).toMatchObject({ b1: 150 });
    expect(financeProblems('variable', db.rows.get(`variable_expenses/${id}`), id)).toEqual([]);
  });
});
