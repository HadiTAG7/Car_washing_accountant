import { describe, expect, it } from 'vitest';
import { foundingPlan, documentCandidates, paymentCandidates, balanceMeaning, completenessGaps, ruleGaps, dayBefore } from '../founding/foundingPlan';

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
  it('splits pre-cutoff documents into the four groups by statement, proof and threshold', () => {
    const plan = foundingPlan({ docs: [doc('linked', { amount: 900 }), doc('proof', { hasProof: true }), doc('small', { amount: 499.99 }), doc('big', { amount: 500 }),
      doc('late', { date: '2026-10-02' })], lines: [line('l1', { linkKind: 'variable', linkId: 'linked', amount: 900 })],
    payments: [{ key: 'partner_payment:p', id: 'p', partnerName: 'أ', amount: 10, date: '2026-09-01', protected: true, effect: { cash: 0, bank: 1000 } }] });
    expect(Object.fromEntries(Object.entries(plan.groups).map(([k, v]) => [k, v.map(r => r.sourceId || r.id)])))
      .toEqual({ matched: ['linked'], small: ['small'], large: ['big'], withProof: ['proof'], partners: ['p'] });
    // An unposted document paid by Hadi changes only through the workbench, with no entry.
    expect(plan.updates).toEqual([expect.objectContaining({ key: 'variable:linked', source: 'statement',
      patch: { fundingType: 'owner_current', paymentMethod: 'owner_current', paidDate: '2026-09-01' } })]);
    expect(plan.entries).toEqual([]);
  });
  it('dates founding corrections on the last day before the bank started, later ones on their day, and blocks a closed month', () => {
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
    ], docs: [doc('u', { paymentMethod: 'owner_current', amount: 75 })], decisions: { 'variable:u': { decision: 'hadi' } } });
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
  it('treats the cutoff as the first bank day: the founding period is strictly before it', () => {
    expect(dayBefore('2026-10-01')).toBe('2026-09-30');
    expect(dayBefore('2026-03-01')).toBe('2026-02-28');
    const plan = foundingPlan({ settings: { cutoffDate: '2026-09-15' }, docs: [doc('before', { date: '2026-09-14' }), doc('on', { date: '2026-09-15' })] });
    expect(plan.rows.filter(r => r.founding).map(r => r.sourceId)).toEqual(['before']);
    expect(plan.settings.foundingEnd).toBe('2026-09-14');
  });
});

