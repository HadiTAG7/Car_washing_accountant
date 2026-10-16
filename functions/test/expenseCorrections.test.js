import { describe, it, expect } from 'vitest';
import { dispatch } from '../src/handlers.js';
import { previewExpenseCorrection, saveExpenseCorrection, recordWorkerAdvance } from '../src/expenseCorrections.js';
const FV = { serverTimestamp: () => 'test-server-time' };
function fixture() {
  const rows = new Map([
    ['users/admin', { role: 'admin' }], ['users/accountant', { role: 'accountant' }], ['users/operator', { role: 'operator' }], ['users/partner', { role: 'partner' }], ['users/supervisor', { role: 'supervisor' }],
    ['variable_expenses/e1', { expense_name: 'Synthetic phone stands', quantity: 1, unit_cost: 665.05, total_variable_cost: 665.05, logged_date: '2026-09-12', is_tax_invoice: true, supplier: 'Synthetic supplier', invoice_number: 'T-1', invoice_date: '2026-09-12', vat_amount: 86.75, invoice_url: 'https://example.test/invoice', payment_method: 'cash' }],
    ['startup_costs/bikes', { item_name: 'Synthetic bikes', budgeted_amount: 1000, actual_amount: 0, units: [] }],
    ['startup_costs/housing', { item_name: 'Synthetic housing', budgeted_amount: 5000, actual_amount: 0, units: ['East'] }],
    ['annual_expenses/insurance', { annual_cost: 1000, actual_amount: 0 }],
    ['bikers/b1', { name: 'Synthetic worker' }],
    ['variable_expense_categories/parts', { label: 'Parts' }],
  ]);
  const writes = []; let auto = 0;
  const snap = path => ({ id: path.split('/').at(-1), ref: ref(path), exists: rows.has(path), data: () => structuredClone(rows.get(path)) });
  const ref = path => ({ id: path.split('/').at(-1), path, get: async () => snap(path), collection: name => collection(`${path}/${name}`) });
  const collection = (path, filters = []) => ({
    doc: id => ref(`${path}/${id ?? `auto-${++auto}`}`),
    where: (field, op, value) => { if (op !== '==') throw Error('unsupported test query'); return collection(path, [...filters, [field, value]]); },
    get: async () => { const docs = [...rows].filter(([key, value]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/') && filters.every(([f, v]) => value[f] === v)).map(([key]) => snap(key)); return { docs, empty: !docs.length }; },
  });
  return { rows, writes, collection, runTransaction: async callback => {
    const pending = []; let writing = false;
    const result = await callback({ get: async reference => { if (writing) throw Error('read after write'); return reference.get(); },
      set: (reference, value) => { writing = true; pending.push(['set', reference.path, value]); },
      update: (reference, value) => { writing = true; pending.push(['update', reference.path, value]); },
      delete: reference => { writing = true; pending.push(['delete', reference.path]); },
    });
    for (const [kind, path, value] of pending) { if (kind === 'delete') rows.delete(path); else rows.set(path, kind === 'update' ? { ...rows.get(path), ...structuredClone(value) } : structuredClone(value)); writes.push(path); }
    return result;
  } };
}
const move = { kind: 'variable', sourceId: 'e1', targetKind: 'startup', targetParentId: 'bikes', patch: { quantity: 50 }, reason: 'Owner requested reclassification' };
const save = (db, p, extra = {}) => saveExpenseCorrection(db, FV, { ...move, previewHash: p.previewHash, confirm: true, ...extra }, { userId: 'admin' });
describe('expense correction transaction', () => {
  it('preview writes nothing; atomic move preserves invoice, VAT, amount and actual units; audited receipt replay has no duplicate', async () => {
    const db = fixture(), p = await previewExpenseCorrection(db, move);
    expect(db.writes).toEqual([]);
    expect(p.after).toMatchObject({ quantity: 50, unit_cost: 13.301, amount: 665.05, vat_amount: 86.75, invoice_number: 'T-1' });
    const result = await save(db, p), writeCount = db.writes.length;
    expect(db.rows.has('variable_expenses/e1')).toBe(false);
    expect(db.rows.get(`startup_cost_entries/${result.id}`)).toMatchObject(p.after);
    expect(db.rows.get('startup_costs/bikes')).toMatchObject({ actual_amount: 665.05, status: 'in_progress' });
    expect(db.rows.get(`audit_logs/${result.auditId}`)).toMatchObject({ action: 'expense-correction', userId: 'admin', before: p.before, after: p.after });
    expect(await save(db, p)).toMatchObject({ saved: true, replay: true, id: result.id });
    expect(db.writes).toHaveLength(writeCount);
    expect(db.writes.some(path => /journal|posting_locks/.test(path))).toBe(false);
    await expect(save(db, p, { patch: { quantity: 49 } })).rejects.toThrow(/تغير الطلب/);
  });
  it.each(['source', 'parent', 'siblings'])('stale %s invalidates preview with zero writes', async change => {
    const db = fixture(), p = await previewExpenseCorrection(db, move);
    if (change === 'source') db.rows.get('variable_expenses/e1').vat_amount = 86;
    if (change === 'parent') db.rows.get('startup_costs/bikes').budgeted_amount = 2000;
    if (change === 'siblings') db.rows.set('startup_cost_entries/new', { startup_cost_id: 'bikes', amount: 2 });
    await expect(save(db, p)).rejects.toThrow(/تغيّر/); expect(db.writes).toEqual([]);
  });
  it.each(['variable__e1', 'expense__e1'])('refuses current/legacy posting lock %s', async lock => {
    const db = fixture(); db.rows.set(`posting_locks/${lock}`, {});
    await expect(previewExpenseCorrection(db, move)).rejects.toThrow(/مرحّل/); expect(db.writes).toEqual([]);
  });
  it('refuses posted journal even if lock missing and refuses closed original/invoice/new periods', async () => {
    const db = fixture(); db.rows.set('journal_entries/j1', { sourceId: 'e1', status: 'posted' });
    await expect(previewExpenseCorrection(db, move)).rejects.toThrow(/أثر دفتري/);
    db.rows.delete('journal_entries/j1'); db.rows.set('accounting_periods/2026-09', { status: 'closed' });
    await expect(previewExpenseCorrection(db, { ...move, patch: { date: '2026-10-01' } })).rejects.toThrow(/مقفلة/);
    expect(db.writes).toEqual([]);
  });
  it('validates parent/unit/category/fields/quantities and preserves taxed total', async () => {
    const db = fixture();
    for (const request of [
      { ...move, targetParentId: 'missing' }, { ...move, targetParentId: 'housing', patch: { unit: 'West' } },
      { ...move, patch: { quantity: 0 } }, { ...move, patch: { vat_amount: 1 } }, { ...move, patch: { amount: 1 } },
      { ...move, patch: { date: '2026-02-30' } }, { ...move, targetKind: 'variable', targetParentId: undefined, patch: { categoryId: 'missing' } },
    ]) await expect(previewExpenseCorrection(db, request)).rejects.toThrow();
    expect(db.writes).toEqual([]);
  });
  it('moves annual payment with transactional old/new rollups and supports same-parent unit-count correction', async () => {
    const db = fixture();
    db.rows.set('annual_expense_entries/a1', { annual_expense_id: 'insurance', description: 'Synthetic annual', amount: 200, spent_date: '2026-09-01' });
    db.rows.get('annual_expenses/insurance').actual_amount = 200;
    const request = { kind: 'annual', sourceId: 'a1', targetKind: 'startup', targetParentId: 'bikes', reason: 'Correction', patch: { quantity: 50 } };
    const p = await previewExpenseCorrection(db, request);
    const r = await saveExpenseCorrection(db, FV, { ...request, previewHash: p.previewHash, confirm: true }, { userId: 'admin' });
    expect(db.rows.get('annual_expenses/insurance').actual_amount).toBe(0);
    expect(db.rows.get('startup_costs/bikes').actual_amount).toBe(200);
    const edit = { kind: 'startup', sourceId: r.id, patch: { quantity: 25 }, reason: 'Quantity correction' };
    const p2 = await previewExpenseCorrection(db, edit);
    await saveExpenseCorrection(db, FV, { ...edit, previewHash: p2.previewHash, confirm: true }, { userId: 'admin' });
    expect(db.rows.get('startup_costs/bikes').actual_amount).toBe(200);
    expect(db.rows.get(`startup_cost_entries/${r.id}`).unit_cost).toBe(8);
  });
  it('refuses legacy parent spend rather than overwriting it', async () => {
    const db = fixture(); db.rows.get('startup_costs/bikes').actual_amount = 100;
    await expect(previewExpenseCorrection(db, move)).rejects.toThrow(/قديم/);
    expect(db.writes).toEqual([]);
  });
  it('accepts unambiguous legacy YYYY-M-D dates just like the app, without inventing dates or writing in preview', async () => {
    const db = fixture(); db.rows.get('variable_expenses/e1').logged_date = '2026-9-12';
    const plan = await previewExpenseCorrection(db, move);
    expect(plan.after.spent_date).toBe('2026-09-12');
    expect(plan.before.logged_date).toBe('2026-9-12'); expect(db.writes).toEqual([]);
    db.rows.set('accounting_periods/2026-09', { status: 'closed' });
    await expect(previewExpenseCorrection(db, move)).rejects.toThrow(/مقفلة/);
    expect(db.writes).toEqual([]);
  });
  it('refuses a matching invoice already copied into the target category', async () => {
    const db = fixture(); db.rows.set('startup_cost_entries/already', { startup_cost_id: 'bikes', amount: 665.05, invoice_number: 'T-1', supplier: 'Synthetic supplier' });
    await expect(previewExpenseCorrection(db, move)).rejects.toMatchObject({ code: 'already-exists' }); expect(db.writes).toEqual([]);
  });
  it('requires confirmation, fingerprint and reason', async () => {
    const db = fixture(), p = await previewExpenseCorrection(db, move);
    for (const extra of [{ confirm: false }, { previewHash: '' }, { reason: '' }]) await expect(save(db, p, extra)).rejects.toThrow();
    expect(db.writes).toEqual([]);
  });
  it.each(['operator', 'partner', 'supervisor'])('server denies %s even with admin payload claim', async role => {
    const db = fixture(); await expect(dispatch(db, FV, 'expensePreviewCorrection', { ...move, role: 'admin' }, { uid: role })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(dispatch(db, FV, 'workerRecordAdvance', {}, { uid: role })).rejects.toMatchObject({ code: 'permission-denied' });
    expect(db.writes).toEqual([]);
  });
});
describe('confirmed worker advances', () => {
  const request = { bikerId: 'b1', amount: 33, spentDate: '2026-10-01', assignmentMonth: '2026-09', paymentMethod: 'cash', description: 'Owner confirmed September advance', requestId: 'advance-1' };
  const advance = (db, extra) => recordWorkerAdvance(db, FV, { ...request, ...extra }, { userId: 'admin' });
  it('preview is read-only; saves explicit payroll month independently of spend date, audits and retries safely', async () => {
    const db = fixture(); expect(await advance(db)).toMatchObject({ preview: true, row: { assignment_month: '2026-09' } }); expect(db.writes).toEqual([]);
    const r = await advance(db, { confirm: true }), count = db.writes.length;
    expect(db.rows.get(`temporary_expenses/${r.id}`)).toMatchObject({ amount: 33, status: 'pending', recovered_amount: 0, assignment_month: '2026-09' });
    expect(await advance(db, { confirm: true })).toMatchObject({ replay: true, id: r.id }); expect(db.writes).toHaveLength(count);
    await expect(advance(db, { confirm: true, amount: 34 })).rejects.toThrow(/مفتاح/);
    await expect(advance(db, { confirm: true, requestId: 'different' })).rejects.toThrow(/مطابقة/);
    expect(db.writes.some(path => /journal|posting_locks/.test(path))).toBe(false);
  });
  it.each([{ amount: -1 }, { assignmentMonth: '2026-13' }, { spentDate: '2026-02-30' }, { spentDate: '2999-01-01' }, { bikerId: 'missing' }, { paymentMethod: 'credit' }, { arbitrary: 1 }])('invalid advance %j has no writes', async extra => {
    const db = fixture(); await expect(advance(db, { ...extra, confirm: true })).rejects.toThrow(); expect(db.writes).toEqual([]);
  });
  it('closed month and non-admin caller are refused', async () => {
    const db = fixture(); db.rows.set('accounting_periods/2026-09', { status: 'closed' });
    await expect(advance(db, { confirm: true })).rejects.toThrow(/مقفلة/);
    await expect(dispatch(db, FV, 'workerRecordAdvance', request, { uid: 'accountant' })).rejects.toMatchObject({ code: 'permission-denied' });
    expect(db.writes).toEqual([]);
  });
  it('does not inject a new advance behind an approved/paid payroll snapshot', async () => {
    const db = fixture(); db.rows.set('payroll_runs/run', { periodKey: '2026-09', status: 'partially_paid' }); db.rows.set('payroll_runs/run/items/b1', { bikerId: 'b1', status: 'paid' });
    await expect(advance(db, { confirm: true })).rejects.toThrow(/معتمد أو مصروف/); expect(db.writes).toEqual([]);
  });
});
