import { describe, expect, it } from 'vitest';
import { financeWorkbench } from '../financeWorkbench.js';
import { foundingEntryId } from '../foundingSettlement.js';
import { memoryFinanceDb } from './financeFixtures.js';
import { foundingSeed, foundingAuth as auth } from './foundingFixture.js';

const call = (db, request) => financeWorkbench(db, auth, { kind: 'founding', request });
const lines = e => e.lines.map(l => [l.accountId, l.debit, l.credit, l.description, l.partnerId ?? null]);
const seed = () => ({
  ...foundingSeed(),
  'chart_of_accounts/1100': { code: '1100', nameArabic: 'العملاء / الذمم المدينة', accountType: 'asset', active: true },
  // «ذمة رأس مال غير مسددة» recorded by hand, as in production: 1100 named by the partner, against his capital.
  'journal_entries/je9': { entryDate: '2026-08-15', periodKey: '2026-08', sourceType: 'adjustment', sourceKind: 'founding_manual', sourceId: 'je9', status: 'posted',
    entryNumber: 9, description: 'رأس مال غير مسدد', lines: [{ accountId: '1100', debit: 2000, credit: 0, description: 'ذمة رأس مال — شريك أ' },
      { accountId: '3000-p1', debit: 0, credit: 2000, description: 'رأس مال غير مسدد — شريك أ' }] },
  'partner_payments/pp2': { partner_id: 'p1', amount: 3000, payment_date: '2026-08-20', payment_method: 'bank_transfer' },
  'partner_payments/pp3': { partner_id: 'p1', amount: 500, payment_date: '2026-08-25', payment_method: 'bank_transfer' },
});

describe('«سند قبض وصل لحساب هادي» for a partner with an open capital receivable', () => {
  it('credits 1100 until the receivable is settled — oldest receipt first — and capital with the rest', async () => {
    const db = memoryFinanceDb(seed());
    for (const key of ['partner_payment:pp2', 'partner_payment:pp3']) await call(db, { action: 'decide', sourceKey: key, decision: 'hadi', confirm: true });
    await call(db, { action: 'proposeReceipts', keys: ['partner_payment:pp3', 'partner_payment:pp2'], reason: 'وصلت لحسابي الشخصي', confirm: true });
    let read = await call(db, { action: 'read' });
    const receipt = id => read.plan.entries.find(e => e.key === `receipt:partner_payment:${id}`);
    expect(lines(receipt('pp2'))).toEqual([['2300', 3000, 0, 'دفعة شريك أ وصلت لحساب هادي', null],
      ['1100', 0, 2000, 'ذمة رأس مال — شريك أ', 'p1'], ['3000-p1', 0, 1000, 'رأس مال شريك أ', null]]);
    expect(lines(receipt('pp3'))).toEqual([['2300', 500, 0, 'دفعة شريك أ وصلت لحساب هادي', null], ['3000-p1', 0, 500, 'رأس مال شريك أ', null]]);

    await call(db, { action: 'postEntries', reason: 'موافقة هادي', confirm: true, entries: [{ key: receipt('pp2').key, hash: receipt('pp2').hash }] });
    expect(lines(db.rows.get(`journal_entries/${foundingEntryId('receipt:partner_payment:pp2')}`))).toEqual([['2300', 3000, 0, 'دفعة شريك أ وصلت لحساب هادي', null],
      ['1100', 0, 2000, 'ذمة رأس مال — شريك أ', 'p1'], ['3000-p1', 0, 1000, 'رأس مال شريك أ', null]]);
    // Settled: the next receipt is capital only, and its proposal did not move.
    read = await call(db, { action: 'read' });
    expect(lines(receipt('pp3'))).toEqual([['2300', 500, 0, 'دفعة شريك أ وصلت لحساب هادي', null], ['3000-p1', 0, 500, 'رأس مال شريك أ', null]]);
  });

  it('shares a larger receivable across the receipts in date order', async () => {
    const db = memoryFinanceDb({ ...seed(), 'journal_entries/je9': { ...seed()['journal_entries/je9'], lines: [
      { accountId: '1100', debit: 3200, credit: 0, description: 'ذمة رأس مال — شريك أ' }, { accountId: '3000-p1', debit: 0, credit: 3200, description: 'رأس مال غير مسدد' }] } });
    for (const key of ['partner_payment:pp2', 'partner_payment:pp3']) await call(db, { action: 'decide', sourceKey: key, decision: 'hadi', confirm: true });
    await call(db, { action: 'proposeReceipts', keys: ['partner_payment:pp2', 'partner_payment:pp3'], reason: 'وصلت لحسابي الشخصي', confirm: true });
    const read = await call(db, { action: 'read' });
    const [pp2, pp3] = ['pp2', 'pp3'].map(id => read.plan.entries.find(e => e.key === `receipt:partner_payment:${id}`));
    // 3,200 open: the first receipt (3,000) takes 3,000 of it, the second (500) the last 200.
    expect(lines(pp2).slice(1)).toEqual([['1100', 0, 3000, 'ذمة رأس مال — شريك أ', 'p1']]);
    expect(lines(pp3).slice(1)).toEqual([['1100', 0, 200, 'ذمة رأس مال — شريك أ', 'p1'], ['3000-p1', 0, 300, 'رأس مال شريك أ', null]]);
  });
});
