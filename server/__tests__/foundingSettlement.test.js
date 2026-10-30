import { describe, expect, it } from 'vitest';
import { financeWorkbench } from '../financeWorkbench.js';
import { statementLineId, foundingEntryId, ledgerEffects } from '../foundingSettlement.js';
import { financeProblems } from '../../functions/src/financeReview.js';
import { ADAPTERS } from '../../functions/src/posting.js';
import { taxPolicyAt } from '../../functions/src/taxPolicy.js';
import { memoryFinanceDb } from './financeFixtures.js';
import { foundingSeed as seed, foundingAuth as auth } from './foundingFixture.js';

const call = (db, request, who = auth) => financeWorkbench(db, who, { kind: 'founding', request });
const rows = [
  { txDate: '2026-08-12', direction: 'debit', amount: 1000, description: 'POS تجهيز', reference: 'r1', balance: null, occurrence: 1 },
  { txDate: '2026-08-03', direction: 'credit', amount: 5000, description: 'حوالة من شريك أ', reference: 'r2', balance: null, occurrence: 1 },
  { txDate: '2026-09-15', direction: 'debit', amount: 75, description: 'بقالة', reference: 'r3', balance: null, occurrence: 1 },
  { txDate: '2026-09-20', direction: 'debit', amount: 2000, description: 'تحويل لحساب الشركة', reference: 'r4', balance: null, occurrence: 1 },
];

async function applyAll(db, { fresh = true } = {}) {
  const suggest = await call(db, { action: 'statementSuggest', account: 'personal', rows });
  if (fresh) {
    expect(suggest.rows[0].documents.map(d => d.key)).toEqual(['startup:se1']);
    expect(suggest.rows[1].payments.map(p => p.key)).toEqual(['partner_payment:pp1']);
    expect(suggest.rows[2].documents).toEqual([]);
  } else expect(suggest.rows.every(r => r.existing?.status === 'applied')).toBe(true);
  return call(db, { action: 'statementApply', account: 'personal', fileName: 'كشف.xlsx', fileHash: 'h', confirm: true, rows: [
    { ...rows[0], decision: 'document', linkKey: 'startup:se1', expense: null },
    { ...rows[1], decision: 'partner_payment', linkKey: 'partner_payment:pp1', expense: null },
    { ...rows[2], decision: 'statement_expense', linkKey: null, expense: { kind: 'variable', classificationId: 'cat1', description: 'بقالة للعمال', supplier: 'بقالة الحي' } },
    { ...rows[3], decision: 'transfer', linkKey: null, expense: null },
  ] });
}