describe('the founding-period default rule', () => {
  const complete = { fundingType: 'company_cash', paymentMethod: 'cash', paidDate: '2026-09-01' };
  const docs = () => [
    doc('open', { amount: 120 }),
    doc('posted', { protected: true, amount: 300, paymentMethod: 'transfer', paidDate: '2026-08-02', date: '2026-08-02', effect: { cash: 0, bank: 30000, payable: 0 } }),
    doc('owed', { protected: true, amount: 50, paymentMethod: 'credit', effect: { cash: 0, bank: 0, payable: 5000 } }),
    doc('vat', { protected: true, amount: 115, vatQuarter: '2026-Q3', effect: { cash: 11500, bank: 0 } }),
    doc('june', { amount: 40, date: '2026-06-10' }),
    doc('reviewed', { ...complete, amount: 999 }),
    doc('excepted', { protected: true, amount: 70, effect: { cash: 7000, bank: 0 } }),
    doc('late', { date: '2026-10-03' }),
  ];
  const decisions = { 'variable:excepted': { decision: 'custody', custodian: 'سالم' } };
  it('lists every undecided founding document missing funding, paid date or method, and previews without saving', () => {
    expect(ruleGaps(doc('x'))).toEqual(['حساب التمويل', 'تاريخ الدفع']);
    expect(ruleGaps(doc('x', complete))).toEqual([]);
    const plan = foundingPlan({ docs: docs(), decisions, closedMonths: new Set(['2026-06']) });
    const rule = plan.rule;
    expect(rule.candidates.map(c => [c.sourceId, c.action])).toEqual([
      ['open', 'update'], ['posted', 'entry'], ['owed', 'entry'], ['vat', 'entry'], ['june', 'blocked']]);
    expect(rule).toMatchObject({ count: 5, total: 625, unposted: { count: 2, amount: 160 }, posted: { count: 3, amount: 465 }, held: 1, blocked: 1 });
    expect(rule.updates.find(u => u.key === 'variable:open').patch).toEqual({ fundingType: 'owner_current', paymentMethod: 'founding_personal', paidDate: '2026-09-01' });
    expect(rule.entries.map(e => [e.sourceKey, e.date, e.status, e.lines.map(l => [l.accountId, l.debit, l.credit])])).toEqual([
      ['variable:posted', '2026-09-30', 'proposed', [['1020', 300, 0], ['2300', 0, 300]]],
      ['variable:owed', '2026-09-30', 'proposed', [['2000', 50, 0], ['2300', 0, 50]]],
      ['variable:vat', '2026-09-30', 'held_vat', [['1010', 115, 0], ['2300', 0, 115]]],
    ]);
    expect(rule.lines).toEqual([{ accountId: '1010', debit: 115, credit: 0 }, { accountId: '1020', debit: 300, credit: 0 },
      { accountId: '2000', debit: 50, credit: 0 }, { accountId: '2300', debit: 0, credit: 465 }]);
    // Nothing of the rule is in the plan itself until it is applied.
    expect(plan.entries.map(e => e.sourceKey)).toEqual(['variable:excepted']);
    expect(plan.entries[0].lines.map(l => [l.accountId, l.debit, l.credit])).toEqual([['1010', 70, 0], ['1300', 0, 70]]);
  });
  it('after it is applied the documents carry it: updates to run, entries to approve, and no candidates left', () => {
    const applied = { ...decisions, ...Object.fromEntries(['open', 'posted', 'owed', 'vat', 'june'].map(id => [`variable:${id}`, { decision: 'founding_rule' }])) };
    const plan = foundingPlan({ docs: docs(), decisions: applied, closedMonths: new Set(['2026-06']) });
    expect(plan.rule.count).toBe(0);
    expect(plan.rule.pendingUpdates).toEqual(['variable:open']);
    expect(plan.updates.find(u => u.key === 'variable:june')).toMatchObject({ source: 'rule', blocked: true });
    expect(plan.entries.filter(e => e.status === 'proposed').map(e => e.sourceKey)).toEqual(['variable:posted', 'variable:owed', 'variable:excepted']);
    expect(plan.entries.find(e => e.sourceKey === 'variable:posted').description).toContain('دفع شخصي - فترة التأسيس');
    expect(plan.hadi.pending.filter(p => p.status === 'unposted').map(p => p.key)).toEqual(['variable:june', 'variable:open']);
  });
  it('turns exceptions into the matching funding: a partner capital account or the custody account', () => {
    const plan = foundingPlan({ docs: [doc('p', { amount: 80 }), doc('c', { amount: 90 })], partners: [{ id: 'p1', name: 'أ' }],
      decisions: { 'variable:p': { decision: 'partner', partnerId: 'p1' }, 'variable:c': { decision: 'custody', custodian: 'سالم' } } });
    expect(plan.updates.map(u => u.patch)).toEqual([
      { fundingType: 'partner', paymentMethod: 'partner_paid', fundingPartnerId: 'p1', paidDate: '2026-09-01' },
      { fundingType: 'custody', paymentMethod: 'custody', custodian: 'سالم', paidDate: '2026-09-01' }]);
    expect(plan.exceptions.map(e => [e.key, e.payer, e.partnerName, e.custodian])).toEqual([['variable:p', 'partner', 'أ', null], ['variable:c', 'custody', null, 'سالم']]);
    expect(plan.rule.count).toBe(0);
  });
  it('keeps the old «manager attested» acceptance apart from who paid', () => {
    const plan = foundingPlan({ docs: [doc('s', { amount: 50 })], decisions: { 'variable:s': { decision: 'manager_attested' } } });
    expect(plan.groups.small[0]).toMatchObject({ attested: true, payer: null });
    expect(plan.rule.candidates.map(c => c.sourceId)).toEqual(['s']);
  });
});

describe('Hadi’s current account against his statement', () => {
  const base = { docs: [doc('a', { amount: 1000 }), doc('b', { amount: 500 })], decisions: { 'variable:a': { decision: 'founding_rule' }, 'variable:b': { decision: 'founding_rule' } } };
  it('waits for a marked personal statement before proposing anything', () => {
    expect(foundingPlan(base).comparison).toMatchObject({ byDocuments: 1500, byStatement: 0, status: 'needs_statement', entry: null });
  });
  it('proposes one entry on 3200 for the difference, dated the last founding day', () => {
    const lines = [line('l1', { amount: 1000, decision: 'document', linkKind: 'variable', linkId: 'a' }), line('l2', { amount: 200, decision: 'transfer' }),
      line('l3', { direction: 'credit', amount: 300, decision: 'partner_payment', linkKind: 'partner_payment', linkId: 'p' }), line('late', { txDate: '2026-10-05', amount: 999 })];
    const payments = [{ key: 'partner_payment:p', id: 'p', partnerName: 'أ', amount: 300, date: '2026-09-02', protected: true, effect: { cash: 0, bank: 30000 } }];
    const plan = foundingPlan({ ...base, lines, payments });
    expect(plan.comparison).toMatchObject({ paid: 1500, transfers: 200, received: 300, byDocuments: 1400, statementLines: 3, statementOut: 1200, statementIn: 300,
      byStatement: 900, difference: 500, status: 'proposed' });
    expect(plan.comparison.entry).toMatchObject({ key: 'hadi_statement:2026-10-01', date: '2026-09-30', type: 'hadi_statement' });
    expect(plan.comparison.entry.lines.map(l => [l.accountId, l.debit, l.credit])).toEqual([['2300', 500, 0], ['3200', 0, 500]]);
    expect(plan.entries.some(e => e.key === 'hadi_statement:2026-10-01')).toBe(true);
    const less = foundingPlan({ ...base, lines: [line('l1', { amount: 2000 })] });
    expect(less.comparison.entry.lines.map(l => [l.accountId, l.debit, l.credit])).toEqual([['3200', 500, 0], ['2300', 0, 500]]);
    expect(foundingPlan({ ...base, lines: [line('l1', { amount: 1500 })] }).comparison).toMatchObject({ status: 'balanced', entry: null });
  });
});

