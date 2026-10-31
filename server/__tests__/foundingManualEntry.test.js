import { describe, expect, it } from 'vitest';
import { financeWorkbench } from '../financeWorkbench.js';
import { foundingEntryId } from '../foundingSettlement.js';
import { memoryFinanceDb } from './financeFixtures.js';
import { foundingSeed, foundingAuth as auth } from './foundingFixture.js';

const approver = { uid: 'test-admin-2' };
const call = (db, request, who = auth) => financeWorkbench(db, who, { kind: 'founding', request });
const seed = () => ({ ...foundingSeed(), 'users/test-admin-2': { role: 'admin', displayName: 'هادي' }, 'partners/p2': { partner_name: 'شريك ب' } });
const line = (accountId, debit, credit, description = '') => ({ accountId, debit, credit, description });
const manual = (overrides = {}) => ({ action: 'proposeManualEntry', date: '2026-10-20', description: 'إعادة تصنيف', reason: 'تصحيح تصنيف مصروف',
  lines: [line('5100', 150, 0), line('3000-p2', 0, 150)], confirm: true, ...overrides });
const journals = db => [...db.rows].filter(([k]) => k.startsWith('journal_entries/'));

describe('«قيد يدوي بموافقة» from the general ledger', () => {
  it('refuses an unbalanced entry, a closed period, 3200 without its reason and an unknown account', async () => {
    const db = memoryFinanceDb(seed());
    await call(db, { action: 'ensureAccounts', confirm: true });
    await expect(call(db, manual({ lines: [line('5100', 100, 0), line('1010', 0, 90)] }))).rejects.toThrow('غير متوازن');
    await expect(call(db, manual({ date: '2026-07-15' }))).rejects.toThrow('2026-07 مقفلة');
    await expect(call(db, manual({ lines: [line('3200', 50, 0), line('2300', 0, 50)] }))).rejects.toThrow('سبب استخدام 3200');
    await expect(call(db, manual({ lines: [line('9999', 50, 0), line('1010', 0, 50)] }))).rejects.toThrow('9999 غير موجود');
    await expect(call(db, manual({ lines: [line('5100', 50, 50), line('1010', 0, 0)] }))).rejects.toThrow('واحد منهما فقط');
    await expect(call(db, manual({ reason: 'قصير' }))).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(call(db, manual({ lines: [line('5100', 100, 0)] }))).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(db.rows.get('founding_review/current')?.manualEntries ?? []).toEqual([]);
    // Any halala is an amount: 0.07 × 100 is 7.000000000000001 in floating point.
    const { entry } = await call(db, manual({ lines: [line('5100', 0.07, 0), line('5100', 0.55, 0), line('1010', 0, 0.62)] }));
    expect(entry.lines.map(l => l.debit + l.credit)).toEqual([0.07, 0.55, 0.62]);
  });

  it('saves a proposal in its creator’s name, posts it only on approval with the approver’s name, and creates a partner sub-account', async () => {
    const db = memoryFinanceDb(seed());
    await call(db, { action: 'ensureAccounts', confirm: true });
    const before = structuredClone(journals(db));
    const { entry } = await call(db, manual());
    await call(db, manual({ description: 'تسوية على 3200', lines: [line('3200', 50, 0, 'فرق'), line('2300', 0, 50)], settlementReason: 'فرق بلا مستند تنازل عنه هادي' }));
    expect(entry).toMatchObject({ byName: 'مدير الاختبار', settlementReason: null, date: '2026-10-20' });
    expect(db.rows.get('founding_review/current').manualEntries).toHaveLength(2);
    expect(journals(db)).toEqual(before);

    let list = await call(db, { action: 'manualEntries' });
    expect(list.entries.map(e => [e.description, e.status, e.byName]).sort()).toEqual([['إعادة تصنيف', 'proposed', 'مدير الاختبار'], ['تسوية على 3200', 'proposed', 'مدير الاختبار']]);
    expect(list.partners.map(p => p.id).sort()).toEqual(['p1', 'p2']);
    expect(list.closedMonths).toEqual(['2026-07']);

    let read = await call(db, { action: 'read' });
    const proposed = read.plan.entries.filter(e => e.type === 'manual');
    expect(proposed.map(e => [e.title, e.status, e.date, e.proposedByName])).toEqual([['إعادة تصنيف', 'proposed', '2026-10-20', 'مدير الاختبار'],
      ['تسوية على 3200', 'proposed', '2026-10-20', 'مدير الاختبار']]);
    expect(proposed[1]).toMatchObject({ settlementReason: 'فرق بلا مستند تنازل عنه هادي' });
    // 3200 movements show in the founding summary with their reason.
    expect(read.plan.summary.settlements.find(s => s.key === proposed[1].key)).toMatchObject({ status: 'proposed', amount: -50 });

    await call(db, { action: 'postEntries', reason: 'موافقة هادي', confirm: true, entries: proposed.map(e => ({ key: e.key, hash: e.hash })) }, approver);
    const posted = db.rows.get(`journal_entries/${foundingEntryId(proposed[0].key)}`);
    expect(posted).toMatchObject({ entryDate: '2026-10-20', sourceKind: 'founding_manual', status: 'posted',
      foundingEntry: { proposedByName: 'مدير الاختبار', approvedByName: 'هادي', reason: 'موافقة هادي' } });
    expect(posted.lines.map(l => [l.accountId, l.debit, l.credit])).toEqual([['5100', 150, 0], ['3000-p2', 0, 150]]);
    expect(db.rows.get('chart_of_accounts/3000-p2')).toBeTruthy();
    expect(db.rows.get(`journal_entries/${foundingEntryId(proposed[1].key)}`).foundingEntry).toMatchObject({ settlementReason: 'فرق بلا مستند تنازل عنه هادي' });

    list = await call(db, { action: 'manualEntries' });
    expect(list.entries.every(e => e.status === 'posted' && e.approvedByName === 'هادي' && Number.isInteger(e.entryNumber))).toBe(true);
    read = await call(db, { action: 'read' });
    expect(read.plan.entries.find(e => e.key === proposed[0].key)).toMatchObject({ status: 'posted', postedByName: 'هادي', proposedByName: 'مدير الاختبار' });
    await expect(call(db, { action: 'removeManualEntry', id: entry.id, confirm: true })).rejects.toThrow('مرحّل');
  });

  it('holds a proposal whose month was closed after it was saved, and withdraws an unposted one', async () => {
    const db = memoryFinanceDb(seed());
    const { entry } = await call(db, manual({ date: '2026-09-12', lines: [line('5100', 80, 0), line('1010', 0, 80)] }));
    db.rows.set('accounting_periods/2026-09', { periodKey: '2026-09', status: 'closed' });
    const read = await call(db, { action: 'read' });
    const held = read.plan.entries.find(e => e.key === `manual:${entry.id}`);
    expect(held.status).toBe('blocked_period');
    await expect(call(db, { action: 'postEntries', reason: 'موافقة', confirm: true, entries: [{ key: held.key, hash: held.hash }] })).rejects.toThrow('ليس جاهزًا');
    expect((await call(db, { action: 'manualEntries' })).entries[0].status).toBe('blocked_period');
    await call(db, { action: 'removeManualEntry', id: entry.id, confirm: true });
    expect(db.rows.get('founding_review/current').manualEntries).toEqual([]);
  });
});
