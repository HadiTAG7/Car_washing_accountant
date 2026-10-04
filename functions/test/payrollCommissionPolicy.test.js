import { describe, expect, it } from 'vitest';
import { calculatePayrollPreview, previewPayroll, savePayrollDraft, approvePayroll, CURRENT_COMMISSION_POLICY } from '../src/payroll.js';

const wash = (i, extra = {}) => ({ id: `wash-${i}`, ssp_booking_id: `SYNTHETIC-${i}`,
  biker_id: 'worker-a', quantity: 1, status: 'مكتملة', wash_date: '2026-10-03', price: 20, ...extra });
const bikers = [{ id: 'worker-a', name: 'Worker A', salary: 900, start_date: '2026-10-01' },
  { id: 'worker-b', name: 'Worker B', salary: 1200, start_date: '2026-10-01' }];
const now = new Date('2026-10-04T12:00:00Z');
const washes = n => Array.from({ length: n }, (_, i) => wash(i));
const preview = (n, extra = {}) => calculatePayrollPreview({ periodKey: '2026-10', bikers, washes: washes(n), now, ...extra });

function fixture(existing = null) {
  const data = new Map(bikers.map(biker => [`bikers/${biker.id}`, { ...biker }]));
  washes(5).forEach(row => data.set(`washes/${row.id}`, row));
  if (existing) {
    data.set(`payroll_runs/${existing.runId}`, structuredClone(existing));
    data.set('payroll_periods/2026-10', { revision: 1, currentRunId: existing.runId });
    data.set(`payroll_runs/${existing.runId}/items/worker-a`, { status: existing.status, commission: 10, netDue: 910 });
  }
  const writes = [];
  let auto = 0;
  const ref = path => ({ path, id: path.split('/').at(-1), collection: name => collection(`${path}/${name}`),
    get: async () => ({ exists: data.has(path), data: () => structuredClone(data.get(path)) }) });
  const collection = path => ({ doc: id => ref(`${path}/${id ?? `auto-${++auto}`}`), get: async () => ({
    docs: [...data.entries()].filter(([key]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
      .map(([key, value]) => ({ id: key.split('/').at(-1), ref: ref(key), data: () => structuredClone(value) })),
  }) });
  return { data, writes, collection, runTransaction: async callback => {
    const pending = [];
    const result = await callback({ get: reference => reference.get(),
      set: (reference, value, options) => pending.push(['set', reference, value, options]),
      delete: reference => pending.push(['delete', reference]),
      update: (reference, value) => pending.push(['set', reference, value, { merge: true }]),
    });
    for (const [kind, reference, value, options] of pending) {
      if (kind === 'delete') data.delete(reference.path);
      else data.set(reference.path, options?.merge ? { ...data.get(reference.path), ...structuredClone(value) } : structuredClone(value));
      writes.push(reference.path);
    }
    return result;
  } };
}
const FV = { serverTimestamp: () => 'synthetic-timestamp' };
const oldRun = (status = 'draft') => ({ runId: '2026-10__r1', revision: 1, periodKey: '2026-10',
  periodStart: '2026-10-01', periodEnd: '2026-10-31', inputAdjustments: [], status,
  policySnapshot: { method: 'actual_month_days', monthDays: 31 }, totals: { commissions: 10 } });

describe('4.50 commission for new current-period drafts with historical snapshots', () => {
  it('five washes earn22.50; seven earn31.50, with worker-specific salaries and no deduction from20', () => {
    expect(preview(5).lines[0]).toMatchObject({ commission: 22.5, commissionRate: 4.5, monthlySalary: 900, basicDue: 900, netDue: 922.5 });
    const p = preview(7); expect(p.totals.commissions).toBe(31.5);
    expect(p.lines.map(line => line.monthlySalary)).toEqual([900, 1200]);
    expect(p.policySnapshot.commission).toEqual(CURRENT_COMMISSION_POLICY);
    expect(preview(5, { washes: washes(5).map(row => ({ ...row, price: 0 })) }).totals.commissions).toBe(22.5);
  });
  it('repeated SSP IDs/wash IDs count once globally and conflicting workers or quantities require review', () => {
    const rows = washes(5);
    expect(preview(0, { washes: [...rows, { ...rows[0], id: 'duplicate-document' }] }).totals.commissions).toBe(22.5);
    expect(() => preview(0, { washes: [...rows, { ...rows[0], id: 'conflicting-worker', biker_id: 'worker-b' }] })).toThrow(/مكررة/);
    expect(() => preview(0, { washes: [wash(1, { quantity: 2 })] })).toThrow(/تنفيذًا واحدًا/);
    const direct = wash(1); delete direct.ssp_booking_id; direct.quantity = 5;
    expect(preview(0, { washes: [direct, direct] }).totals.commissions).toBe(22.5);
  });
  it('cancelled, incomplete, outside-period and other-worker washes cannot add commission', () => {
    const p = preview(5, { washes: [...washes(5), wash(6, { status: 'ملغاة' }), wash(7, { status: 'قيد التنفيذ' }),
      wash(8, { wash_date: '2026-09-30' }), wash(9, { biker_id: 'worker-b' })] });
    expect(p.lines.map(line => line.commission)).toEqual([22.5, 4.5]);
  });
  it('new historical-period calculations retain2; trusted saved snapshots retain2 even in October', () => {
    const september = preview(0, { periodKey: '2026-09', bikers: [{ ...bikers[0], start_date: '2026-09-01' }], washes: washes(5).map(row => ({ ...row, wash_date: '2026-09-03' })) });
    expect(september.totals.commissions).toBe(10);
    const saved = calculatePayrollPreview({ periodKey: '2026-10', bikers, washes: washes(5), now },
      { commission: { version: 'completed_wash_v1', unitAmount: 2, effectivePeriodKey: null } });
    expect(saved.totals.commissions).toBe(10);
  });
  it('authenticated preview/save ignore attempted client rate/policy overrides and snapshot the new rate', async () => {
    const db = fixture(); const payload = { periodKey: '2026-10', commission: { unitAmount: 999 }, policySnapshot: { commission: { unitAmount: 999 } } };
    expect((await previewPayroll(db, payload, { now })).totals.commissions).toBe(22.5); expect(db.writes).toEqual([]);
    const result = await savePayrollDraft(db, FV, payload, { userId: 'staff', now });
    expect(result.totals.commissions).toBe(22.5);
    expect(db.data.get(`payroll_runs/${result.runId}`).policySnapshot.commission).toEqual(CURRENT_COMMISSION_POLICY);
    expect(db.writes.every(path => path.startsWith('payroll_'))).toBe(true);
    const second = await savePayrollDraft(db, FV, { periodKey: '2026-10' }, { userId: 'staff', now });
    expect(second.runId).toBe(result.runId); expect(second.totals.commissions).toBe(22.5);
    expect([...db.data.keys()].filter(key => key.startsWith(`payroll_runs/${result.runId}/items/`))).toHaveLength(2);
  });
  it('preexisting draft preview/save/approval preserve its implicit historical rate', async () => {
    const db = fixture(oldRun());
    expect((await previewPayroll(db, { periodKey: '2026-10' }, { now })).totals.commissions).toBe(10);
    expect((await savePayrollDraft(db, FV, { periodKey: '2026-10' }, { now })).totals.commissions).toBe(10);
    expect((await approvePayroll(db, FV, { runId: '2026-10__r1' }, { now })).totals.commissions).toBe(10);
    expect(db.data.get('payroll_runs/2026-10__r1').policySnapshot.commission.unitAmount).toBe(2);
    expect(db.writes.some(path => /journal|posting_locks|accounting_periods/.test(path))).toBe(false);
  });
  it.each(['approved', 'paid'])('cannot save or approve a preexisting %s run or change its stored totals', async status => {
    const db = fixture(oldRun(status)); const original = structuredClone([...db.data.entries()]);
    // If preview recalculates, this deliberately invalid source would fail.
    db.data.get('bikers/worker-a').salary = -100;
    const savedPreview = await previewPayroll(db, { periodKey: '2026-10' }, { now });
    expect(savedPreview).toMatchObject({ snapshotOnly: true, totals: { commissions: 10 }, lineCount: 1 });
    expect(savedPreview.lines[0]).toMatchObject({ commission: 10, netDue: 910 });
    db.data.get('bikers/worker-a').salary = 900;
    await expect(savePayrollDraft(db, FV, { periodKey: '2026-10' }, { now })).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(approvePayroll(db, FV, { runId: '2026-10__r1' }, { now })).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(db.writes).toEqual([]); expect([...db.data.entries()]).toEqual(original);
  });
});
