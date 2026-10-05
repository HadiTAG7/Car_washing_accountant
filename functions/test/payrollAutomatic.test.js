import { describe, expect, it } from 'vitest';
import { calculatePayrollPreview, previewPayroll, savePayrollDraft, CURRENT_COMMISSION_POLICY } from '../src/payroll.js';
const biker = { id: 'b', name: 'Worker', salary: 1000, start_date: '2026-09-01' };
const advance = extra => ({ id: 'a', biker_id: 'b', amount: 200, recovered_amount: 0, status: 'pending', spent_date: '2026-10-01', assignment_month: '2026-10', ...extra });
const wash = (id, extra = {}) => ({ id, biker_id: 'b', quantity: 1, status: 'مكتملة', wash_date: '2026-10-03', ...extra });
const p = extra => calculatePayrollPreview({ periodKey: '2026-10', automaticAdvanceDeduction: true, bikers: [biker], washes: [wash('w1'), wash('w2')], advances: [advance()], ...extra });
function fixture(status = 'draft') {
  const rows = new Map([
    ['bikers/b', biker], ['washes/w1', wash('w1')], ['washes/w2', wash('w2')],
    ['temporary_expenses/a', advance()],
    ['payroll_periods/2026-10', { currentRunId: '2026-10__r1', revision: 1 }],
    ['payroll_runs/2026-10__r1', { runId: '2026-10__r1', revision: 1, periodKey: '2026-10', periodStart: '2026-10-01', periodEnd: '2026-10-31', status,
      inputAdjustments: [{ bikerId: 'b', bonus: 20, bonusReason: 'Real manual bonus', deduction: 10, deductionReason: 'Real manual deduction', advanceDeduction: 0 }],
      policySnapshot: { method: 'actual_month_days' }, totals: { basic: 1000, commissions: 0, advances: 0, net: 1010 } }],
    ['payroll_runs/2026-10__r1/items/b', { bikerId: 'b', name: 'Worker', basicDue: 1000, commission: 0, bonus: 20, bonusReason: 'Real manual bonus', deduction: 10, deductionReason: 'Real manual deduction', advanceDeduction: 0, netDue: 1010 }],
  ]); const writes = [];
  const snapshot = path => ({ id: path.split('/').at(-1), exists: rows.has(path), ref: doc(path), data: () => structuredClone(rows.get(path)) });
  const doc = path => ({ id: path.split('/').at(-1), path, get: async () => snapshot(path), collection: name => coll(`${path}/${name}`) });
  const coll = path => ({ doc: id => doc(`${path}/${id}`), get: async () => ({ docs: [...rows.keys()].filter(key => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/')).map(snapshot) }) });
  return { rows, writes, collection: coll, runTransaction: async callback => {
    const pending = []; const result = await callback({ get: ref => ref.get(), set: (ref, value, options) => pending.push([ref.path, value, options]), delete: ref => pending.push([ref.path, null]) });
    for (const [path, value, options] of pending) { if (value === null) rows.delete(path); else rows.set(path, options?.merge ? { ...rows.get(path), ...structuredClone(value) } : structuredClone(value)); writes.push(path); } return result;
  } };
}
const FV = { serverTimestamp: () => 'synthetic-server-time' };
describe('automatic payroll components from the source month', () => {
  it('overrides stale manual zero with current debt and adds wash commission once, separately from true manual bonus', () => {
    const result = p({ adjustments: [{ bikerId: 'b', advanceDeduction: 0, bonus: 20, bonusReason: 'Real bonus', deduction: 10, deductionReason: 'Real deduction' }] });
    expect(result.lines[0]).toMatchObject({ basicDue: 1000, commission: 9, commissionRate: 4.5, bonus: 20, deduction: 10, advanceDeduction: 200, netDue: 819 });
    expect(result.totals).toMatchObject({ commissions: 9, bonuses: 20, advances: 200, net: 819 });
  });
  it('deducts only the remaining eligible debt and never repeats recovered or other-month deductions', () => {
    const advances = [advance({ amount: 300, recovered_amount: 150 }), advance({ id: 'recovered', status: 'recovered', recovered_amount: 0 }),
      advance({ id: 'september', assignment_month: '2026-09' }), advance({ id: 'unlinked', biker_id: null })];
    const before = structuredClone(advances); const result = p({ advances });
    expect(result.lines[0]).toMatchObject({ advanceOutstanding: 150, advanceDeduction: 150, netDue: 859 });
    expect(result.lines[0].advanceAllocations).toHaveLength(1); expect(advances).toEqual(before);
  });
  it('deduplicates the source execution and excludes cancelled, incomplete and other-month washes', () => {
    const one = wash('w1', { ssp_booking_id: 'SYNTHETIC-1' });
    const result = p({ washes: [one, { ...one, id: 'duplicate' }, wash('cancelled', { status: 'canceled' }), wash('incomplete', { status: 'قيد التنفيذ' }), wash('september', { wash_date: '2026-09-30' })], advances: [] });
    expect(result.totals).toMatchObject({ commissions: 4.5, bonuses: 0, net: 1004.5 });
  });
  it('recalculates an old draft without writing and makes preview and explicit save consistent', async () => {
    const db = fixture(); const originalDebt = structuredClone(db.rows.get('temporary_expenses/a'));
    const originalRun = structuredClone(db.rows.get('payroll_runs/2026-10__r1'));
    const payload = { periodKey: '2026-10', automaticAdvanceDeduction: true };
    const preview = await previewPayroll(db, payload);
    expect(preview.totals).toMatchObject({ commissions: 9, bonuses: 20, deductions: 10, advances: 200, net: 819 });
    expect(db.writes).toEqual([]); expect(db.rows.get('payroll_runs/2026-10__r1')).toEqual(originalRun);
    const saved = await savePayrollDraft(db, FV, payload, { userId: 'staff' });
    expect(saved.totals).toEqual(preview.totals);
    expect(db.rows.get('payroll_runs/2026-10__r1')).toMatchObject({ automaticAdvanceDeduction: true, policySnapshot: { commission: CURRENT_COMMISSION_POLICY } });
    expect(db.rows.get('temporary_expenses/a')).toEqual(originalDebt);
    expect(db.writes.every(path => path.startsWith('payroll_'))).toBe(true);
    expect((await previewPayroll(db, { periodKey: '2026-10' })).totals).toEqual(saved.totals);
  });
  it.each(['approved', 'paid'])('returns the frozen%s snapshot and rejects draft changes without reading invalid source facts', async status => {
    const db = fixture(status); const before = structuredClone([...db.rows.entries()]); db.rows.get('bikers/b').salary = -1;
    const result = await previewPayroll(db, { periodKey: '2026-10', automaticAdvanceDeduction: true });
    expect(result).toMatchObject({ snapshotOnly: true, totals: { commissions: 0, advances: 0, net: 1010 } });
    db.rows.get('bikers/b').salary = 1000;
    await expect(savePayrollDraft(db, FV, { periodKey: '2026-10', automaticAdvanceDeduction: true })).rejects.toThrow();
    expect(db.writes).toEqual([]); expect([...db.rows.entries()]).toEqual(before);
  });
  it('keeps a recoveredSeptember advance at zero deduction and does not rewrite the stored recovery', () => {
    const sources = [advance({ assignment_month: '2026-09', status: 'recovered', recovered_date: '2026-10-03' })];
    const before = structuredClone(sources);
    expect(p({ periodKey: '2026-09', washes: [], advances: sources }).totals).toMatchObject({ basic: 1000, advances: 0, net: 1000 });
    expect(sources).toEqual(before);
  });
});
