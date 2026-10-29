import { describe, expect, it } from 'vitest';
import { financeWorkbench } from '../financeWorkbench.js';
import { statementLineId, foundingEntryId, ledgerEffects, custodyCutoffBridge } from '../foundingSettlement.js';
import { financeProblems, financeHash, financeSourceHash } from '../../functions/src/financeReview.js';
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
  it('accepts only a complete custody receipt for the cutoff timing bridge', () => {
    const groupId = 'a'.repeat(64), fundingId = 'funding', expenseId = 'expense';
    const funding = { id: fundingId, status: 'posted', sourceKind: 'custody_reconciliation',
      custodyAnchorMode: 'independent_historical_tranche', custodyHistoricalSettlementId: groupId,
      entryDate: '2026-10-29', lines: [{ accountId: '1300', debit: 100, credit: 0 }, { accountId: '1020', debit: 0, credit: 100 }] };
    const source = { id: 'source', finance_metadata: { fundingType: 'employee', custodyHistoricalSettlementId: groupId } };
    const expense = { id: expenseId, status: 'posted', sourceType: 'expense', sourceKind: 'variable', sourceId: source.id,
      sourceSnapshotHash: 'b'.repeat(64), custodyHistoricalSettlementId: groupId,
      originalPaidDate: '2026-10-02', lines: [{ accountId: '5100', debit: 100, credit: 0 }, { accountId: '1300', debit: 0, credit: 100 }] };
    const result = { groupId, fundingJournalId: fundingId, anchorMode: 'independent_historical_tranche',
      journalIds: [fundingId, expenseId], sourceCount: 1, fundedHalala: 10000, consumedHalala: 10000,
      fundingEvidence: [{ depositRowId: 'test-row', evidenceRef: 'TEST row', deliveryDate: '2026-09-17',
        depositAmount: 100, allocatedAmount: 100 }] };
    const tables = { journal_entries: [funding, expense], variable_expenses: [source],
      finance_workbench_receipts: [{ id: `custody_h_${groupId.slice(0, 40)}`, result,
        sourceHashes: [{ key: `variable:${source.id}`, before: expense.sourceSnapshotHash, after: financeSourceHash(source) }] }],
      posting_locks: [{ id: `custody_reconciliation__${groupId}` },
        { id: `variable__${source.id}`, entryId: expense.id, custodyHistoricalSettlementId: groupId },
        { id: `custody_deposit__${financeHash('test-row').slice(0, 40)}`, depositRowId: 'test-row',
          evidenceRef: 'TEST row', deliveryDate: '2026-09-17', depositAmountHalala: 10000, consumedHalala: 10000 }] };
    expect(custodyCutoffBridge(tables, '2026-09-30')).toMatchObject({
      amounts: { 1020: -10000, 1010: 0, 1300: 10000 }, issues: [] });
    expect(custodyCutoffBridge({ ...tables, finance_workbench_receipts: [] }, '2026-09-30').issues).toHaveLength(1);
    expect(custodyCutoffBridge({ ...tables, posting_locks: [] }, '2026-09-30').issues).toHaveLength(1);
    const legacy = { ...tables, finance_workbench_receipts: [{ id: 'legacy', result: {
      groupId: 'legacy', anchorMode: 'existing_advance', historicalFundingDate: '2026-09-17',
      journalIds: [fundingId, expenseId] } }] };
    expect(custodyCutoffBridge(legacy, '2026-09-30').issues)
      .toEqual(expect.arrayContaining([expect.stringMatching(/عهدة تاريخية قديمة/)]));
  });

  it('keeps employee custody out of direct founding payer and bank-statement decisions', async () => {
    const data = seed();
    data['variable_expenses/v1'].finance_metadata = { fundingType: 'employee' };
    const db = memoryFinanceDb(data);
    await expect(call(db, { action: 'decide', sourceKey: 'variable:v1', decision: 'hadi', confirm: true }))
      .rejects.toThrow(/العهدة/);
    const suggested = await call(db, { action: 'statementSuggest', account: 'personal', rows: [
      { txDate: '2026-09-06', direction: 'debit', amount: 230, description: 'synthetic', reference: '', balance: null, occurrence: 1 },
    ] });
    expect(suggested.rows[0].documents).toEqual([]);
  });

  it('does not trust a forged settlement marker or posted-looking source fields to release 3200', async () => {
    const data = seed();
    data['variable_expenses/v1'].finance_metadata = { fundingType: 'employee', custodyHistoricalSettlementId: 'a'.repeat(64) };
    data['variable_expenses/v1'].posting_status = 'posted';
    const db = memoryFinanceDb(data);
    await call(db, { action: 'saveSettings', revision: 0, cutoffDate: '2026-09-30', threshold: 500,
      actuals: { bankOpen: true, bankBalance: 0, cash: 0, custody: [] }, confirm: true });
    const read = await call(db, { action: 'read' });
    expect(read.plan.settlement).toMatchObject({ status: 'waiting_custody', unresolvedCustodyCount: 1 });
    db.rows.get('variable_expenses/v1').finance_metadata.fundingType = 'company_bank';
    expect((await call(db, { action: 'read' })).plan.settlement)
      .toMatchObject({ status: 'waiting_custody', unresolvedCustodyCount: 1 });
    await expect(call(db, { action: 'postEntries', reason: 'TEST invalid marker', confirm: true,
      entries: [{ key: 'settlement:2026-09-30', hash: read.plan.settlement.entry.hash }] })).rejects.toThrow();
  });

  it('invalidates an approved founding preview when source or ledger facts change', async () => {
    const db = memoryFinanceDb(seed());
    await call(db, { action: 'decide', sourceKey: 'variable:v3', decision: 'hadi', confirm: true });
    const planned = (await call(db, { action: 'read' })).plan.entries.find(entry => entry.key === 'doc:variable:v3');
    const request = { action: 'postEntries', reason: 'Synthetic approval', confirm: true,
      entries: [{ key: planned.key, hash: planned.hash }] };
    db.rows.get('variable_expenses/v3').supplier = 'TEST changed supplier';
    await expect(call(db, request)).rejects.toThrow(/تغيرت/);
    const updated = (await call(db, { action: 'read' })).plan.entries.find(entry => entry.key === planned.key);
    expect(updated.hash).not.toBe(planned.hash);
    db.rows.set('journal_entries/unrelated', { entryDate: '2026-09-01', status: 'posted', sourceType: 'adjustment',
      lines: [{ accountId: '1020', debit: 1, credit: 0 }, { accountId: '3200', debit: 0, credit: 1 }] });
    await expect(call(db, { ...request, entries: [{ key: updated.key, hash: updated.hash }] })).rejects.toThrow(/تغيرت/);
  });
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
    await call(db, { action: 'saveSettings', revision: 0, cutoffDate: '2026-09-30', threshold: 500, confirm: true,
      actuals: { bankOpen: true, bankBalance: 500, cash: 0, custody: [] } });
    read = await call(db, { action: 'read' });
    expect(read.plan.settlement.status).toBe('waiting');
    const corrections = read.plan.entries.filter(e => e.status === 'proposed');
    await expect(call(db, { action: 'postEntries', reason: 'موافقة اختبار', confirm: true, entries: corrections.map(e => ({ key: e.key, hash: '0'.repeat(64) })) }))
      .rejects.toThrow(/تغيرت/);
    await expect(call(db, { action: 'postEntries', reason: 'موافقة اختبار', confirm: true, entries: [{ key: corrections[0].key, hash: corrections[0].hash }] }, { uid: 'test-accountant' }))
      .rejects.toMatchObject({ code: 'permission-denied' });
    const posted = await call(db, { action: 'postEntries', reason: 'موافقة اختبار', confirm: true, entries: corrections.map(e => ({ key: e.key, hash: e.hash })) });
    expect(posted.posted.map(p => p.entryNumber)).toEqual([10, 11, 12, 13]);
    expect(db.rows.get('counters/journal').nextNumber).toBe(14);
    expect(db.rows.get(`journal_entries/${foundingEntryId('doc:startup:se1')}`)).toMatchObject({ sourceType: 'adjustment', sourceKind: 'founding_document', status: 'posted' });
    await expect(call(db, { action: 'postEntries', reason: 'تكرار', confirm: true, entries: [{ key: corrections[0].key, hash: corrections[0].hash }] })).rejects.toThrow();

    read = await call(db, { action: 'read' });
    // Book after the corrections at the cutoff: bank −5000+5000(pp1)… see lines above; the settlement takes the rest to 3200.
    const settlement = read.plan.settlement;
    expect(settlement.status).toBe('proposed');
    const lines = settlement.entry.lines.map(l => [l.accountId, l.debit, l.credit]);
    expect(lines.find(l => l[0] === '3200')).toBeTruthy();
    expect(lines.reduce((n, l) => n + Math.round(l[1] * 100) - Math.round(l[2] * 100), 0)).toBe(0);
    await call(db, { action: 'postEntries', reason: 'تسوية اختبار', confirm: true, entries: [{ key: settlement.entry.key, hash: settlement.entry.hash }] });
    read = await call(db, { action: 'read' });
    expect(read.plan.settlement.status).toBe('posted');
    // Hadi: paid 1000 + 800 + transferred 2000, received 5000 → he holds 1200 for the project.
    expect(read.plan.hadi.postedBalance).toBe(-1200);
    expect(read.plan.hadi.meaning).toEqual({ kind: 'held_by_hadi', amount: 1200 });
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
});
