import { describe, expect, it } from 'vitest';
import { financeWorkbench } from '../financeWorkbench.js';
import { foundingEntryId } from '../foundingSettlement.js';
import { workbenchCounters } from '../../src/lib/financeWorkbenchView.js';
import { memoryFinanceDb } from './financeFixtures.js';

const auth = { uid: 'test-admin' };
const doc = (date, method, extra = {}) => ({ expense_name: `مستند ${date}`, total_variable_cost: 100, logged_date: date, category_id: 'test-category',
  quantity: 1, unit_cost: 100, payment_method: method, payment_status: 'paid', paid_date: date, ...extra });
const entry = (id, date, account, number) => ({ entryDate: date, sourceType: 'expense', sourceKind: 'variable', sourceId: id, status: 'posted', entryNumber: number,
  lines: [{ accountId: '5100', debit: 100, credit: 0 }, { accountId: account, debit: 0, credit: 100 }] });
const correction = (id, number, overrides = {}) => ({ entryDate: '2026-09-30', sourceType: 'adjustment', sourceKind: 'founding_document',
  sourceId: foundingEntryId(`doc:variable:${id}`), status: 'posted', entryNumber: number,
  foundingEntry: { key: `doc:variable:${id}`, type: 'document', sourceKey: `variable:${id}` },
  lines: [{ accountId: '1010', debit: 100, credit: 0 }, { accountId: '2300', debit: 0, credit: 100 }], ...overrides });
function seed() {
  const data = { 'users/test-admin': { role: 'admin' }, 'variable_expense_categories/test-category': {},
    'app_settings/accounting': { value: { vatRegistered: false } }, 'chart_of_accounts/5100': {}, 'chart_of_accounts/1010': {}, 'chart_of_accounts/2300': {} };
  const posted = (id, row, account, number) => {
    data[`variable_expenses/${id}`] = row;
    data[`journal_entries/je_${id}`] = entry(id, row.logged_date, account, number);
    data[`posting_locks/variable__${id}`] = { entryId: `je_${id}`, entryNumber: number };
  };
  // Paid «دفع شخصي - فترة التأسيس», posted on 2300.
  posted('v8', doc('2026-08-10', 'founding_personal'), '2300', 8);
  // Posted on cash, then a posted «تصحيح جهة دفع» from the founding settlement moved it to 2300.
  posted('v9', doc('2026-08-11', 'cash'), '1010', 9);
  data[`journal_entries/${foundingEntryId('doc:variable:v9')}`] = correction('v9', 20);
  // After the cutoff: not a founding-period record.
  posted('v10', doc('2026-10-05', 'founding_personal'), '2300', 10);
  // Its correction was reversed: no longer moved to 2300.
  posted('v11', doc('2026-08-12', 'cash'), '1010', 11);
  data[`journal_entries/${foundingEntryId('doc:variable:v11')}`] = correction('v11', 21, { status: 'reversed', reversedBy: 'rev21' });
  // Proven by a receipt, as before.
  posted('v12', doc('2026-08-13', 'cash', { finance_metadata: { fundingType: 'company_cash', fundingReference: 'إيصال الصندوق', evidenceRefs: ['r12'] } }), '1010', 12);
  // «دفع شخصي» on the record, but its entry credits the cash box and nothing moved it: not proven.
  posted('v13', doc('2026-08-14', 'founding_personal'), '1010', 13);
  return data;
}
const read = (db, sourceId) => financeWorkbench(db, auth, { action: 'read', kind: 'variable', sourceId });

describe('founding-period payment proven by the manager’s rule', () => {
  it('marks a posted founding record on 2300 complete, apart from proof by a statement or a receipt, without writing anything', async () => {
    const db = memoryFinanceDb(seed()), before = structuredClone([...db.rows]);
    const v8 = await read(db, 'v8'), v9 = await read(db, 'v9');
    expect(v8).toMatchObject({ workflowStage: 'complete', paymentProven: true, paymentProof: 'founding_rule', paymentRule: 'own_entry' });
    expect(v9).toMatchObject({ workflowStage: 'complete', paymentProven: true, paymentProof: 'founding_rule', paymentRule: 'payment_correction' });
    expect(v8.workflowDimensions.payment).toMatchObject({ proven: true, basis: 'founding_rule', label: 'مثبت بإقرار المدير — قاعدة فترة التأسيس' });
    const v12 = await read(db, 'v12');
    expect(v12).toMatchObject({ workflowStage: 'complete', paymentProof: 'evidence', paymentRule: null });
    expect(v12.workflowDimensions.payment).toMatchObject({ basis: 'evidence', label: 'مثبت بكشف أو إيصال' });
    for (const id of ['v10', 'v11', 'v13']) {
      expect(await read(db, id)).toMatchObject({ workflowStage: 'posted_unproven', paymentProven: false, paymentProof: null });
    }
    // Counted under «مكتمل» in the list, and nothing stored changed.
    const browse = await financeWorkbench(db, auth, { action: 'browse' });
    const complete = browse.items.filter(item => item.workflowStage === 'complete').map(item => item.sourceId).sort();
    expect(complete).toEqual(['v12', 'v8', 'v9']);
    expect(browse.items.find(item => item.sourceId === 'v9').workflowDimensions.payment.basis).toBe('founding_rule');
    expect(workbenchCounters(browse.items).complete).toMatchObject({ count: 3 });
    expect([...db.rows]).toEqual(before);
  });

  it('follows the founding cutoff saved in the settlement', async () => {
    const data = seed();
    data['founding_review/current'] = { cutoffDate: '2026-08-11' };
    const db = memoryFinanceDb(data);
    expect(await read(db, 'v8')).toMatchObject({ workflowStage: 'complete', paymentProof: 'founding_rule' });
    expect(await read(db, 'v9')).toMatchObject({ workflowStage: 'posted_unproven', paymentProof: null });
  });
});
