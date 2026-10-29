import { describe, expect, it } from 'vitest';
import { foundingPlan, documentCandidates, paymentCandidates, balanceMeaning, completenessGaps } from '../founding/foundingPlan';

const doc = (id, over = {}) => ({ key: `variable:${id}`, kind: 'variable', sourceId: id, title: id, amount: 100, date: '2026-09-01', supplier: 'مورد',
  hasProof: false, protected: false, effect: { cash: 0, bank: 0 }, fundingType: null, paymentMethod: 'cash', vatQuarter: null, issues: [], ...over });
const line = (id, over = {}) => ({ id, account: 'personal', txDate: '2026-09-03', direction: 'debit', amount: 100, decision: 'document',
  linkKind: null, linkId: null, status: 'applied', ...over });

describe('statement matching', () => {
  it('matches a debit on the document day up to 7 days after, never before', () => {
    const docs = [doc('a', { date: '2026-09-01' }), doc('b', { date: '2026-09-05' }), doc('c', { date: '2026-08-20' }), doc('d', { amount: 100.01 })];
    const ids = txDate => documentCandidates({ direction: 'debit', amount: 100, txDate }, docs).map(d => d.sourceId);
    expect(ids('2026-09-01')).toEqual(['a']);
    expect(ids('2026-09-08')).toEqual(['b', 'a']);
    expect(ids('2026-09-09')).toEqual(['b']);
    expect(ids('2026-08-31')).toEqual([]);
    expect(documentCandidates({ direction: 'credit', amount: 100, txDate: '2026-09-01' }, docs)).toEqual([]);
    expect(documentCandidates({ direction: 'debit', amount: 100, txDate: '2026-09-02' }, docs, new Set(['variable:a']))).toEqual([]);
  });
  it('matches a deposit to a partner payment within 7 days either side', () => {
    const payments = [{ key: 'partner_payment:p', id: 'p', amount: 5000, date: '2026-08-10' }];
    expect(paymentCandidates({ direction: 'credit', amount: 5000, txDate: '2026-08-03' }, payments)).toHaveLength(1);
    expect(paymentCandidates({ direction: 'credit', amount: 5000, txDate: '2026-08-18' }, payments)).toHaveLength(0);
  });
});

