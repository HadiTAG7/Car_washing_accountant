import { describe, expect, it, vi } from 'vitest';
import { financeWorkbench } from '../financeWorkbench';
import { financeReadSnapshot } from '../financeReadSnapshot';
import { expensePatch, memoryFinanceDb } from './financeFixtures';
import { approveFinanceSelection } from '../../src/lib/financeWorkbenchActions';
const auth = { uid: 'test-admin' };
const database = () => memoryFinanceDb({ 'users/test-admin': { role: 'admin' }, 'variable_expense_categories/test-category': { name: 'اختبار' }, 'app_settings/accounting': { value: { vatRegistered: false } }, 'chart_of_accounts/5100': {}, 'chart_of_accounts/2000': {} });
async function create(db, key, overrides = {}) {
  const request = { kind: 'variable', requestId: key, patch: expensePatch({ invoiceNumber: key, invoiceUrl: `https://example.org/${key}`, ...overrides }) };
  const preview = await financeWorkbench(db, auth, { action: 'previewCapture', ...request });
  return financeWorkbench(db, auth, { action: 'capture', ...request, previewHash: preview.previewHash, reason: 'مستند اختبار معزول', confirm: true });
}
describe('complete workbench browse and existing bulk approval', () => {
  it('keeps browse, read and preview aligned for a funded advance and nested over-allocation', async () => {
    const db = database();
    db.rows.set('chart_of_accounts/1300', {});
    db.rows.set('temporary_expenses/test-advance', { biker_id: 'test-worker', amount: 150, status: 'pending', recovered_amount: 0,
      custody_expense_used_halala: 0, custody_balance_opened_journal_id: 'test-funding' });
    db.rows.set('journal_entries/test-funding', { status: 'posted', sourceType: 'temporary_expense', sourceId: 'test-advance',
      entryDate: '2026-10-17', lines: [{ accountId: '1300', debit: 150, credit: 0 }, { accountId: '1010', debit: 0, credit: 150 }] });
    const linked = (amount, key) => ({ amount, quantity: 1, paymentStatus: 'paid', paymentMethod: 'card',
      paidDate: '2026-10-18', fundingType: 'employee', fundingReference: 'TEST receipt',
      employeeAdvanceLink: { version: 1, advanceId: 'test-advance', employeeId: 'test-worker',
        fundingJournalId: 'test-funding', allocatedAmount: amount }, invoiceNumber: key });
    const saved = [await create(db, 'ADVANCE-A', linked(100, 'A')), await create(db, 'ADVANCE-B', linked(50, 'B'))];
    const compare = async ledgerMatched => {
      const before = JSON.stringify([...db.rows]);
      const browse = await financeWorkbench(db, auth, { action: 'browse' });
      for (const item of saved) {
        const row = browse.items.find(candidate => candidate.sourceId === item.sourceId);
        const read = await financeWorkbench(db, auth, { action: 'read', kind: 'variable', sourceId: item.sourceId });
        const preview = await financeWorkbench(db, auth, { action: 'preview', kind: 'variable', sourceId: item.sourceId,
          sourceHash: read.sourceHash, patch: {} });
        expect(row).toMatchObject({ approvalReady: read.approvalReady, workflowStage: read.workflowStage,
          issueCount: read.issues.length, workflowDimensions: read.workflowDimensions });
        expect(preview.postingPreview.ready).toBe(ledgerMatched);
        expect(preview.issues).toEqual(read.postingPreview.issues);
        expect(read.approvalReady).toBe(ledgerMatched);
        expect(read.workflowDimensions.funding.ledgerMatched).toBe(ledgerMatched);
      }
      expect(JSON.stringify([...db.rows])).toBe(before);
    };
    await compare(true);
    const snapshot = await financeReadSnapshot(db, ['variable_expenses']);
    expect((await snapshot.collection('variable_expenses').where('finance_metadata.employeeAdvanceLink.advanceId', '==', 'test-advance').get()).size).toBe(2);
    saved.push(await create(db, 'ADVANCE-C', linked(0.01, 'C')));
    await compare(false);
  });
  it('reads more than 30, classifies readiness from the existing server checks and changes nothing', async () => {
    const db = database();
    for (let i = 0; i < 36; i++) db.rows.set(`variable_expenses/incomplete-${i}`, { expense_name: `تحويل ${i}`, total_variable_cost: i + 1, logged_date: '2026-05-01', payment_method: 'cash' });
    await create(db, 'READY');
    const before = JSON.stringify([...db.rows]);
    const result = await financeWorkbench(db, auth, { action: 'browse' });
    expect(result.complete).toBe(true); expect(result.items).toHaveLength(37);
    expect(result.items.filter(item => item.workflowStage === 'ready')).toHaveLength(1);
    expect(result.items.filter(item => item.paymentConflict)).toHaveLength(36);
    expect(JSON.stringify([...db.rows])).toBe(before);
    await db.collection('variable_expense_categories').doc('test-category').update({ name: 'اسم آخر' });
    db.rows.delete('variable_expense_categories/test-category');
    expect((await financeWorkbench(db, auth, { action: 'browse' })).items.filter(item => item.workflowStage === 'ready')).toHaveLength(0);
  });
  it('reports valid approval and posted payment separately; reversed sources never become complete or selectable', async () => {
    const db = database(), saved = await create(db, 'STAGES');
    const ready = (await financeWorkbench(db, auth, { action: 'browse' })).items[0];
    await financeWorkbench(db, auth, { action: 'approve', kind: ready.kind, sourceId: ready.sourceId, sourceHash: ready.sourceHash, postingHash: ready.postingHash, reason: 'اختبار الاعتماد', confirm: true });
    expect((await financeWorkbench(db, auth, { action: 'browse' })).items[0].workflowStage).toBe('approved');
    db.rows.set('journal_entries/J', { sourceKind: 'variable', sourceId: saved.sourceId, status: 'posted' });
    expect((await financeWorkbench(db, auth, { action: 'browse' })).items[0]).toMatchObject({ workflowStage: 'posted_unproven', approvalReady: false });
    const row = db.rows.get(`variable_expenses/${saved.sourceId}`);
    Object.assign(row, { payment_status: 'paid', payment_method: 'transfer', paid_date: '2026-10-18', finance_metadata: { ...row.finance_metadata, fundingType: 'company_bank' } });
    expect((await financeWorkbench(db, auth, { action: 'browse' })).items[0].workflowStage).toBe('complete');
    db.rows.get('journal_entries/J').status = 'reversed';
    expect((await financeWorkbench(db, auth, { action: 'browse' })).items[0]).toMatchObject({ workflowStage: 'incomplete', approvalReady: false });
  });
  it('bulk approval uses single-document server approval and verifies every result without posting or changing payment', async () => {
    const db = database(); await create(db, 'A'); await create(db, 'B');
    const items = (await financeWorkbench(db, auth, { action: 'browse' })).items;
    const call = vi.fn((_endpoint, request) => financeWorkbench(db, auth, request));
    const result = await approveFinanceSelection({ items, reason: 'مطابقة مستندات الاختبار', confirmed: true, call });
    expect(result.verified).toHaveLength(2); expect(result.uncertain).toHaveLength(0);
    expect(call.mock.calls.filter(([, r]) => r.action === 'approve')).toHaveLength(2);
    expect(call.mock.calls.every(([, r]) => ['approve', 'read'].includes(r.action))).toBe(true);
    expect([...db.rows.keys()].some(key => key.startsWith('journal_entries/'))).toBe(false);
    expect([...db.rows].filter(([key]) => key.startsWith('variable_expenses/')).every(([, row]) => row.payment_status === 'unpaid')).toBe(true);
    expect((await financeWorkbench(db, auth, { action: 'browse' })).items.every(item => item.workflowStage === 'approved')).toBe(true);
  });
  it('skips stale/closed sources and stops after an ambiguous approval without retrying or touching later sources', async () => {
    const db = database(); await create(db, 'A'); await create(db, 'B'); await create(db, 'C');
    const items = (await financeWorkbench(db, auth, { action: 'browse' })).items;
    db.rows.get(`variable_expenses/${items[0].sourceId}`).supplier = 'تغير متزامن';
    const call = vi.fn(async (_endpoint, request) => {
      const result = await financeWorkbench(db, auth, request);
      if (request.action === 'approve') throw new Error('فقد الاتصال بعد وصول الاعتماد');
      return result;
    });
    const result = await approveFinanceSelection({ items, reason: 'اختبار الغموض', confirmed: true, call });
    expect(result.skipped).toHaveLength(1); expect(result.uncertain).toHaveLength(1); expect(result.unattempted).toHaveLength(1);
    expect(call.mock.calls.filter(([, r]) => r.action === 'approve')).toHaveLength(1);
    expect(db.rows.get(`variable_expenses/${items[2].sourceId}`).approval_status).not.toBe('approved');
    db.rows.set('accounting_periods/2026-10', { status: 'closed' });
    expect((await financeWorkbench(db, auth, { action: 'browse' })).items.every(item => !item.approvalReady)).toBe(true);
  });
  it('rejects missing confirmation, ineligible or duplicate selections before any read/write', async () => {
    const item = { kind: 'variable', sourceId: 'A', approvalReady: true, workflowStage: 'ready' }, call = vi.fn();
    for (const args of [{ items: [item], confirmed: false }, { items: [{ ...item, approvalReady: false }], confirmed: true }, { items: [item, item], confirmed: true }]) {
      await expect(approveFinanceSelection({ ...args, reason: 'مراجعة اختبار', call })).rejects.toThrow();
    }
    expect(call).not.toHaveBeenCalled();
  });
  it.each(['partner', 'accountant', 'operator'])('denies %s the all-document read', async role => {
    const db = database(); db.rows.get('users/test-admin').role = role;
    await expect(financeWorkbench(db, auth, { action: 'browse' })).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it('fetches each collection once, exposes no writes, and fails closed when a source cannot be read', async () => {
    const db = database(), original = db.collection, calls = [];
    db.collection = name => { calls.push(name); return original(name); };
    const snapshot = await financeReadSnapshot(db, ['variable_expenses', 'variable_expenses', 'journal_entries']);
    expect(calls).toEqual(['variable_expenses', 'journal_entries']);
    expect(snapshot.collection('variable_expenses').set).toBeUndefined();
    expect(() => snapshot.collection('users')).toThrow(); expect(() => snapshot.collection('journal_entries').doc()).toThrow();
    expect(() => snapshot.collection('journal_entries').where('status', '!=', 'posted')).toThrow();
    await expect(financeReadSnapshot({ collection: () => ({ get: async () => { throw new Error('انقطاع'); } }) }, ['variable_expenses'])).rejects.toThrow('انقطاع');
  });
});
