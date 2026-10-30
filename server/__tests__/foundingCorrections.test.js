import { describe, expect, it } from 'vitest';
import { FieldValue } from 'firebase-admin/firestore';
import { financeWorkbench } from '../financeWorkbench.js';
import { foundingEntryId } from '../foundingSettlement.js';
import { reverseEntry } from '../../functions/src/ledger.js';
import { calculatePayrollPreview } from '../../functions/src/payroll.js';
import { cashRecoveryDue } from '../../functions/src/custodyRecovery.js';
import { memoryFinanceDb } from './financeFixtures.js';
import { foundingSeed, foundingCorrectionsSeed, foundingAuth as auth } from './foundingFixture.js';

const call = (db, request) => financeWorkbench(db, auth, { kind: 'founding', request });
const lines = e => e.lines.map(l => [l.accountId, l.debit, l.credit]);
const journals = db => [...db.rows].filter(([k]) => k.startsWith('journal_entries/'));
const seed = () => ({ ...foundingSeed(), ...foundingCorrectionsSeed() });

describe('«إلغاء مستند مكرر» in the founding settlement', () => {
  it('proposes a reversal of every live effect, posts it only on approval, then marks the document and takes it out of the summary and 2300', async () => {
    const db = memoryFinanceDb(seed());
    await call(db, { action: 'ensureAccounts', confirm: true });
    let read = await call(db, { action: 'read' });
    const paidBefore = read.plan.hadiBalance.paid;
    expect(read.plan.rows.find(d => d.key === 'startup:se2')).toMatchObject({ payer: 'hadi', protected: true, duplicate: null });
    const ask = request => call(db, { action: 'proposeDuplicate', confirm: true, reason: 'نفس الفاتورة سُجّلت مرتين', ...request });
    await expect(ask({ key: 'startup:se2', originalKey: 'startup:se2' })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(ask({ key: 'variable:v1', originalKey: 'startup:se1' })).rejects.toThrow('غير مرحّل');
    await expect(ask({ key: 'startup:nope', originalKey: 'startup:se1' })).rejects.toMatchObject({ code: 'not-found' });
    await expect(ask({ key: 'startup:se2', originalKey: 'startup:se1', reason: 'قصير' })).rejects.toMatchObject({ code: 'invalid-argument' });
    const before = structuredClone(journals(db));
    await ask({ key: 'startup:se2', originalKey: 'startup:se1' });
    await expect(ask({ key: 'startup:se2', originalKey: 'startup:se1' })).rejects.toThrow('مقترح إلغاؤه');
    await expect(ask({ key: 'startup:se1', originalKey: 'startup:se2' })).rejects.toThrow('الأصلي نفسه');
    expect(db.rows.get('founding_review/current').duplicateCancellations).toMatchObject([{ key: 'startup:se2', originalKey: 'startup:se1',
      reason: 'نفس الفاتورة سُجّلت مرتين', byName: 'مدير الاختبار', originalTitle: 'تجهيز المغسلة' }]);
    expect(journals(db)).toEqual(before);

    read = await call(db, { action: 'read' });
    let entry = read.plan.entries.find(e => e.key === 'duplicate:startup:se2');
    // Net of the own entry, its share of #6 and «تصحيح جهة دفع» #7: 1010 and 1020 cancel out.
    expect(lines(entry)).toEqual([['2300', 1000, 0], ['1200', 0, 130.43], ['1500', 0, 869.57]]);
    expect(entry).toMatchObject({ type: 'duplicate', status: 'held_vat', date: '2026-09-30', originalTitle: 'تجهيز المغسلة' });
    expect(entry.sources.map(s => [s.role, s.entryNumber])).toEqual([['own', 5], ['cash_bank_share', 6], ['payment_correction', 7]]);
    // Still counted until the cancellation posts; held out of the rule meanwhile.
    expect(read.plan.hadiBalance.paid).toBe(paidBefore);
    expect(read.plan.rows.find(d => d.key === 'startup:se2').duplicate).toMatchObject({ originalKey: 'startup:se1' });
    expect(read.plan.rule.candidates.some(c => c.key === 'startup:se2')).toBe(false);
    expect(read.plan.hadi.pending.some(p => p.key === entry.key && p.debit === 1000)).toBe(true);

    await call(db, { action: 'decide', sourceKey: 'startup:se2', vatReviewed: true, confirm: true });
    read = await call(db, { action: 'read' });
    entry = read.plan.entries.find(e => e.key === 'duplicate:startup:se2');
    expect(entry.status).toBe('proposed');
    await call(db, { action: 'postEntries', reason: 'موافقة هادي على إلغاء المكرر', confirm: true, entries: [{ key: entry.key, hash: entry.hash }] });
    const posted = db.rows.get(`journal_entries/${foundingEntryId(entry.key)}`);
    expect(posted).toMatchObject({ entryDate: '2026-09-30', sourceKind: 'founding_duplicate', status: 'posted', entryNumber: 20,
      foundingEntry: { key: 'duplicate:startup:se2', sourceKey: 'startup:se2', originalKey: 'startup:se1', reason: 'موافقة هادي على إلغاء المكرر' } });
    expect(lines(posted)).toEqual(lines(entry));
    // No original entry changed.
    for (const [path, value] of before) expect(db.rows.get(path)).toEqual(value);

    read = await call(db, { action: 'read' });
    expect(read.plan.rows.some(d => d.key === 'startup:se2')).toBe(false);
    expect(read.plan.cancelled).toMatchObject([{ key: 'startup:se2', originalKey: 'startup:se1', originalTitle: 'تجهيز المغسلة', entryNumber: 20 }]);
    expect(read.plan.hadiBalance.paid).toBe(paidBefore - 1000);
    expect(read.plan.summary.cancelled).toMatchObject({ count: 1, amount: 1000 });
    expect(read.plan.summary.categories.reduce((n, c) => n + c.amount, 0)).toBe(read.plan.summary.documented.amount);
    expect(read.plan.entries.find(e => e.key === 'doc:startup:se2')).toMatchObject({ status: 'posted', entryNumber: 7 });
    expect(read.plan.hadi.posted.filter(l => l.entryNumber === 7 || l.entryNumber === 20).reduce((n, l) => n + l.credit - l.debit, 0)).toBe(0);
    const proposal = db.rows.get('founding_review/current').duplicateCancellations[0];
    await expect(call(db, { action: 'removeDuplicate', id: proposal.id, confirm: true })).rejects.toThrow('مرحّل');

    // The workbench marks it, and offers no completion on it.
    const detail = await financeWorkbench(db, auth, { action: 'read', kind: 'startup', sourceId: 'se2' });
    expect(detail).toMatchObject({ workflowStage: 'cancelled', cancelled: { originalKey: 'startup:se1', originalTitle: 'تجهيز المغسلة', entryNumber: 20 },
      completion: { available: false } });
    expect(detail.workflowNote).toContain('ملغى — مكرر لـ«تجهيز المغسلة»');
    const browse = await financeWorkbench(db, auth, { action: 'browse' });
    expect(browse.items.find(i => i.sourceId === 'se2').workflowStage).toBe('cancelled');
  });

  it('refuses a document whose entry settled an employee’s custody, and can be withdrawn before it posts', async () => {
    const data = seed();
    data['journal_entries/je5'].custodyRecovery = { bikerId: 'b1', amount: 1000, allocations: [] };
    const db = memoryFinanceDb(data);
    await expect(call(db, { action: 'proposeDuplicate', key: 'startup:se2', originalKey: 'startup:se1', reason: 'نفس الفاتورة مرتين', confirm: true })).rejects.toThrow('عهدة');
    delete data['journal_entries/je5'].custodyRecovery;
    const db2 = memoryFinanceDb(data);
    const { proposal } = await call(db2, { action: 'proposeDuplicate', key: 'startup:se2', originalKey: 'startup:se1', reason: 'نفس الفاتورة مرتين', confirm: true });
    await call(db2, { action: 'removeDuplicate', id: proposal.id, confirm: true });
    const read = await call(db2, { action: 'read' });
    expect(read.plan.entries.some(e => e.type === 'duplicate')).toBe(false);
    expect(read.plan.rows.find(d => d.key === 'startup:se2').duplicate).toBe(null);
  });
});

describe('«تسوية مصروف مؤقت» in the founding settlement', () => {
  it('lists posted items with something left, posts Dr expense / Cr 1300 on approval, settles the item, and a reversal reopens it', async () => {
    const db = memoryFinanceDb(seed());
    let read = await call(db, { action: 'read' });
    expect(read.plan.custodyItems.map(a => [a.id, a.outstanding, a.postingDate, a.holder])).toEqual([['t1', 300, '2026-09-30', 'سالم'], ['t2', 50, '2026-10-12', null]]);
    expect(read.expenseAccounts.map(a => a.code)).toEqual(['5100', '5300']);
    const ask = request => call(db, { action: 'proposeCustodySettlement', reason: 'صُرفت على المشروع ولا تُسترد', confirm: true, ...request });
    await expect(ask({ advanceId: 't3', accountId: '5300' })).rejects.toMatchObject({ code: 'not-found' });
    await expect(ask({ advanceId: 't4', accountId: '5300' })).rejects.toThrow('لا باقي عليه');
    await expect(ask({ advanceId: 't1', accountId: '1010' })).rejects.toMatchObject({ code: 'invalid-argument' });
    const before = structuredClone(journals(db));
    await ask({ advanceId: 't1', accountId: '5300' });
    await expect(ask({ advanceId: 't1', accountId: '5300' })).rejects.toThrow('مقترحة تسويته');
    await ask({ advanceId: 't2', accountId: '5100' });
    expect(journals(db)).toEqual(before);
    expect(db.rows.get('temporary_expenses/t1')).toMatchObject({ status: 'pending', recovered_amount: 0 });

    read = await call(db, { action: 'read' });
    const t1 = read.plan.entries.find(e => e.key === 'custody_settlement:t1'), t2 = read.plan.entries.find(e => e.key === 'custody_settlement:t2');
    expect(lines(t1)).toEqual([['5300', 300, 0], ['1300', 0, 300]]);
    expect(t1).toMatchObject({ status: 'proposed', date: '2026-09-30', originalDate: '2026-08-15', holder: 'سالم' });
    expect(t2).toMatchObject({ status: 'proposed', date: '2026-10-12' });
    expect(lines(t2)).toEqual([['5100', 50, 0], ['1300', 0, 50]]);
    expect(read.plan.custodyItems).toEqual([]);

    await call(db, { action: 'postEntries', reason: 'موافقة هادي', confirm: true, entries: [{ key: t1.key, hash: t1.hash }] });
    const entryId = foundingEntryId(t1.key), posted = db.rows.get(`journal_entries/${entryId}`);
    expect(posted).toMatchObject({ entryDate: '2026-09-30', sourceKind: 'founding_custody_settlement', foundingEntry: { advanceId: 't1' },
      custodyRecovery: { allocations: [{ advanceId: 't1', amount: 300 }] } });
    expect(lines(posted)).toEqual([['5300', 300, 0], ['1300', 0, 300]]);
    expect(db.rows.get('journal_entries/je_t1')).toEqual(before.find(([k]) => k === 'journal_entries/je_t1')[1]);
    const advance = { id: 't1', ...db.rows.get('temporary_expenses/t1') };
    expect(advance).toMatchObject({ status: 'recovered', recovered_amount: 300, recovered_date: '2026-09-30', recovery_method: 'expense_document',
      document_recoveries: [{ kind: 'founding', sourceId: 'custody_settlement:t1', entryId, amount: 300, date: '2026-09-30' }] });
    // Payroll deducts nothing for it, and no cash recovery is due.
    expect(cashRecoveryDue(advance)).toBe(false);
    const payroll = calculatePayrollPreview({ periodKey: '2026-10', bikers: [{ id: 'b1', name: 'سالم', salary: 3000, start_date: '2026-01-01' }],
      washes: [], advances: [advance], automaticAdvanceDeduction: true });
    expect(payroll.lines.find(l => l.bikerId === 'b1').advanceDeduction).toBe(0);
    read = await call(db, { action: 'read' });
    expect(read.plan.entries.find(e => e.key === t1.key)).toMatchObject({ status: 'posted', postedReason: 'موافقة هادي', amount: 300, date: '2026-09-30' });
    const proposal = db.rows.get('founding_review/current').custodySettlements.find(p => p.advanceId === 't1');
    await expect(call(db, { action: 'removeCustodySettlement', id: proposal.id, confirm: true })).rejects.toThrow('مرحّلة');

    await reverseEntry(db, FieldValue, entryId, { entryDate: '2026-10-28', userId: 'test-admin' });
    expect(db.rows.get('temporary_expenses/t1')).toMatchObject({ status: 'pending', recovered_amount: 0, document_recoveries: [] });
  });

  it('drops a proposal whose item was recovered another way before it posts', async () => {
    const db = memoryFinanceDb(seed());
    await call(db, { action: 'proposeCustodySettlement', advanceId: 't1', accountId: '5300', reason: 'صُرفت على المشروع', confirm: true });
    db.rows.set('temporary_expenses/t1', { ...db.rows.get('temporary_expenses/t1'), status: 'recovered', recovered_amount: 300, recovered_date: '2026-09-10' });
    const read = await call(db, { action: 'read' });
    expect(read.plan.entries.some(e => e.type === 'custody_settlement')).toBe(false);
  });
});