describe('founding plan', () => {
  it('holds 3200 until employee custody is settled, then bridges historical bank delivery without reclassifying the source or claiming Q3 again', () => {
    const source = doc('custody', { amount: 100, date: '2026-09-18', fundingType: 'employee', vatQuarter: '2026-Q3' });
    const settings = { cutoffDate: '2026-09-30', threshold: 500,
      actuals: { bankOpen: true, bankBalance: 900, cash: 0, custody: [] } };
    const base = { docs: [source], settings, book: { 1020: 100000, 1010: 0, 1300: 0 },
      decisions: { 'variable:custody': { decision: 'hadi' } } };
    const before = foundingPlan(base);
    expect(before.settlement.status).toBe('waiting_custody');
    expect(before.entries.filter(e => e.type === 'document')).toEqual([]);
    expect(before.updates).toEqual([]);
    const after = foundingPlan({ ...base, docs: [{ ...source, protected: true, custodySettlementId: 'group', custodySettled: true }],
      custodyBridge: { amounts: { 1020: -10000, 1300: 0 }, groups: [{ groupId: 'group' }], issues: [] } });
    expect(after.settlement.status).toBe('balanced');
    expect(after.settlement.bookAfterTimingBridge).toMatchObject({ 1020: 90000, 1300: 0 });
    expect(after.settlement.differences).toMatchObject({ 1020: 0, 1300: 0 });
    expect(after.vatTouching).toEqual([]);
    const forged = foundingPlan({ ...base, docs: [{ ...source, protected: true, custodySettlementId: 'forged' }] });
    expect(forged.settlement.status).toBe('waiting_custody');
    const laterFunding = foundingPlan({ ...base, docs: [{ ...source, date: '2026-10-18', custodyFundingAfterCutoff: true }] });
    expect(laterFunding.settlement.unresolvedCustodyCount).toBe(0);
    expect(laterFunding.settlement.status).toBe('proposed');
  });
  it('splits pre-cutoff documents into the four groups by statement, proof and threshold', () => {
    const plan = foundingPlan({ docs: [doc('linked', { amount: 900 }), doc('proof', { hasProof: true }), doc('small', { amount: 499.99 }), doc('big', { amount: 500 }),
      doc('late', { date: '2026-10-02' })], lines: [line('l1', { linkKind: 'variable', linkId: 'linked', amount: 900 })],
    payments: [{ key: 'partner_payment:p', id: 'p', partnerName: 'أ', amount: 10, date: '2026-09-01', protected: true, effect: { cash: 0, bank: 1000 } }] });
    expect(Object.fromEntries(Object.entries(plan.groups).map(([k, v]) => [k, v.map(r => r.sourceId || r.id)])))
      .toEqual({ matched: ['linked'], small: ['small'], large: ['big'], withProof: ['proof'], partners: ['p'] });
    // An unposted document paid by Hadi changes only through the workbench, with no entry.
    expect(plan.updates).toEqual([expect.objectContaining({ key: 'variable:linked', patch: { fundingType: 'owner_current', paymentMethod: 'owner_current' } })]);
    expect(plan.entries).toEqual([]);
  });
  it('dates pre-cutoff corrections on the cutoff, later ones on their day, and blocks a closed month', () => {
    const input = { docs: [doc('old', { protected: true, effect: { cash: 0, bank: 10000 }, date: '2026-06-10' }),
      doc('new', { protected: true, effect: { cash: 5000, bank: 0 }, date: '2026-10-05', amount: 50 })],
    decisions: { 'variable:old': { decision: 'hadi' }, 'variable:new': { decision: 'hadi' } } };
    let plan = foundingPlan(input);
    expect(plan.entries.map(e => [e.key, e.date, e.status, e.lines.map(l => [l.accountId, l.debit, l.credit])])).toEqual([
      ['doc:variable:old', '2026-09-30', 'proposed', [['1020', 100, 0], ['2300', 0, 100]]],
      ['doc:variable:new', '2026-10-05', 'proposed', [['1010', 50, 0], ['2300', 0, 50]]],
    ]);
    plan = foundingPlan({ ...input, closedMonths: new Set(['2026-09']) });
    expect(plan.entries[0].status).toBe('blocked_period');
  });
  it('moves an expense paid from a partner pocket to that partner capital, and leaves «unknown» to the settlement', () => {
    const plan = foundingPlan({ docs: [doc('x', { protected: true, effect: { cash: 20000, bank: 0 }, amount: 200 }), doc('y', { protected: true, effect: { cash: 30000, bank: 0 }, amount: 300 })],
      decisions: { 'variable:x': { decision: 'partner', partnerId: 'p9' }, 'variable:y': { decision: 'unknown' } }, partners: [{ id: 'p9', name: 'ب' }] });
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0].lines.map(l => [l.accountId, l.debit, l.credit])).toEqual([['1010', 200, 0], ['3000-p9', 0, 200]]);
  });
  it('settles the rest on the cutoff against 3200 only after corrections, and never twice', () => {
    const base = { settings: { cutoffDate: '2026-09-30', threshold: 500, actuals: { bankOpen: false, bankBalance: null, cash: 120, custody: [{ name: 'س', amount: 30 }] } },
      book: { 1020: 2500, 1010: 20000, 1300: 0 } };
    let plan = foundingPlan(base);
    expect(plan.settlement.differences).toEqual({ 1020: -2500, 1010: -8000, 1300: 3000 });
    expect(plan.settlement.entry.lines.map(l => [l.accountId, l.debit, l.credit])).toEqual([['1020', 0, 25], ['1010', 0, 80], ['1300', 30, 0], ['3200', 75, 0]]);
    plan = foundingPlan({ ...base, docs: [doc('p', { protected: true, effect: { cash: 0, bank: 2500 }, amount: 25 })], decisions: { 'variable:p': { decision: 'hadi' } } });
    expect(plan.settlement).toMatchObject({ status: 'waiting', afterCorrections: { 1020: 5000 } });
    plan = foundingPlan({ ...base, posted: new Map([['settlement:2026-09-30', { entryId: 'e', entryNumber: 9, lines: [] }]]) });
    expect(plan.settlement.status).toBe('posted');
    expect(plan.entries.filter(e => e.status === 'proposed')).toEqual([]);
    expect(foundingPlan({ ...base, settings: { ...base.settings, actuals: null } }).settlement.status).toBe('needs_actuals');
  });
  it('builds Hadi’s statement with a running balance and its meaning', () => {
    const plan = foundingPlan({ hadiLedger: [
      { entryId: 'b', entryNumber: 2, date: '2026-08-02', debit: 5000, credit: 0, sourceType: 'adjustment', sourceKind: 'founding_payment' },
      { entryId: 'a', entryNumber: 1, date: '2026-08-01', debit: 0, credit: 1200, sourceType: 'expense', sourceKind: 'startup' },
    ], docs: [doc('u', { paymentMethod: 'owner_current', amount: 75 })] });
    expect(plan.hadi.posted.map(r => [r.entryId, r.balance, r.label])).toEqual([['a', 1200, 'مصروف دفعه هادي'], ['b', -3800, 'تصحيح: دفعة شريك استلمها هادي']]);
    expect(plan.hadi.meaning).toEqual({ kind: 'held_by_hadi', amount: 3800 });
    expect(plan.hadi.projectedBalance).toBe(-3725);
    expect(balanceMeaning(150)).toEqual({ kind: 'owed_to_hadi', amount: 1.5 });
    expect(balanceMeaning(0).kind).toBe('zero');
  });
  it('lists post-cutoff documents missing a supplier, proof or counter account', () => {
    expect(completenessGaps(doc('z', { supplier: '', fundingType: 'unknown' }))).toEqual(['المورد', 'الإثبات', 'الحساب المقابل']);
    expect(completenessGaps(doc('z', { statementLineRef: 'stmt_x', fundingType: 'owner_current' }))).toEqual([]);
    const plan = foundingPlan({ docs: [doc('late', { date: '2026-10-02', issues: ['x'] })] });
    expect(plan.postCutoff.map(d => [d.sourceId, d.missing])).toEqual([['late', ['الإثبات', 'الحساب المقابل']]]);
  });
});
