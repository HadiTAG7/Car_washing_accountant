import { describe, expect, it } from 'vitest';
import { financeWorkbench } from '../financeWorkbench.js';
import { postSource, reverseEntry } from '../../functions/src/ledger.js';
import { FieldValue } from 'firebase-admin/firestore';
import { calculatePayrollPreview } from '../../functions/src/payroll.js';
import { assertFinanceApproval, financeProblems, financeReviewId, financeSourceHash } from '../../functions/src/financeReview.js';
import { expensePatch, memoryFinanceDb } from './financeFixtures';

const auth = { uid: 'test-admin' };
function database() { return memoryFinanceDb({ 'users/test-admin': { role: 'admin' }, 'variable_expense_categories/test-category': { name: 'اختبار' },
  'app_settings/accounting': { value: { vatRegistered: false } }, 'chart_of_accounts/5100': {},
  'chart_of_accounts/2000': {}, 'chart_of_accounts/1010': {}, 'chart_of_accounts/1020': {} }); }
async function capture(db, overrides = {}) {
  const patch = expensePatch(overrides), request = { kind: 'variable', requestId: 'TEST-REQUEST', patch };
  const preview = await financeWorkbench(db, auth, { action: 'previewCapture', ...request });
  const result = await financeWorkbench(db, auth, { action: 'capture', ...request, previewHash: preview.previewHash, reason: 'مستند اختبار معزول', confirm: true });
  return { request, preview, result, read: await financeWorkbench(db, auth, { action: 'read', kind: 'variable', sourceId: result.sourceId }) };
}
function seedAdvance(db, amount = 150) {
  db.rows.set('chart_of_accounts/1300', {});
  db.rows.set('temporary_expenses/test-advance', { biker_id: 'test-employee', amount, status: 'pending', recovered_amount: 0,
    custody_expense_used_halala: 0, custody_balance_opened_journal_id: 'test-funding' });
  db.rows.set('journal_entries/test-funding', { status: 'posted', sourceType: 'temporary_expense', sourceId: 'test-advance',
    entryDate: '2026-10-17', lines: [{ accountId: '1300', debit: amount, credit: 0 },
      { accountId: '1010', debit: 0, credit: amount }] });
}
function employeeRequest(requestId, amount, kind = 'variable') {
  return { kind, requestId, patch: expensePatch({ amount, quantity: 1,
    invoiceNumber: `TEST-${requestId}`, invoiceUrl: `https://example.org/${requestId}`,
    paymentStatus: 'paid', paymentMethod: 'card', paidDate: '2026-10-18',
    fundingType: 'employee', fundingReference: 'TEST supplier receipt',
    employeeAdvanceLink: { version: 1, advanceId: 'test-advance', employeeId: 'test-employee',
      fundingJournalId: 'test-funding', allocatedAmount: amount } }) };
}
describe('finance workbench version-bound review', () => {
  it('previews historical custody without treating a current correction as earlier funding', async () => {
    const db = database();
    db.rows.set('temporary_expenses/old-custody', { biker_id: 'test-employee', amount: 150,
      status: 'pending', recovered_amount: 0 });
    db.rows.set('chart_of_accounts/1300', { active: true });
    db.rows.set('chart_of_accounts/1020', { active: true });
    db.rows.set('variable_expenses/old-invoice', { amount: 100, payment_status: 'paid', paid_date: '2026-10-18',
      finance_metadata: { fundingType: 'employee' } });
    const input = { action: 'preview', kind: 'custody_reconciliation', advanceId: 'old-custody',
      employeeId: 'test-employee', amount: 150, historicalFundingDate: null, correctionDate: '2026-10-29',
      ownerStatementRef: 'TEST owner statement', evidenceRefs: [],
      allocations: [{ kind: 'variable', sourceId: 'old-invoice', amount: 100 }] };
    const before = [...db.rows.entries()];
    const preview = await financeWorkbench(db, auth, input);
    expect(preview).toMatchObject({ financialPosting: false, readyForPosting: false,
      proposedCorrection: { entryDate: '2026-10-29', historicalFundingDate: null,
        entryDateIsHistoricalFundingDate: false }, ownerAttestation: { establishesHistoricalLedgerProof: false },
      allocatedHalala: 10000, remainingHalala: 5000 });
    expect(preview.issues.join(' ')).toMatch(/تاريخ تسليم التمويل.*غير مثبت/);
    expect(db.rows).toEqual(new Map(before));
    const afterInvoice = await financeWorkbench(db, auth, { ...input, historicalFundingDate: '2026-10-20',
      evidenceRefs: ['TEST archived transfer'] });
    expect(afterInvoice.issues.join(' ')).toMatch(/بعد دفع مستند/);
    expect(afterInvoice.issues.join(' ')).toMatch(/لا يوجد قيد تمويل تاريخي/);
    expect(afterInvoice.readyForPosting).toBe(false);
    const beforeInvoice = await financeWorkbench(db, auth, { ...input, historicalFundingDate: '2026-10-17',
      evidenceRefs: ['TEST archived transfer'] });
    expect(beforeInvoice.issues.join(' ')).toMatch(/لا يوجد قيد تمويل تاريخي/);
    expect(beforeInvoice.issues.join(' ')).not.toMatch(/بعد دفع مستند/);
    expect(beforeInvoice.readyForPosting).toBe(false);
    expect(db.rows).toEqual(new Map(before));
  });
  it('refuses a legacy advance without a verified opening balance even when a funding journal exists', async () => {
    const db = database();
    seedAdvance(db);
    const row = db.rows.get('temporary_expenses/test-advance');
    db.rows.set('temporary_expenses/test-advance', { biker_id: row.biker_id, amount: row.amount,
      status: row.status, recovered_amount: row.recovered_amount });
    const preview = await financeWorkbench(db, auth, { action: 'previewCapture', ...employeeRequest('LEGACY-ADVANCE', 100) });
    expect(preview.postingPreview.ready).toBe(false);
    expect(preview.issues.join(' ')).toMatch(/العهدة القديمة لم تُطابق/);
    db.rows.set('temporary_expenses/test-advance', { ...db.rows.get('temporary_expenses/test-advance'),
      custody_expense_used_halala: 0, custody_balance_opened_journal_id: 'another-funding' });
    const mismatched = await financeWorkbench(db, auth, { action: 'previewCapture', ...employeeRequest('MISMATCHED-OPENING', 100) });
    expect(mismatched.postingPreview.ready).toBe(false);
    expect(mismatched.issues.join(' ')).toMatch(/العهدة القديمة لم تُطابق/);
  });
  it('separates owner statement from a matched and allocated 1300 posting preview', async () => {
    const db = database();
    seedAdvance(db);
    const ownerOnly = await capture(db, { paymentStatus: 'paid', paymentMethod: 'card', paidDate: '2026-10-18',
      fundingType: 'employee', fundingReference: 'TEST supplier receipt', ownerStatementRef: 'TEST owner statement' });
    expect(ownerOnly.read.approvalReady).toBe(false);
    expect(ownerOnly.read.paymentProven).toBe(false);
    expect(ownerOnly.read.workflowDimensions.funding).toMatchObject({ ownerStatementRef: 'TEST owner statement', ledgerMatched: false });
    const common = { kind: 'variable', sourceId: ownerOnly.result.sourceId, sourceHash: ownerOnly.read.sourceHash };
    const patch = { employeeAdvanceLink: { version: 1, advanceId: 'test-advance', employeeId: 'test-employee',
      fundingJournalId: 'test-funding', allocatedAmount: 100 } };
    const preview = await financeWorkbench(db, auth, { action: 'preview', ...common, patch });
    expect(preview.postingPreview.ready).toBe(true);
    expect(preview.postingPreview.lines).toContainEqual(expect.objectContaining({ accountId: '1300', credit: 100 }));
    expect(preview.postingPreview.lines.some(line => line.accountId === '1010' || line.accountId === '1020')).toBe(false);
    const saved = await financeWorkbench(db, auth, { action: 'save', ...common, patch, previewHash: preview.previewHash,
      reason: 'TEST advance linkage', confirm: true });
    const read = await financeWorkbench(db, auth, { action: 'read', kind: 'variable', sourceId: saved.sourceId });
    expect(read.approvalReady).toBe(true);
    expect(read.paymentProven).toBe(true);
    expect(read.workflowDimensions.funding.ledgerMatched).toBe(true);
    await expect(financeWorkbench(db, auth, { action: 'approve', kind: 'variable', sourceId: saved.sourceId,
      sourceHash: read.sourceHash, postingHash: 'a'.repeat(64), reason: 'TEST stale posting hash', confirm: true })).rejects.toThrow();
    expect([...db.rows.keys()].some(key => key.startsWith('journal_entries/') && key !== 'journal_entries/test-funding')).toBe(false);
    db.rows.set('temporary_expenses/test-advance', { ...db.rows.get('temporary_expenses/test-advance'),
      status: 'recovered', recovered_amount: 150 });
    const recoveredFirst = await financeWorkbench(db, auth, { action: 'read', kind: 'variable', sourceId: saved.sourceId });
    expect(recoveredFirst.approvalReady).toBe(false);
    expect(recoveredFirst.workflowDimensions.funding.ledgerMatched).toBe(false);
    db.rows.set('temporary_expenses/test-advance', { ...db.rows.get('temporary_expenses/test-advance'),
      status: 'pending', recovered_amount: 0 });
    db.rows.set('journal_entries/test-funding', { ...db.rows.get('journal_entries/test-funding'), status: 'reversed' });
    const reversed = await financeWorkbench(db, auth, { action: 'read', kind: 'variable', sourceId: saved.sourceId });
    expect(reversed.approvalReady).toBe(false);
    expect(reversed.paymentProven).toBe(false);
    db.rows.set('journal_entries/test-funding', { ...db.rows.get('journal_entries/test-funding'), status: 'posted' });
    const funding = db.rows.get('journal_entries/test-funding');
    db.rows.set('journal_entries/test-funding', { ...funding, lines: undefined });
    db.rows.set('journal_lines/test-debit', { entryId: 'test-funding', accountId: '1300', debit: 150, credit: 0 });
    db.rows.set('journal_lines/test-credit', { entryId: 'test-funding', accountId: '1010', debit: 0, credit: 150 });
    expect((await financeWorkbench(db, auth, { action: 'read', kind: 'variable', sourceId: saved.sourceId })).workflowDimensions.funding.ledgerMatched).toBe(true);
    db.rows.set('journal_lines/test-credit', { entryId: 'test-funding', accountId: '2000', debit: 0, credit: 150 });
    expect((await financeWorkbench(db, auth, { action: 'read', kind: 'variable', sourceId: saved.sourceId })).approvalReady).toBe(false);
    db.rows.set('journal_lines/test-credit', { entryId: 'test-funding', accountId: '1010', debit: 0, credit: 150 });
    const second = await financeWorkbench(db, auth, { action: 'previewCapture', kind: 'variable', requestId: 'SECOND-TEST',
      patch: expensePatch({ amount: 60, quantity: 2, invoiceNumber: 'TEST-002', invoiceUrl: 'https://example.org/second-invoice',
        paymentStatus: 'paid', paymentMethod: 'card', paidDate: '2026-10-18', fundingType: 'employee',
        employeeAdvanceLink: { ...patch.employeeAdvanceLink, allocatedAmount: 60 } }) });
    expect(second.postingPreview.ready).toBe(false);
    expect(second.issues.join(' ')).toMatch(/تتجاوز التمويل/);
  });
  it('posts a matched expense once, shares the balance with payroll and releases it on reversal', async () => {
    const db = database(); seedAdvance(db);
    const request = employeeRequest('POST-ONCE', 100);
    const preview = await financeWorkbench(db, auth, { action: 'previewCapture', ...request });
    const saved = await financeWorkbench(db, auth, { action: 'capture', ...request, previewHash: preview.previewHash,
      reason: 'TEST consume custody', confirm: true });
    const common = { kind: 'variable', sourceId: saved.sourceId };
    const read = await financeWorkbench(db, auth, { action: 'read', ...common });
    expect(read.approvalReady).toBe(true);
    await financeWorkbench(db, auth, { action: 'approve', ...common, sourceHash: read.sourceHash,
      postingHash: read.postingPreview.postingHash, reason: 'TEST matched funding', confirm: true });
    const posted = await postSource(db, FieldValue, common, { userId: auth.uid });
    expect(db.rows.get('temporary_expenses/test-advance').custody_expense_used_halala).toBe(10000);
    expect(db.rows.get(`journal_entries/${posted.entryId}`).lines).toContainEqual(expect.objectContaining({ accountId: '1300', credit: 100 }));
    const payroll = calculatePayrollPreview({ periodKey: '2026-10', bikers: [{ id: 'test-employee', name: 'TEST worker', salary: 500,
      start_date: '2026-10-01' }], advances: [{ id: 'test-advance', ...db.rows.get('temporary_expenses/test-advance'),
      spent_date: '2026-10-17' }] });
    expect(payroll.lines[0].advanceOutstanding).toBe(50);
    await expect(postSource(db, FieldValue, common, { userId: auth.uid })).rejects.toThrow(/سبق ترحيل/);
    await expect(reverseEntry(db, FieldValue, 'test-funding', { entryDate: '2026-10-19', userId: auth.uid })).rejects.toThrow(/مرتبط/);
    await reverseEntry(db, FieldValue, posted.entryId, { entryDate: '2026-10-19', userId: auth.uid });
    expect(db.rows.get('temporary_expenses/test-advance').custody_expense_used_halala).toBe(0);
  });
  it('allows the remaining funded amount after a payroll deduction', async () => {
    const db = database(); seedAdvance(db);
    db.rows.set('temporary_expenses/test-advance', { ...db.rows.get('temporary_expenses/test-advance'),
      recovered_amount: 50, payroll_lock_id: 'test-payroll' });
    const request = employeeRequest('PAYROLL-FIRST', 100);
    const preview = await financeWorkbench(db, auth, { action: 'previewCapture', ...request });
    expect(preview.postingPreview.ready).toBe(true);
    const saved = await financeWorkbench(db, auth, { action: 'capture', ...request, previewHash: preview.previewHash,
      reason: 'TEST prior payroll', confirm: true });
    const read = await financeWorkbench(db, auth, { action: 'read', kind: 'variable', sourceId: saved.sourceId });
    await financeWorkbench(db, auth, { action: 'approve', kind: 'variable', sourceId: saved.sourceId,
      sourceHash: read.sourceHash, postingHash: read.postingPreview.postingHash, reason: 'TEST prior payroll', confirm: true });
    await postSource(db, FieldValue, { kind: 'variable', sourceId: saved.sourceId }, { userId: auth.uid });
    expect(db.rows.get('temporary_expenses/test-advance').custody_expense_used_halala).toBe(10000);
    const payroll = calculatePayrollPreview({ periodKey: '2026-10', bikers: [{ id: 'test-employee', name: 'TEST worker', salary: 500,
      start_date: '2026-10-01' }], advances: [{ id: 'test-advance', ...db.rows.get('temporary_expenses/test-advance'),
      spent_date: '2026-10-17' }] });
    expect(payroll.lines[0].advanceOutstanding).toBe(0);
  });
  it('recovers only the unspent balance and reverses recovery before the linked expense', async () => {
    const db = database(); seedAdvance(db);
    const request = employeeRequest('RECOVERY-AFTER', 100);
    const preview = await financeWorkbench(db, auth, { action: 'previewCapture', ...request });
    const saved = await financeWorkbench(db, auth, { action: 'capture', ...request, previewHash: preview.previewHash,
      reason: 'TEST linked purchase', confirm: true });
    const common = { kind: 'variable', sourceId: saved.sourceId };
    const read = await financeWorkbench(db, auth, { action: 'read', ...common });
    await financeWorkbench(db, auth, { action: 'approve', ...common, sourceHash: read.sourceHash,
      postingHash: read.postingPreview.postingHash, reason: 'TEST linked purchase', confirm: true });
    const expense = await postSource(db, FieldValue, common, { userId: auth.uid });
    db.rows.set('temporary_expenses/test-advance', { ...db.rows.get('temporary_expenses/test-advance'),
      status: 'recovered', recovered_date: '2026-10-19' });
    const recovery = await postSource(db, FieldValue, { kind: 'recovery', sourceId: 'test-advance' }, { userId: auth.uid });
    expect(db.rows.get(`journal_entries/${recovery.entryId}`).lines).toContainEqual(expect.objectContaining({ accountId: '1300', credit: 50 }));
    const recoveryLock = db.rows.get('posting_locks/recovery__test-advance');
    db.rows.delete('posting_locks/recovery__test-advance');
    await expect(postSource(db, FieldValue, { kind: 'recovery', sourceId: 'test-advance' }, { userId: auth.uid }))
      .rejects.toThrow(/لا يُرحّل مرتين/);
    db.rows.set('posting_locks/recovery__test-advance', recoveryLock);
    await expect(reverseEntry(db, FieldValue, expense.entryId, { entryDate: '2026-10-20', userId: auth.uid }))
      .rejects.toThrow(/اعكس استرداد/);
    await reverseEntry(db, FieldValue, recovery.entryId, { entryDate: '2026-10-20', userId: auth.uid });
    expect(db.rows.get('temporary_expenses/test-advance').status).toBe('pending');
    await reverseEntry(db, FieldValue, expense.entryId, { entryDate: '2026-10-20', userId: auth.uid });
    expect(db.rows.get('temporary_expenses/test-advance').custody_expense_used_halala).toBe(0);
  });
  it('checks the exact advance allocation across expense kinds while withholding approval and rejecting duplicates', async () => {
    const db = database(); seedAdvance(db);
    db.rows.set('monthly_expense_categories/test-category', { name: 'TEST monthly' });
    db.rows.set('chart_of_accounts/5200', {});
    const first = employeeRequest('FIRST', 100), second = employeeRequest('SECOND', 50, 'monthly');
    const saved = [];
    for (const request of [first, second]) {
      const preview = await financeWorkbench(db, auth, { action: 'previewCapture', ...request });
      expect(preview.postingPreview.ready).toBe(true);
      expect(preview.postingPreview.employeeAdvanceProof).toBeTruthy();
      saved.push(await financeWorkbench(db, auth, { action: 'capture', ...request, previewHash: preview.previewHash,
        reason: 'TEST exact allocation', confirm: true }));
    }
    for (const [index, item] of saved.entries()) {
      const read = await financeWorkbench(db, auth, { action: 'read', kind: index ? 'monthly' : 'variable', sourceId: item.sourceId });
      expect(read.approvalReady).toBe(true);
      expect(read.workflowDimensions.funding.ledgerMatched).toBe(true);
    }
    const excess = await financeWorkbench(db, auth, { action: 'previewCapture', ...employeeRequest('EXCESS', 0.01) });
    expect(excess.postingPreview.ready).toBe(false);
    expect(excess.issues.join(' ')).toMatch(/تتجاوز التمويل/);
    const duplicate = employeeRequest('DUPLICATE', 1);
    duplicate.patch.invoiceUrl = first.patch.invoiceUrl;
    await expect(financeWorkbench(db, auth, { action: 'previewCapture', ...duplicate })).rejects.toThrow(/مرتبط/);
  });
  it('rechecks concurrent saved allocations and blocks excess approval', async () => {
    const db = database(); seedAdvance(db);
    const first = employeeRequest('BASE', 100);
    const firstPreview = await financeWorkbench(db, auth, { action: 'previewCapture', ...first });
    await financeWorkbench(db, auth, { action: 'capture', ...first, previewHash: firstPreview.previewHash,
      reason: 'TEST base allocation', confirm: true });
    const contenders = [employeeRequest('RACE-A', 40), employeeRequest('RACE-B', 40)];
    const previews = await Promise.all(contenders.map(request => financeWorkbench(db, auth, { action: 'previewCapture', ...request })));
    expect(previews.every(preview => preview.postingPreview.ready && preview.postingPreview.employeeAdvanceProof)).toBe(true);
    const saved = await Promise.all(contenders.map((request, index) => financeWorkbench(db, auth, { action: 'capture', ...request,
      previewHash: previews[index].previewHash, reason: 'TEST racing allocation', confirm: true })));
    for (const item of saved) {
      const read = await financeWorkbench(db, auth, { action: 'read', kind: 'variable', sourceId: item.sourceId });
      expect(read.approvalReady).toBe(false);
      expect(read.issues.join(' ')).toMatch(/تتجاوز التمويل/);
      await expect(financeWorkbench(db, auth, { action: 'approve', kind: 'variable', sourceId: item.sourceId,
        sourceHash: read.sourceHash, postingHash: 'a'.repeat(64), reason: 'TEST refuse over-allocation', confirm: true })).rejects.toThrow();
    }
  });
  it('refuses reversing linked advance funding and permits reversal after an unposted link is removed', async () => {
    const db = database(); seedAdvance(db);
    const request = employeeRequest('REVERSAL', 100);
    const preview = await financeWorkbench(db, auth, { action: 'previewCapture', ...request });
    const saved = await financeWorkbench(db, auth, { action: 'capture', ...request, previewHash: preview.previewHash,
      reason: 'TEST linked advance', confirm: true });
    const before = structuredClone([...db.rows]);
    await expect(reverseEntry(db, FieldValue, 'test-funding', { entryDate: '2026-10-19', userId: 'test-admin' }))
      .rejects.toThrow(/مرتبط بمصروفات/);
    expect([...db.rows]).toEqual(before);
    const row = db.rows.get(`variable_expenses/${saved.sourceId}`);
    delete row.finance_metadata.employeeAdvanceLink;
    const reversed = await reverseEntry(db, FieldValue, 'test-funding', { entryDate: '2026-10-19', userId: 'test-admin' });
    expect(reversed.reversedEntryId).toBe('test-funding');
    expect(db.rows.get('journal_entries/test-funding').status).toBe('reversed');
  });
  it('cannot make a stale linked expense eligible while funding reversal races with capture', async () => {
    const db = database(); seedAdvance(db);
    const request = employeeRequest('REVERSAL-RACE', 100);
    const preview = await financeWorkbench(db, auth, { action: 'previewCapture', ...request });
    const outcomes = await Promise.allSettled([
      reverseEntry(db, FieldValue, 'test-funding', { entryDate: '2026-10-19', userId: auth.uid }),
      financeWorkbench(db, auth, { action: 'capture', ...request, previewHash: preview.previewHash,
        reason: 'TEST concurrent link', confirm: true }),
    ]);
    const captured = outcomes[1].status === 'fulfilled' ? outcomes[1].value : null;
    if (captured) {
      const read = await financeWorkbench(db, auth, { action: 'read', kind: 'variable', sourceId: captured.sourceId });
      expect(read.approvalReady).toBe(db.rows.get('journal_entries/test-funding').status === 'posted');
      expect(read.paymentProven).toBe(read.approvalReady);
    }
    expect([...db.rows.keys()].filter(key => key.startsWith('journal_entries/') && key !== 'journal_entries/test-funding'
      && db.rows.get(key).sourceType === 'expense')).toEqual([]);
  });
  it('blocks the direct ledger posting door with a forged approved review', async () => {
    const db = database(); seedAdvance(db);
    const request = employeeRequest('FORGED-APPROVAL', 100);
    const preview = await financeWorkbench(db, auth, { action: 'previewCapture', ...request });
    const saved = await financeWorkbench(db, auth, { action: 'capture', ...request, previewHash: preview.previewHash,
      reason: 'TEST linked source', confirm: true });
    const row = db.rows.get(`variable_expenses/${saved.sourceId}`);
    row.approval_status = 'approved';
    db.rows.set(`finance_reviews/${financeReviewId('variable', saved.sourceId)}`,
      { status: 'approved', sourceHash: financeSourceHash(row) });
    await expect(postSource(db, FieldValue, { kind: 'variable', sourceId: saved.sourceId }, { userId: auth.uid }))
      .rejects.toThrow(/معاينة الحسابات|اعتماد/);
    expect([...db.rows.keys()].filter(key => key.startsWith('journal_entries/'))).toEqual(['journal_entries/test-funding']);
  });
  it('a no-op correction or reverting values cannot resurrect an old approval receipt', async () => {
    const db = database(), data = await capture(db), common = { kind: 'variable', sourceId: data.result.sourceId, sourceHash: data.read.sourceHash };
    await financeWorkbench(db, auth, { action: 'approve', ...common, postingHash: data.read.postingPreview.postingHash, reason: 'اعتماد اختبار', confirm: true });
    const preview = await financeWorkbench(db, auth, { action: 'preview', ...common, patch: {} });
    await financeWorkbench(db, auth, { action: 'save', ...common, patch: {}, previewHash: preview.previewHash, reason: 'حفظ نسخة اختبار جديدة', confirm: true });
    const after = await financeWorkbench(db, auth, { action: 'read', kind: 'variable', sourceId: common.sourceId });
    expect(after.row.finance_revision).toBe(2); expect(after.sourceHash).not.toBe(common.sourceHash); expect(after.approved).toBe(false);
    await financeWorkbench(db, auth, { action: 'approve', ...common, sourceHash: after.sourceHash, postingHash: after.postingPreview.postingHash, reason: 'اعتماد اختبار', confirm: true });
    expect((await financeWorkbench(db, auth, { action: 'read', kind: 'variable', sourceId: common.sourceId })).approved).toBe(true);
  });
  it('preview does not save; capture preserves invoice/quantity/funding and does not post or pay', async () => {
    const db = database(), patch = expensePatch(), request = { action: 'previewCapture', kind: 'variable', requestId: 'TEST', patch };
    const preview = await financeWorkbench(db, auth, request);
    expect([...db.rows.keys()].filter(k => k.startsWith('variable_expenses/'))).toHaveLength(0);
    expect(preview.after).toMatchObject({ quantity: 2, unit_cost: 50, supplier: patch.supplier, payment_status: 'unpaid', payment_method: 'credit' });
    const data = await capture(db);
    expect(data.read.approved).toBe(false); expect(data.read.postingPreview.ready).toBe(true);
    expect([...db.rows.keys()].some(k => /^(journal_entries|payroll_runs|sales_documents)\//.test(k))).toBe(false);
    const again = await financeWorkbench(db, auth, { action: 'capture', ...data.request, previewHash: data.preview.previewHash, reason: 'مستند اختبار معزول', confirm: true });
    expect(again.duplicate).toBe(true);
  });
  it('approves the exact read version and invalidates it after an evidenced same-record correction', async () => {
    const db = database(), data = await capture(db), common = { kind: 'variable', sourceId: data.result.sourceId, sourceHash: data.read.sourceHash };
    await financeWorkbench(db, auth, { action: 'approve', ...common, postingHash: data.read.postingPreview.postingHash, reason: 'مطابقة مستند الاختبار', confirm: true });
    const approved = await financeWorkbench(db, auth, { action: 'read', kind: 'variable', sourceId: common.sourceId });
    expect(approved.approved).toBe(true);
    const patch = { description: 'وصف مصحح بمستند اختباري' }, preview = await financeWorkbench(db, auth, { action: 'preview', ...common, patch });
    await financeWorkbench(db, auth, { action: 'save', ...common, patch, previewHash: preview.previewHash, reason: 'تصحيح مثبت', confirm: true });
    const after = await financeWorkbench(db, auth, { action: 'read', kind: 'variable', sourceId: common.sourceId });
    expect(after.approved).toBe(false); expect(after.sourceHash).not.toBe(common.sourceHash);
    expect([...db.rows.keys()].filter(k => k.startsWith('variable_expenses/'))).toHaveLength(1);
    await expect(db.runTransaction(tx => assertFinanceApproval(db, tx, 'variable', common.sourceId, after.row))).rejects.toThrow(/اعتماد/);
  });
  it('does not infer cash, tax eligibility, supplier or funding from missing metadata', async () => {
    const db = database(), data = await capture(db, { supplier: null, paymentStatus: 'unknown', paymentMethod: 'unknown', fundingType: 'unknown', fundingReference: null });
    expect(data.read.issues.length).toBeGreaterThan(0);
    await expect(financeWorkbench(db, auth, { action: 'approve', kind: 'variable', sourceId: data.result.sourceId, sourceHash: data.read.sourceHash, postingHash: 'a'.repeat(64), reason: 'محاولة اختبار', confirm: true })).rejects.toThrow();
    expect(data.read.row.payment_method).toBe('unknown'); expect(data.read.row.vat_amount).toBeNull();
  });
  it('requires tax evidence for deductible invoices and preserves high-precision unit prices', async () => {
    const db = database(), data = await capture(db, { amount: 665.05, quantity: 50 });
    expect(data.read.row.unit_cost).toBe(13.301);
    expect(financeProblems('variable', { ...data.read.row, is_tax_invoice: true, vat_deductible: true, vat_amount: 10 })).toContain('أهلية المدخلات تحتاج مرجع مراجعة ضريبية؛ العلامة القديمة ليست إثباتًا.');
  });
  it('rejects stale source/preview, unknown keys, missing confirm and cross-kind duplicate originals', async () => {
    const db = database(), data = await capture(db), common = { kind: 'variable', sourceId: data.result.sourceId, sourceHash: data.read.sourceHash };
    await expect(financeWorkbench(db, auth, { action: 'save', ...common, patch: { amount: 200 }, reason: 'اختبار', previewHash: 'a'.repeat(64) })).rejects.toThrow();
    await expect(financeWorkbench(db, auth, { action: 'preview', ...common, patch: { madeUpAccount: '1010' } })).rejects.toThrow();
    await db.collection('variable_expenses').doc(common.sourceId).update({ supplier: 'تغير متزامن' });
    await expect(financeWorkbench(db, auth, { action: 'preview', ...common, patch: {} })).rejects.toThrow(/تغير/);
    await expect(financeWorkbench(db, auth, { action: 'previewCapture', kind: 'monthly', requestId: 'SECOND', patch: { ...expensePatch(), categoryId: undefined } })).rejects.toThrow(/مرتبط/);
  });
  it('refuses posted/reversed records and refuses moving a closed original date into an open month', async () => {
    const db = database(), data = await capture(db), common = { kind: 'variable', sourceId: data.result.sourceId, sourceHash: data.read.sourceHash };
    db.rows.set('accounting_periods/2026-10', { status: 'closed' });
    await expect(financeWorkbench(db, auth, { action: 'preview', ...common, patch: { date: '2026-11-01' } })).rejects.toThrow(/مقفلة/);
    db.rows.delete('accounting_periods/2026-10'); db.rows.set('journal_entries/reversed', { sourceId: common.sourceId, status: 'reversed' });
    await expect(financeWorkbench(db, auth, { action: 'preview', ...common, patch: {} })).rejects.toThrow(/مصدر/);
  });
  it.each(['partner', 'supervisor', 'operator', 'accountant'])('refuses %s without changing their role', async role => {
    const db = database(); db.rows.set('users/test-admin', { role });
    await expect(financeWorkbench(db, auth, { action: 'list', kind: 'variable' })).rejects.toMatchObject({ code: 'permission-denied' });
    expect(db.rows.get('users/test-admin').role).toBe(role);
  });
});