describe('Hadi current account and founding-period settlement', () => {
  it('keeps suggestions read-only, saves only the applied rows, and changes documents only through the workbench', async () => {
    const db = memoryFinanceDb(seed()), before = JSON.stringify([...db.rows]);
    await call(db, { action: 'statementSuggest', account: 'personal', rows });
    await call(db, { action: 'read' });
    expect(JSON.stringify([...db.rows])).toBe(before);
    const result = await applyAll(db);
    expect(result).toMatchObject({ applied: 4, failed: 0 });
    const lines = [...db.rows.keys()].filter(k => k.startsWith('bank_statement_lines/'));
    expect(lines.sort()).toEqual(rows.map(r => `bank_statement_lines/${statementLineId('personal', r)}`).sort());
    const expenseLine = db.rows.get(`bank_statement_lines/${statementLineId('personal', rows[2])}`);
    expect(expenseLine).toMatchObject({ status: 'applied', decision: 'statement_expense', linkKind: 'variable', appliedBy: 'test-admin', appliedByName: 'مدير الاختبار' });
    const created = db.rows.get(`variable_expenses/${expenseLine.linkId}`);
    expect(created).toMatchObject({ payment_method: 'owner_current', payment_status: 'paid', paid_date: '2026-09-15', approval_status: 'pending', total_variable_cost: 75 });
    expect(created.finance_metadata).toMatchObject({ fundingType: 'owner_current', statementLineRef: statementLineId('personal', rows[2]) });
    // The statement line is the document: with a supplier the record is complete for approval.
    expect(financeProblems('variable', created, expenseLine.linkId)).toEqual([]);
    expect(financeProblems('variable', { ...created, supplier: null }, expenseLine.linkId)).toEqual(['المورد غير محدد.']);
    // Posted sources are linked, never edited; nothing was posted.
    expect(db.rows.get('startup_cost_entries/se1').payment_method).toBe('transfer');
    expect(db.rows.get('partner_payments/pp1').payment_method).toBe('bank_transfer');
    expect([...db.rows.keys()].filter(k => k.startsWith('journal_entries/'))).toHaveLength(3);
    // The workbench lists the new record, verified against its statement line.
    const browse = await financeWorkbench(db, auth, { action: 'browse' });
    expect(browse.items.find(i => i.sourceId === expenseLine.linkId)).toMatchObject({ kind: 'variable', amount: 75 });
    const detail = await financeWorkbench(db, auth, { action: 'read', kind: 'variable', sourceId: expenseLine.linkId });
    expect(detail).toMatchObject({ approvalReady: true, issues: [] });
    // Applying the same file again does not save anything twice.
    const again = await applyAll(db, { fresh: false });
    expect(again.results.every(r => r.mode === 'already_applied')).toBe(true);
    expect([...db.rows.keys()].filter(k => k.startsWith('variable_expenses/'))).toHaveLength(4);
  });

  it('refuses a mismatched link without saving the line', async () => {
    const db = memoryFinanceDb(seed());
    const result = await call(db, { action: 'statementApply', account: 'personal', fileName: 'f', fileHash: 'h', confirm: true,
      rows: [{ ...rows[0], amount: 999, decision: 'document', linkKey: 'startup:se1', expense: null }] });
    expect(result.results[0]).toMatchObject({ ok: false });
    expect([...db.rows.keys()].some(k => k.startsWith('bank_statement_lines/'))).toBe(false);
  });

  it('proposes corrections, a settlement on the cutoff, and posts only what was approved', async () => {
    const db = memoryFinanceDb(seed());
    await applyAll(db);
    await call(db, { action: 'decide', sourceKey: 'variable:v3', decision: 'hadi', confirm: true });
    let read = await call(db, { action: 'read' });
    const keys = read.plan.groups;
    // The statement expense is matched to its statement line too.
    expect(keys.matched.map(d => d.key).sort()).toEqual(['startup:se1', `variable:${db.rows.get(`bank_statement_lines/${statementLineId('personal', rows[2])}`).linkId}`].sort());
    expect(keys.small.map(d => d.key).sort()).toEqual(['variable:v1', 'variable:v2']);
    expect(keys.large.map(d => d.key)).toEqual(['variable:v3']);
    expect(keys.partners.map(p => [p.key, p.arrival])).toEqual([['partner_payment:pp1', 'hadi']]);
    const byKey = Object.fromEntries(read.plan.entries.map(e => [e.key, e]));
    expect(byKey['doc:startup:se1']).toMatchObject({ date: '2026-09-30', status: 'proposed' });
    expect(byKey['doc:startup:se1'].lines.map(l => [l.accountId, l.debit, l.credit])).toEqual([['1020', 1000, 0], ['2300', 0, 1000]]);
    expect(byKey['doc:variable:v3'].lines.map(l => [l.accountId, l.debit, l.credit])).toEqual([['1010', 800, 0], ['2300', 0, 800]]);
    expect(byKey['payment:partner_payment:pp1'].lines.map(l => [l.accountId, l.debit, l.credit])).toEqual([['2300', 5000, 0], ['1020', 0, 5000]]);
    const transfer = read.plan.entries.find(e => e.type === 'transfer');
    expect(transfer).toMatchObject({ date: '2026-09-20', status: 'proposed' });
    expect(read.plan.hadi.pending.some(p => p.credit === 75 && p.status === 'unposted')).toBe(true);
    expect(read.accounts.hadi).toBe(true); // created on the first personal apply

    await call(db, { action: 'acceptSmall', keys: ['variable:v1', 'variable:v2'], confirm: true });
    expect(Object.values(Object.fromEntries([...db.rows].filter(([k]) => k.startsWith('founding_decisions/')))).filter(d => d.attested)).toHaveLength(2);
    await call(db, { action: 'saveSettings', revision: 0, cutoffDate: '2026-10-01', threshold: 500, confirm: true,
      actuals: { bankOpen: true, bankBalance: 500, cash: 0, custody: [] } });
    read = await call(db, { action: 'read' });
    expect(read.plan.settlement.status).toBe('waiting');
    // Documents say Hadi paid 1875 + transferred 2000 − received 5000; his marked lines say −1925: v3 (800) is not in them.
    expect(read.plan.comparison).toMatchObject({ byDocuments: -1125, byStatement: -1925, difference: 800, status: 'proposed' });
    const corrections = read.plan.entries.filter(e => e.status === 'proposed' && e.type !== 'hadi_statement');
    await expect(call(db, { action: 'postEntries', reason: 'موافقة اختبار', confirm: true, entries: corrections.map(e => ({ key: e.key, hash: '0'.repeat(64) })) }))
      .rejects.toThrow(/تغيرت/);
    await expect(call(db, { action: 'postEntries', reason: 'موافقة اختبار', confirm: true, entries: [{ key: corrections[0].key, hash: corrections[0].hash }] }, { uid: 'test-accountant' }))
      .rejects.toMatchObject({ code: 'permission-denied' });
    const posted = await call(db, { action: 'postEntries', reason: 'موافقة اختبار', confirm: true, entries: corrections.map(e => ({ key: e.key, hash: e.hash })) });
    expect(posted.posted.map(p => p.entryNumber)).toEqual([10, 11, 12, 13]);
    expect(db.rows.get('counters/journal').nextNumber).toBe(14);
    expect(db.rows.get(`journal_entries/${foundingEntryId('doc:startup:se1')}`)).toMatchObject({ sourceType: 'adjustment', sourceKind: 'founding_document', status: 'posted', entryDate: '2026-09-30' });
    await expect(call(db, { action: 'postEntries', reason: 'تكرار', confirm: true, entries: [{ key: corrections[0].key, hash: corrections[0].hash }] })).rejects.toThrow();

    read = await call(db, { action: 'read' });
    // The settlement takes what is left on the bank (book after corrections vs 500) to 3200.
    const settlement = read.plan.settlement;
    expect(settlement.status).toBe('proposed');
    const lines = settlement.entry.lines.map(l => [l.accountId, l.debit, l.credit]);
    expect(lines.find(l => l[0] === '3200')).toBeTruthy();
    expect(lines.reduce((n, l) => n + Math.round(l[1] * 100) - Math.round(l[2] * 100), 0)).toBe(0);
    const comparison = read.plan.comparison.entry;
    expect(comparison.lines.map(l => [l.accountId, l.debit, l.credit])).toEqual([['2300', 800, 0], ['3200', 0, 800]]);
    await call(db, { action: 'postEntries', reason: 'تسوية اختبار', confirm: true, entries: [settlement.entry, comparison].map(e => ({ key: e.key, hash: e.hash })) });
    read = await call(db, { action: 'read' });
    expect(read.plan.settlement.status).toBe('posted');
    expect(read.plan.comparison.status).toBe('posted');
    expect(db.rows.get(`journal_entries/${foundingEntryId(comparison.key)}`)).toMatchObject({ sourceKind: 'founding_hadi_statement', entryDate: '2026-09-30' });
    // Hadi: paid 1000 + 800 + transferred 2000, received 5000, then aligned to his statement (−800) → he holds 2000;
    // with the unposted 75 from the statement, exactly his statement's −1925.
    expect(read.plan.hadi.postedBalance).toBe(-2000);
    expect(read.plan.hadi.projectedBalance).toBe(-1925);
    expect(read.plan.hadi.meaning).toEqual({ kind: 'held_by_hadi', amount: 2000 });
  });

  it('holds a document whose input VAT was in a filed quarter until it is marked reviewed', async () => {
    const data = seed();
    data['journal_entries/je3'].lines = [{ accountId: '5100', debit: 695.65, credit: 0 }, { accountId: '1200', debit: 104.35, credit: 0 }, { accountId: '1010', debit: 0, credit: 800 }];
    const db = memoryFinanceDb(data);
    await call(db, { action: 'decide', sourceKey: 'variable:v3', decision: 'hadi', confirm: true });
    let read = await call(db, { action: 'read' });
    expect(read.plan.vatTouching.map(v => [v.key, v.quarter, v.reviewed])).toEqual([['variable:v3', '2026-Q3', false]]);
    expect(read.plan.entries.find(e => e.key === 'doc:variable:v3').status).toBe('held_vat');
    await call(db, { action: 'decide', sourceKey: 'variable:v3', vatReviewed: true, confirm: true });
    read = await call(db, { action: 'read' });
    expect(read.plan.entries.find(e => e.key === 'doc:variable:v3').status).toBe('proposed');
    expect(Object.values(Object.fromEntries([...db.rows].filter(([k]) => k.startsWith('founding_decisions/'))))[0]).toMatchObject({ decision: 'hadi', vatReviewed: true });
  });

  it('follows owner-approved cash/bank corrections into each source effect', () => {
    const effects = ledgerEffects([
      { id: 'a', status: 'posted', sourceType: 'expense', sourceId: 'x', lines: [{ accountId: '5100', debit: 100, credit: 0 }, { accountId: '1010', debit: 0, credit: 100 }] },
      { id: 'b', status: 'posted', sourceType: 'adjustment', cashBankCorrection: { sources: [{ source: 'expense:x', netCashCreditHalala: 10000 }] },
        lines: [{ accountId: '1010', debit: 100, credit: 0 }, { accountId: '1020', debit: 0, credit: 100 }] },
    ]);
    expect(effects.get('expense:x')).toMatchObject({ cash: 0, bank: 10000 });
  });

  it('applies the founding-period default rule only on approval, with exceptions, and never posts by itself', async () => {
    const data = seed();
    data['variable_expenses/v4'] = { expense_name: 'وجبات', total_variable_cost: 260, logged_date: '2026-09-07', category_id: 'cat1', quantity: 1, unit_cost: 260, payment_method: 'cash' };
    const db = memoryFinanceDb(data);
    await call(db, { action: 'decide', sourceKey: 'variable:v2', decision: 'custody', custodian: 'سالم', confirm: true });
    await call(db, { action: 'decide', sourceKey: 'variable:v4', decision: 'partner', partnerId: 'p1', confirm: true });
    await expect(call(db, { action: 'decide', sourceKey: 'variable:v1', decision: 'custody', custodian: '', confirm: true })).rejects.toMatchObject({ code: 'invalid-argument' });
    const journalsBefore = [...db.rows.keys()].filter(k => k.startsWith('journal_entries/')).length;
    let read = await call(db, { action: 'read' });
    const rule = read.plan.rule;
    expect(rule.candidates.map(c => [c.key, c.action]).sort()).toEqual([['startup:se1', 'entry'], ['variable:v1', 'update'], ['variable:v3', 'entry']]);
    expect(rule).toMatchObject({ count: 3, total: 2030, unposted: { count: 1, amount: 230 }, posted: { count: 2, amount: 1800 } });
    expect(rule.entries.map(e => e.lines.map(l => [l.accountId, l.debit, l.credit]))).toEqual(
      expect.arrayContaining([[['1020', 1000, 0], ['2300', 0, 1000]], [['1010', 800, 0], ['2300', 0, 800]]]));
    // Reading saved nothing; a stale or forged approval saves nothing either.
    expect([...db.rows.keys()].filter(k => k.startsWith('founding_decisions/'))).toHaveLength(2);
    await expect(call(db, { action: 'applyRule', hash: '0'.repeat(64), confirm: true })).rejects.toThrow(/تغيرت/);
    await expect(call(db, { action: 'applyRule', hash: rule.hash, confirm: true }, { uid: 'test-accountant' })).rejects.toMatchObject({ code: 'permission-denied' });
    expect([...db.rows.keys()].filter(k => k.startsWith('founding_decisions/'))).toHaveLength(2);

    const applied = await call(db, { action: 'applyRule', hash: rule.hash, confirm: true });
    expect(applied).toMatchObject({ applied: 3 });
    // The exceptions saved before the rule run with it.
    expect(applied.updates.sort()).toEqual(['variable:v1', 'variable:v2', 'variable:v4']);
    const decisions = Object.fromEntries([...db.rows].filter(([k]) => k.startsWith('founding_decisions/')).map(([, v]) => [v.sourceKey, v]));
    expect(decisions['variable:v3']).toMatchObject({ decision: 'founding_rule', decidedBy: 'test-admin', decidedByName: 'مدير الاختبار' });
    expect(db.rows.get('founding_review/current').lastRule).toMatchObject({ count: 3, total: 2030, byName: 'مدير الاختبار', cutoffDate: '2026-10-01' });
    expect(db.rows.get('chart_of_accounts/2300')).toMatchObject({ nameArabic: 'حساب هادي الجاري مع المشروع' });
    // The rule changed no document yet, and posted nothing.
    expect(db.rows.get('variable_expenses/v1').payment_method).toBe('cash');
    expect([...db.rows.keys()].filter(k => k.startsWith('journal_entries/'))).toHaveLength(journalsBefore);

    read = await call(db, { action: 'read' });
    expect(read.plan.rule.count).toBe(0);
    expect(read.plan.rule.pendingUpdates.sort()).toEqual(['variable:v1', 'variable:v2', 'variable:v4']);
    const updates = await call(db, { action: 'applyUpdates', keys: ['variable:v1', 'variable:v2', 'variable:v4'], confirm: true });
    expect(updates.results.map(r => [r.key, r.ok])).toEqual([['variable:v1', true], ['variable:v2', true], ['variable:v4', true]]);
    const v1 = db.rows.get('variable_expenses/v1'), v2 = db.rows.get('variable_expenses/v2'), v4 = db.rows.get('variable_expenses/v4');
    expect(v1).toMatchObject({ payment_method: 'founding_personal', payment_status: 'paid', paid_date: '2026-09-05', approval_status: 'pending', updated_by: 'test-admin' });
    expect(v1.finance_metadata).toMatchObject({ fundingType: 'owner_current', fundingReference: 'قاعدة فترة التأسيس (قبل 2026-10-01)' });
    expect(v2.finance_metadata).toMatchObject({ fundingType: 'custody', custodian: 'سالم' });
    expect(v4.finance_metadata).toMatchObject({ fundingType: 'partner', fundingPartnerId: 'p1' });
    expect([...db.rows.values()].filter(v => v.action === 'finance-save' && v.reason === 'تطبيق القاعدة الافتراضية لفترة التأسيس')).toHaveLength(1);
    // When approved and posted later, each lands on its own account.
    const credit = (id, row) => ADAPTERS.variable.build(row, id, { recordDate: ADAPTERS.variable.dateOf(row), policyAt: d => taxPolicyAt(d, { vatRegistered: false }) })
      .lines.find(l => l.credit > 0).accountId;
    expect([credit('v1', v1), credit('v2', v2), credit('v4', v4)]).toEqual(['2300', '1300', '3000-p1']);
    expect(financeProblems('variable', { ...v4, finance_metadata: { ...v4.finance_metadata, fundingPartnerId: null } }, 'v4')).toContain('الشريك الذي دفع غير محدد.');

    read = await call(db, { action: 'read' });
    expect(read.plan.entries.filter(e => e.status === 'proposed').map(e => e.key).sort()).toEqual(['doc:startup:se1', 'doc:variable:v3']);
    expect(read.plan.updates).toEqual([]);
    expect([...db.rows.keys()].filter(k => k.startsWith('journal_entries/'))).toHaveLength(journalsBefore);
  });

  it('works without a personal statement: company transfers, manager-attested expenses, an attested balance, and 3200 only by a written entry', async () => {
    const db = memoryFinanceDb(seed());
    const journals = () => [...db.rows.keys()].filter(k => k.startsWith('journal_entries/')).length, journalsBefore = journals();
    let read = await call(db, { action: 'read' });
    await call(db, { action: 'applyRule', hash: read.plan.rule.hash, confirm: true });
    await call(db, { action: 'saveSettings', revision: Number(db.rows.get('founding_review/current').revision), cutoffDate: '2026-10-01', threshold: 500,
      actuals: null, noPersonalStatement: true, confirm: true });
    // Saving settings keeps what the review already holds.
    expect(db.rows.get('founding_review/current')).toMatchObject({ noPersonalStatement: true, lastRule: { count: 4 } });
    read = await call(db, { action: 'read' });
    expect(read.plan.comparison).toMatchObject({ status: 'off', entry: null });
    expect(read.expenseOptions.variable).toEqual([{ id: 'cat1', label: 'تشغيل' }]);

    // A deposit on the company statement marked as Hadi's transfer.
    const deposit = { txDate: '2026-10-04', direction: 'credit', amount: 3000, description: 'تحويل من هادي', reference: 'c1', balance: null, occurrence: 1 };
    const applied = await call(db, { action: 'statementApply', account: 'company', fileName: 'شركة.xlsx', fileHash: 'h', confirm: true,
      rows: [{ ...deposit, decision: 'transfer', linkKey: null, expense: null }] });
    expect(applied).toMatchObject({ applied: 1, failed: 0 });
    // Partner payments without a statement: decided together.
    await expect(call(db, { action: 'decidePayments', keys: ['partner_payment:nope'], arrival: 'hadi', confirm: true })).rejects.toThrow(/تغيرت/);
    await call(db, { action: 'decidePayments', keys: ['partner_payment:pp1'], arrival: 'hadi', confirm: true });

    // A founding expense with no document, attested by the manager; its closed month stays closed.
    const attest = { action: 'attestExpense', requestId: 'req-attest-1', approxDate: '2026-07-15', amount: 90, description: 'أجرة نقل أغراض السكن',
      kind: 'variable', classificationId: 'cat1', proofUrl: null, note: 'دفعتها كاش من جيبي', confirm: true };
    await expect(call(db, { ...attest, approxDate: '2026-10-02' })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(call(db, attest, { uid: 'test-accountant' })).rejects.toMatchObject({ code: 'permission-denied' });
    const saved = await call(db, attest);
    expect(saved).toMatchObject({ saved: true, kind: 'variable', recordDate: '2026-09-30' });
    const expense = db.rows.get(`variable_expenses/${saved.sourceId}`);
    expect(expense).toMatchObject({ logged_date: '2026-09-30', total_variable_cost: 90, payment_method: 'founding_personal', paid_date: '2026-09-30',
      is_tax_invoice: false, vat_deductible: false, approval_status: 'pending', supplier: null });
    expect(expense.finance_metadata).toMatchObject({ fundingType: 'owner_current', managerAttestation: { by: 'test-admin', byName: 'مدير الاختبار',
      approxDate: '2026-07-15', note: 'دفعتها كاش من جيبي' } });
    // Complete for approval without a supplier or a document; it posts to Hadi's account, with no input VAT.
    expect(financeProblems('variable', expense, saved.sourceId)).toEqual([]);
    expect(financeProblems('variable', { ...expense, is_tax_invoice: true }, saved.sourceId)).toContain('مصروف بإقرار المدير بلا فاتورة ضريبية ولا ضريبة مدخلات.');
    const built = ADAPTERS.variable.build(expense, saved.sourceId, { recordDate: '2026-09-30', policyAt: d => taxPolicyAt(d, { vatRegistered: false }) });
    expect(built.lines.map(l => [l.accountId, l.debit, l.credit])).toEqual([['5100', 90, 0], ['2300', 0, 90]]);
    await expect(call(db, { ...attest, requestId: 'req-attest-2' })).rejects.toMatchObject({ code: 'already-exists' });
    // Nobody records an attestation in another's name, even through the workbench itself.
    const forged = { description: 'مصروف', amount: 10, date: '2026-09-29', quantity: 1, categoryId: 'cat1', isTaxInvoice: false, vatDeductible: false,
      managerAttestation: { by: 'someone-else', byName: 'غيره', atIso: '2026-10-29T10:00:00.000Z', approxDate: '2026-09-29' } };
    const forgedPreview = await financeWorkbench(db, auth, { action: 'previewCapture', kind: 'variable', requestId: 'forged-1', patch: forged }).catch(e => e);
    expect(forgedPreview).toMatchObject({ code: 'permission-denied' });

    read = await call(db, { action: 'read' });
    expect(read.plan.attestedExpenses).toMatchObject([{ sourceId: saved.sourceId, approxDate: '2026-07-15', date: '2026-09-30', byName: 'مدير الاختبار', category: 'تشغيل' }]);
    const balance = read.plan.hadiBalance;
    // Paid by Hadi: the rule's four (2,150) and the attested 90; received 5,000; transferred 3,000 to the company.
    expect(balance).toMatchObject({ paid: 2240, received: 5000, toCompany: 3000, toHadi: 0, net: 240, meaning: { kind: 'owed_to_hadi', amount: 240 },
      undecided: { count: 0, amount: 0 }, attestation: null });
    expect(read.plan.entries.find(e => e.type === 'transfer').lines.map(l => [l.accountId, l.debit, l.credit])).toEqual([['1020', 3000, 0], ['2300', 0, 3000]]);

    // Hadi attests the balance he was shown, with a note.
    await expect(call(db, { action: 'attestBalance', hash: '0'.repeat(64), note: 'راجعته', confirm: true })).rejects.toThrow(/تغيّر/);
    await call(db, { action: 'attestBalance', hash: balance.hash, note: 'راجعت المستندات والتحويلات', confirm: true });
    expect(db.rows.get('founding_review/current').hadiAttestation).toMatchObject({ net: 240, note: 'راجعت المستندات والتحويلات', byName: 'مدير الاختبار' });
    read = await call(db, { action: 'read' });
    expect(read.plan.hadiBalance.attestation).toMatchObject({ net: 240, changed: false });
    expect(read.plan.entries.some(e => e.lines.some(l => l.accountId === '3200'))).toBe(false);

    // 3200 only by an entry with a written reason, posted on approval.
    await call(db, { action: 'proposeAdjustment', amount: 240, direction: 'debit_2300', reason: 'تنازل هادي عن الفرق للمشروع', confirm: true });
    const [adjustment] = db.rows.get('founding_review/current').adjustments;
    expect(adjustment).toMatchObject({ amount: 240, direction: 'debit_2300', byName: 'مدير الاختبار' });
    read = await call(db, { action: 'read' });
    const entry = read.plan.entries.find(e => e.key === `adjustment:${adjustment.id}`);
    expect(entry).toMatchObject({ status: 'proposed', date: '2026-09-30', reason: 'تنازل هادي عن الفرق للمشروع' });
    expect(journals()).toBe(journalsBefore);
    await call(db, { action: 'postEntries', reason: 'موافقة على التنازل', entries: [{ key: entry.key, hash: entry.hash }], confirm: true });
    const posted = db.rows.get(`journal_entries/${foundingEntryId(entry.key)}`);
    expect(posted).toMatchObject({ sourceKind: 'founding_adjustment', foundingEntry: { reason: 'موافقة على التنازل' } });
    expect(posted.lines.map(l => [l.accountId, l.debit, l.credit])).toEqual([['2300', 240, 0], ['3200', 0, 240]]);
    await expect(call(db, { action: 'removeAdjustment', id: adjustment.id, confirm: true })).rejects.toThrow(/مرحّلة/);
    read = await call(db, { action: 'read' });
    expect(read.plan.summary.settlements).toMatchObject([{ status: 'posted', reason: 'موافقة على التنازل', amount: 240 }]);
    expect(read.plan.hadiBalance).toMatchObject({ net: 240, afterAdjustments: 0 });
    // Only the approved adjustment was posted.
    expect(journals()).toBe(journalsBefore + 1);
  });

  it('proposes Hadi’s transfer without a statement and an unposted partner receipt with written reasons, and posts each only on approval', async () => {
    const data = seed();
    data['partner_payments/pp2'] = { partner_id: 'p1', amount: 3000, payment_date: '2026-07-20', payment_method: 'bank_transfer' };
    const db = memoryFinanceDb(data);
    const journals = () => [...db.rows.keys()].filter(k => k.startsWith('journal_entries/')).length, before = journals();
    await expect(call(db, { action: 'proposeTransfer', date: '2026-10-03', amount: 12000, description: 'حوالة لحساب الشركة', reason: 'قصير', confirm: true }))
      .rejects.toMatchObject({ code: 'invalid-argument' });
    await call(db, { action: 'proposeTransfer', date: '2026-10-03', amount: 12000, description: 'حوالة لحساب الشركة', reason: 'بلا كشف شخصي لهذا التحويل', confirm: true });
    await call(db, { action: 'decide', sourceKey: 'partner_payment:pp2', decision: 'hadi', confirm: true });
    let read = await call(db, { action: 'read' });
    expect(read.plan.receipts.map(r => [r.key, r.postingDate])).toEqual([['partner_payment:pp2', '2026-09-30']]);
    await expect(call(db, { action: 'proposeReceipts', keys: ['partner_payment:pp1'], reason: 'وصلت لحسابي', confirm: true })).rejects.toThrow(/تغيرت/);
    await call(db, { action: 'proposeReceipts', keys: ['partner_payment:pp2'], reason: 'وصلت لحسابي الشخصي', confirm: true });
    expect(db.rows.get('founding_review/current')).toMatchObject({ manualTransfers: [{ amount: 12000, reason: 'بلا كشف شخصي لهذا التحويل', byName: 'مدير الاختبار' }],
      receiptProposals: [{ id: 'pp2', reason: 'وصلت لحسابي الشخصي', byName: 'مدير الاختبار' }] });
    read = await call(db, { action: 'read' });
    const transfer = read.plan.entries.find(e => e.key.startsWith('manual_transfer:')), receipt = read.plan.entries.find(e => e.key === 'receipt:partner_payment:pp2');
    expect(transfer).toMatchObject({ status: 'proposed', date: '2026-10-03', account: 'manual' });
    expect(receipt).toMatchObject({ status: 'proposed', date: '2026-09-30', originalDate: '2026-07-20' });
    expect(read.plan.hadiBalance).toMatchObject({ toCompany: 12000, received: 3000 });
    expect(journals()).toBe(before);
    await call(db, { action: 'postEntries', reason: 'موافقة هادي', confirm: true, entries: [transfer, receipt].map(e => ({ key: e.key, hash: e.hash })) });
    const posted = db.rows.get(`journal_entries/${foundingEntryId(transfer.key)}`), postedReceipt = db.rows.get(`journal_entries/${foundingEntryId(receipt.key)}`);
    expect(posted.lines.map(l => [l.accountId, l.debit, l.credit])).toEqual([['1020', 12000, 0], ['2300', 0, 12000]]);
    expect(postedReceipt).toMatchObject({ entryDate: '2026-09-30', sourceType: 'partner_payment', sourceId: 'pp2', sourceKind: 'founding_receipt' });
    expect(postedReceipt.lines.map(l => [l.accountId, l.debit, l.credit])).toEqual([['2300', 3000, 0], ['3000-p1', 0, 3000]]);
    // The receipt carries its own lock: no other path posts it again.
    expect(db.rows.get('posting_locks/partner_payment__pp2')).toMatchObject({ sourceId: 'pp2', entryId: foundingEntryId(receipt.key) });
    read = await call(db, { action: 'read' });
    expect(read.plan.receipts).toEqual([]);
    expect(read.plan.entries.find(e => e.key === receipt.key)).toMatchObject({ status: 'posted', postedReason: 'موافقة هادي' });
    await expect(call(db, { action: 'removeReceipt', key: 'partner_payment:pp2', confirm: true })).rejects.toThrow(/مرحّل/);
    expect(journals()).toBe(before + 2);
    expect([...db.rows.values()].some(v => Array.isArray(v?.lines) && v.lines.some(l => String(l.accountId) === '3200'))).toBe(false);
  });

  it('edits, approves and dates on the last founding day a founding document whose month is closed, the month left closed', async () => {
    const data = seed();
    const complete = { category_id: 'cat1', quantity: 1, supplier: 'مورد', invoice_url: 'https://example.org/july', is_tax_invoice: false, vat_deductible: false,
      price_mode: 'inclusive', payment_method: 'cash', payment_status: 'paid',
      finance_metadata: { fundingType: 'company_cash', fundingReference: 'صندوق', purpose: 'تجهيز', evidenceRefs: ['ref'] } };
    data['variable_expenses/v5'] = { ...complete, expense_name: 'مصروف يوليو', total_variable_cost: 150, unit_cost: 150, logged_date: '2026-07-15', paid_date: '2026-07-15' };
    const db = memoryFinanceDb(data), wb = request => financeWorkbench(db, auth, { kind: 'variable', sourceId: 'v5', ...request });
    let detail = await wb({ action: 'read' });
    expect(detail).toMatchObject({ closed: false, postingDate: '2026-09-30', approvalReady: true });
    expect(detail.postingPreview.entry).toMatchObject({ entryDate: '2026-09-30' });
    expect(detail.postingPreview.entry.description).toContain('قُيّد بآخر يوم في فترة التأسيس');
    // An edit keeps its closed dates; moving them to an open month is refused.
    await expect(wb({ action: 'preview', patch: { date: '2026-08-10', paidDate: '2026-08-10' }, sourceHash: detail.sourceHash })).rejects.toThrow(/يبقى بتاريخه/);
    const preview = await wb({ action: 'preview', patch: { supplier: 'مورد معدّل' }, sourceHash: detail.sourceHash });
    await wb({ action: 'save', patch: { supplier: 'مورد معدّل' }, sourceHash: detail.sourceHash, previewHash: preview.previewHash, reason: 'تصحيح المورد', confirm: true });
    expect(db.rows.get('variable_expenses/v5')).toMatchObject({ supplier: 'مورد معدّل', logged_date: '2026-07-15', approval_status: 'pending' });
    detail = await wb({ action: 'read' });
    await wb({ action: 'approve', sourceHash: detail.sourceHash, postingHash: detail.postingPreview.postingHash, reason: 'اعتماد مستند التأسيس', confirm: true });
    detail = await wb({ action: 'read' });
    expect(detail).toMatchObject({ approved: true, postingDate: '2026-09-30' });
    // A new record is not written into the closed month.
    await expect(financeWorkbench(db, auth, { action: 'previewCapture', kind: 'variable', requestId: 'july-new',
      patch: { description: 'جديد', amount: 10, date: '2026-07-20', quantity: 1, categoryId: 'cat1', invoiceUrl: 'https://example.org/new' } })).rejects.toThrow(/مقفل/);
    // Once the cutoff moves before July, July is no longer founding: closed as before.
    await call(db, { action: 'saveSettings', revision: 0, cutoffDate: '2026-07-01', threshold: 500, actuals: null, confirm: true });
    expect(await wb({ action: 'read' })).toMatchObject({ closed: true, postingDate: null });
  });

  it('marks an unposted founding document «بلا إيصال، بإقرار المدير» on the same record, then approves and posts it to 2300', async () => {
    const data = seed();
    // A July (closed month) tax invoice with no receipt link and no supplier, paid from the company cash.
    data['variable_expenses/v6'] = { expense_name: 'نقل أغراض السكن', total_variable_cost: 115, logged_date: '2026-07-15', category_id: 'cat1', quantity: 1, unit_cost: 115,
      is_tax_invoice: true, vat_deductible: true, vat_amount: 15, vat_rate: 0.15, invoice_number: 'INV-6', invoice_date: '2026-07-15', price_mode: 'inclusive',
      payment_method: 'cash', payment_status: 'paid', finance_metadata: { fundingType: 'company_cash', fundingReference: 'صندوق', purpose: 'تجهيز السكن', evidenceRefs: ['ref'] } };
    data['variable_expenses/v7'] = { expense_name: 'بعد بدء البنك', total_variable_cost: 40, logged_date: '2026-10-05', category_id: 'cat1', quantity: 1, unit_cost: 40, payment_method: 'cash' };
    const db = memoryFinanceDb(data), wb = (sourceId, request, who = auth) => financeWorkbench(db, who, { kind: 'variable', sourceId, ...request });
    const attest = (sourceId, sourceHash, extra = {}) => call(db, { action: 'attestDocument', kind: 'variable', sourceId, sourceHash,
      reason: 'دفعته من حسابي ولم أحتفظ بالإيصال', confirm: true, ...extra }, extra.who);
    const count = () => [...db.rows.keys()].filter(k => k.startsWith('variable_expenses/')).length, documents = count();
    await call(db, { action: 'ensureAccounts', confirm: true });
    let detail = await wb('v6', { action: 'read' });
    expect(detail.founding).toMatchObject({ cutoffDate: '2026-10-01', attestation: null, attestable: true });
    expect(detail.issues).toContain('رابط المستند غير مكتمل.');
    // Founding-period, unposted records only; the record the admin saw; a written reason; the admin only.
    const after = await wb('v7', { action: 'read' });
    expect(after.founding.attestable).toBe(false);
    await expect(attest('v7', after.sourceHash)).rejects.toThrow(/فترة التأسيس/);
    await expect(attest('v3', (await wb('v3', { action: 'read' })).sourceHash)).rejects.toThrow(/مرحّل/);
    await expect(attest('v6', '0'.repeat(64))).rejects.toThrow(/تغيّر/);
    await expect(attest('v6', detail.sourceHash, { reason: 'لا' })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(call(db, { action: 'attestDocument', kind: 'variable', sourceId: 'v6', sourceHash: detail.sourceHash, reason: 'دفعته من حسابي', confirm: true },
      { uid: 'test-accountant' })).rejects.toMatchObject({ code: 'permission-denied' });
    // Nor through the workbench directly on a record after the cutoff.
    const stamp = { by: 'test-admin', byName: 'مدير الاختبار', atIso: '2026-10-30T09:00:00.000Z', approxDate: '2026-10-05', note: 'بلا إيصال' };
    await expect(wb('v7', { action: 'preview', patch: { managerAttestation: stamp }, sourceHash: after.sourceHash })).rejects.toThrow(/فترة التأسيس فقط/);

    const saved = await attest('v6', detail.sourceHash);
    expect(saved).toMatchObject({ saved: true, kind: 'variable', sourceId: 'v6' });
    // The same record, not deleted, no new one: no receipt needed, no tax, paid by Hadi, his name and time kept.
    expect(count()).toBe(documents);
    const row = db.rows.get('variable_expenses/v6');
    expect(row).toMatchObject({ expense_name: 'نقل أغراض السكن', logged_date: '2026-07-15', total_variable_cost: 115, is_tax_invoice: false, vat_deductible: false,
      vat_amount: null, vat_rate: null, payment_method: 'founding_personal', payment_status: 'paid', paid_date: '2026-07-15', approval_status: 'pending' });
    expect(row.invoice_url).toBeUndefined();
    expect(row.finance_metadata).toMatchObject({ fundingType: 'owner_current', fundingReference: 'إقرار المدير — مدير الاختبار', purpose: 'تجهيز السكن',
      evidenceRefs: ['ref', 'founding:attestation'], managerAttestation: { by: 'test-admin', byName: 'مدير الاختبار', approxDate: '2026-07-15', note: 'دفعته من حسابي ولم أحتفظ بالإيصال' } });
    expect(row.finance_metadata.managerAttestation.atIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const audit = [...db.rows.entries()].find(([k, v]) => k.startsWith('audit_logs/') && v.sourceId === 'v6');
    expect(audit[1]).toMatchObject({ action: 'finance-save', userId: 'test-admin', reason: 'بلا إيصال، بإقرار المدير: دفعته من حسابي ولم أحتفظ بالإيصال' });
    detail = await wb('v6', { action: 'read' });
    expect(detail).toMatchObject({ issues: [], approvalReady: true, postingDate: '2026-09-30',
      founding: { attestable: false, attestation: { byName: 'مدير الاختبار', note: 'دفعته من حسابي ولم أحتفظ بالإيصال', approxDate: '2026-07-15' } } });
    await expect(attest('v6', detail.sourceHash)).rejects.toMatchObject({ code: 'already-exists' });
    // An attested expense is Hadi's: any other funding is flagged.
    expect(financeProblems('variable', { ...row, finance_metadata: { ...row.finance_metadata, fundingType: 'company_cash' }, payment_method: 'cash' }, 'v6'))
      .toContain('مصروف بإقرار المدير دفعه هادي: التمويل من حسابه الجاري (2300).');

    // The summary lists it under «مصاريف بإقرار المدير».
    const read = await call(db, { action: 'read' });
    expect(read.plan.attestedExpenses).toMatchObject([{ sourceId: 'v6', amount: 115, approxDate: '2026-07-15', byName: 'مدير الاختبار' }]);
    expect(read.plan.summary.attestedRows.map(e => e.sourceId)).toEqual(['v6']);
    expect(read.plan.summary.attested).toMatchObject({ count: 1, amount: 115 });

    // Then the usual approval and posting: expense against Hadi's current account, dated the last founding day (July is closed).
    await wb('v6', { action: 'approve', sourceHash: detail.sourceHash, postingHash: detail.postingPreview.postingHash, reason: 'اعتماد بإقرار المدير', confirm: true });
    detail = await wb('v6', { action: 'read' });
    const posted = await wb('v6', { action: 'post', sourceHash: detail.sourceHash, confirm: true });
    expect(posted.verification).toMatchObject({ verified: true, linesMatched: true });
    const entry = db.rows.get(`journal_entries/${posted.verification.journalIds[0]}`);
    expect(entry).toMatchObject({ entryDate: '2026-09-30', sourceId: 'v6', status: 'posted' });
    expect(entry.lines.map(l => [l.accountId, l.debit, l.credit])).toEqual([['5100', 115, 0], ['2300', 0, 115]]);
    expect(db.rows.get('accounting_periods/2026-07').status).toBe('closed');
  });
});
