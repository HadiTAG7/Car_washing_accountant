import { describe, expect, it } from 'vitest';
import { previewAdvanceMonth, saveAdvanceMonth } from '../src/advanceMonth.js';
import { calculatePayrollPreview } from '../src/payroll.js';
import { dispatch } from '../src/handlers.js';
import { OWNER_ADVANCE_MONTH_PLAN as PLAN, advanceAssignmentMonth, isAssignmentMonth } from '../../src/lib/advanceMonth.js';
import { mapTemporaryExpense, toTemporaryExpenseInsert } from '../../src/lib/mappers.js';
function fixture(role = 'admin') {
  const rows = new Map([['users/staff', { role }], ['temporary_expenses/september-other', { amount: 4350, spent_date: '2026-09-15', status: 'pending' }]]);
  for (const [id, amount, spent_date, status] of PLAN.rows) rows.set(`temporary_expenses/${id}`, { title: `Synthetic ${id}`, amount, spent_date, status,
    biker_id: null, payment_method: id === PLAN.rows[0][0] ? 'bank' : 'cash', recovered_date: status === 'recovered' ? '2026-10-03' : null, recovered_amount: 0 });
  const writes = []; let queue = Promise.resolve();
  const snap = path => ({ id: path.split('/').at(-1), exists: rows.has(path), data: () => structuredClone(rows.get(path)) });
  const doc = path => ({ id: path.split('/').at(-1), path, get: async () => snap(path), collection: name => coll(`${path}/${name}`) });
  const coll = path => ({ path, doc: id => doc(`${path}/${id}`), get: async () => ({ docs: [...rows.keys()].filter(key => key.startsWith(path + '/') && !key.slice(path.length + 1).includes('/')).map(snap) }) });
  const db = { rows, writes, collection: coll, runTransaction: callback => {
    const task = queue.then(async () => { const pending = []; const result = await callback({ get: ref => ref.get(), set: (ref, value, options) => pending.push([ref.path, value, options]) });
      for (const [path, value, options] of pending) { rows.set(path, options?.merge ? { ...rows.get(path), ...structuredClone(value) } : structuredClone(value)); writes.push(path); } return result;
    }); queue = task.catch(() => {}); return task;
  } }; return db;
}
const FV = { serverTimestamp: () => 'synthetic-server-time' };
const payload = { mode: PLAN.mode };
const source = extra => ({ id: 'a', biker_id: 'b', spent_date: '2026-10-01', amount: 200, status: 'pending', ...extra });
const payroll = (periodKey, advances, extra = {}) => calculatePayrollPreview({ periodKey, bikers: [{ id: 'b', name: 'Worker', salary: 1000, start_date: '2026-08-01' }], advances, washes: [], ...extra });
describe('assignment month and payroll boundaries', () => {
  it('accepts only YYYY-MM and uses only the real payment month for legacy rows', () => {
    expect(isAssignmentMonth('2026-09')).toBe(true);
    for (const value of ['2026-9', '2026-00', '2026-13', '2026-09-01', null]) expect(isAssignmentMonth(value)).toBe(false);
    expect(advanceAssignmentMonth(source())).toBe('2026-10');
    expect(advanceAssignmentMonth(source({ assignment_month: '2026-09' }))).toBe('2026-09');
    expect(advanceAssignmentMonth(source({ assignment_month: '2026-13' }))).toBeNull();
    expect(advanceAssignmentMonth(source({ spent_date: '2026-02-30' }))).toBeNull();
  });
  it('creation separates assignment from payment date and retains debt, amount and bank', () => {
    const inserted = toTemporaryExpenseInsert({ title: 'Advance', amount: 33, spentDate: '2026-10-01', assignmentMonth: '2026-09', bikerId: 'b', paymentMethod: 'bank' });
    expect(inserted).toMatchObject({ assignment_month: '2026-09', spent_date: '2026-10-01', amount: 33, status: 'pending', payment_method: 'bank', biker_id: 'b' });
    expect(mapTemporaryExpense({ id: 'a', ...inserted })).toMatchObject({ assignmentMonth: '2026-09', spentDate: '2026-10-01', amount: 33 });
    expect(() => toTemporaryExpenseInsert({ assignmentMonth: '2026-13' })).toThrow();
  });
  it('does not carry a September debt into October or erase its balance; changed assignment changes only draft deduction', () => {
    const advance = source({ assignment_month: '2026-09' }); const before = structuredClone(advance);
    expect(payroll('2026-10', [advance]).lines[0]).toMatchObject({ advanceOutstanding: 0, advanceDeduction: 0, netDue: 1000 });
    expect(payroll('2026-09', [advance]).lines[0]).toMatchObject({ advanceOutstanding: 200, advanceDeduction: 200, netDue: 800 });
    expect(advance).toEqual(before);
    expect(payroll('2026-10', [source()]).lines[0].advanceDeduction).toBe(200);
    expect(payroll('2026-09', [source()]).lines[0].advanceDeduction).toBe(0);
    expect(payroll('2026-10', [source({ assignment_month: '2026-09' })]).totals.net).toBe(1000);
  });
  it('preserves the4.50 commission, salary, bonus and deduction when filtering advances', () => {
    const washes = [1,2].map(i => ({ id: `w${i}`, biker_id: 'b', quantity: 1, wash_date: '2026-10-03', status: 'مكتملة' }));
    const result = payroll('2026-10', [source({ assignment_month: '2026-09' })], { washes, adjustments: [{ bikerId: 'b', bonus: 20, bonusReason: 'documented', deduction: 10, deductionReason: 'documented' }] });
    expect(result.lines[0]).toMatchObject({ basicDue: 1000, commission: 9, bonus: 20, deduction: 10, advanceDeduction: 0, netDue: 1019 });
  });
});
describe('reviewed assignment corrections', () => {
  it('previews10/599/399 without writing; saves only assignment metadata plus audit and preserves all original facts', async () => {
    const db = fixture(); const before = structuredClone([...db.rows.entries()]); const preview = await previewAdvanceMonth(db, payload);
    expect(preview).toMatchObject({ count: 10, amount: 599, pendingAmount: 399 }); expect(db.writes).toEqual([]);
    const result = await saveAdvanceMonth(db, FV, { ...payload, previewHash: preview.previewHash }, 'staff');
    expect(result).toMatchObject({ saved: true, updated: 10 }); expect(db.writes).toHaveLength(11);
    for (const [path, value] of before) {
      expect(db.rows.get(path)).toMatchObject(value);
      if (PLAN.rows.some(([id]) => path === `temporary_expenses/${id}`)) expect(db.rows.get(path).assignment_month).toBe('2026-09');
      else expect(db.rows.get(path)).toEqual(value);
    }
    expect((await previewAdvanceMonth(db, payload)).rows.every(row => row.already)).toBe(true);
  });
  it('serializes duplicate requests and writes once', async () => {
    const db = fixture(); const p = await previewAdvanceMonth(db, payload);
    const results = await Promise.all([saveAdvanceMonth(db, FV, { ...payload, previewHash: p.previewHash }, 'staff'), saveAdvanceMonth(db, FV, { ...payload, previewHash: p.previewHash }, 'staff')]);
    expect(results.map(row => row.replay)).toEqual([false, true]); expect(db.writes).toHaveLength(11);
  });
  it('reviews a single correction and permits the month to change again with a new audit', async () => {
    const db = fixture(); const input = { mode: 'single', id: PLAN.rows[1][0], assignmentMonth: '2026-09', reason: 'owner correction' };
    const p = await previewAdvanceMonth(db, input); await saveAdvanceMonth(db, FV, { ...input, previewHash: p.previewHash }, 'staff');
    const next = { ...input, assignmentMonth: '2026-10' }; const p2 = await previewAdvanceMonth(db, next);
    await saveAdvanceMonth(db, FV, { ...next, previewHash: p2.previewHash }, 'staff');
    expect(db.rows.get(`temporary_expenses/${input.id}`).assignment_month).toBe('2026-10');
    expect(db.writes.filter(path => path.startsWith('advance_month_corrections/'))).toHaveLength(2);
    await expect(saveAdvanceMonth(db, FV, { ...input, previewHash: p.previewHash }, 'staff')).rejects.toThrow();
    expect(db.writes).toHaveLength(4);
  });
  it('rejects a stale source preview and wrong owner scope without writes', async () => {
    const db = fixture(); const p = await previewAdvanceMonth(db, payload); db.rows.get(`temporary_expenses/${PLAN.rows[1][0]}`).amount = 34;
    await expect(saveAdvanceMonth(db, FV, { ...payload, previewHash: p.previewHash }, 'staff')).rejects.toThrow();
    await expect(previewAdvanceMonth(db, { ...payload, assignmentMonth: '2026-08' })).rejects.toThrow(); expect(db.writes).toEqual([]);
  });
  it.each(['approved', 'paid'])('protects an advance referenced by a%s payroll without changing it', async status => {
    const db = fixture(); db.rows.set('payroll_runs/locked', { periodKey: '2026-09', status });
    db.rows.set('payroll_runs/locked/items/b', { advanceAllocations: [{ advanceId: PLAN.rows[1][0], amount: 33 }] });
    const before = structuredClone([...db.rows.entries()]); await expect(previewAdvanceMonth(db, payload)).rejects.toThrow();
    expect([...db.rows.entries()]).toEqual(before); expect(db.writes).toEqual([]);
  });
  it('rejects approval between preview and save atomically', async () => {
    const db = fixture(); const p = await previewAdvanceMonth(db, payload);
    db.rows.set('payroll_runs/locked', { periodKey: '2026-09', status: 'approved' });
    db.rows.set('payroll_runs/locked/items/b', { advanceAllocations: [{ advanceId: PLAN.rows[1][0], amount: 33 }] });
    await expect(saveAdvanceMonth(db, FV, { ...payload, previewHash: p.previewHash }, 'staff')).rejects.toThrow(); expect(db.writes).toEqual([]);
  });
  it.each(['operator', 'supervisor', 'partner', 'integration_ingest'])('does not grant%s new accounting access', async role => {
    const db = fixture(role); await expect(dispatch(db, FV, 'payrollPreviewAdvanceMonth', payload, { uid: 'staff' })).rejects.toMatchObject({ code: 'permission-denied' }); expect(db.writes).toEqual([]);
  });
});
