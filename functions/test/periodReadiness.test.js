import { describe, it, expect } from 'vitest';
import { periodReadiness, closeReadiness, riyadhDay } from '../src/periodReadiness.js';
import { closePeriod } from '../src/ledger.js';
import { dispatch } from '../src/handlers.js';
import { memoryFinanceDb } from '../../server/__tests__/financeFixtures.js';
import { sellerRegistration, sellerIssuanceProblems } from '../src/invoiceReadiness.js';

const entry = (id, extra = {}) => ({ id, periodKey: '2026-08', entryDate: '2026-08-31', status: 'posted',
  lines: [{ accountId: '1010', debit: 100, credit: 0 }, { accountId: '3000', debit: 0, credit: 100 }], ...extra });
function data() {
  return { journal_entries: [entry('settlement'), entry('payroll')],
    chart_of_accounts: [{ id: '1010' }, { id: '1020' }],
    sweater_settlements: [{ id: '2026-08', status: 'approved', journalEntryId: 'settlement' }],
    payroll_runs: [{ id: 'run', periodKey: '2026-08', status: 'approved', journalEntryId: 'payroll' }] };
}
function database(input = data(), role = 'admin') {
  const initial = { 'users/u': { role } };
  for (const [collection, rows] of Object.entries(input)) for (const row of rows) initial[`${collection}/${row.id}`] = row;
  return memoryFinanceDb(initial);
}
const FieldValue = { serverTimestamp: () => 'test-time' };
const check = (d, id, key = '2026-08') => periodReadiness(key, d, { today: '2026-10-24' }).checks.find(c => c.id === id);

describe('period close readiness: read-only and fail-closed', () => {
  it('uses Riyadh date at the UTC boundary', () => expect(riyadhDay(new Date('2026-10-31T21:00:00Z'))).toBe('2026-11-01'));
  it('passes complete evidence; unavailable optional sources are labelled, not zero evidence', () => {
    const result = periodReadiness('2026-08', data(), { today: '2026-10-24' });
    expect(result.ok).toBe(true);
    expect(result.checks.find(c => c.id === 'bank')).toMatchObject({ applicable: false });
    expect(result.checks.find(c => c.id === 'washes')).toMatchObject({ applicable: false });
  });
  it('refuses current month and only permits the next Riyadh day after month-end', () => {
    expect(check(data(), 'ended', '2026-10').ok).toBe(false);
    expect(periodReadiness('2026-10', data(), { today: '2026-10-31' }).checks[0].ok).toBe(false);
    expect(periodReadiness('2026-10', data(), { today: '2026-11-01' }).checks[0].ok).toBe(true);
  });
  it('checks the latest non-null wash metric independently of later compensation-only snapshots', () => {
    const d = { ...data(), washes: [{ id: 'w', wash_date: '2026-8-1', quantity: 2, status: 'مكتملة' }],
      sweater_metric_snapshots: [{ periodKey: '2026-08', extractedAtIso: '2026-08-31T12:00:00Z', metrics: { completedWashes: 3 } },
        { periodKey: '2026-08', extractedAtIso: '2026-08-31T13:00:00Z', metrics: { violations: 0 } }] };
    expect(check(d, 'washes')).toMatchObject({ ok: false, count: 2 });
  });
  it('paid payroll without a live journal is not posted; reversed settlement does not pass', () => {
    const d = data(); d.payroll_runs[0].journalEntryId = null; d.payroll_runs[0].status = 'paid';
    d.journal_entries[0].status = 'reversed';
    expect(check(d, 'payroll').ok).toBe(false); expect(check(d, 'settlement').ok).toBe(false);
  });
  it('does not interpret an empty asset register as zero depreciation when 1500 has a balance', () => {
    const d = data(); d.journal_entries.push(entry('asset', { lines: [{ accountId: '1500', debit: 1000 }, { accountId: '1020', credit: 1000 }] }));
    expect(check(d, 'depreciation').ok).toBe(false);
    expect(check(d, 'cash')).toMatchObject({ ok: false, amount: -1000 });
  });
  it('counts unapproved documents and normalises legacy unpadded dates', () => {
    const d = { ...data(), variable_expenses: [{ id: 'v', logged_date: '2026-8-7', total_variable_cost: 85 }] };
    expect(check(d, 'unposted')).toMatchObject({ ok: false, count: 1, amount: 85 });
    expect(check(d, 'approval')).toMatchObject({ ok: false, count: 1 });
  });
  it('detects missing recurring vouchers, not one-time expenses', () => {
    const d = { ...data(), monthly_expenses: [{ id: 'rent', expense_name: 'Rent', total_monthly_cost: 100, recurrence: 'monthly' },
      { id: 'once', expense_name: 'Once', total_monthly_cost: 50, recurrence: 'one_time' }] };
    expect(check(d, 'recurring')).toMatchObject({ ok: false, count: 1, amount: 100 });
  });
  it('read preview makes no database changes', async () => {
    const db = database(); const before = JSON.stringify([...db.rows]);
    expect((await closeReadiness(db, { periodKey: '2026-08' })).periods[0].ok).toBe(true);
    expect(JSON.stringify([...db.rows])).toBe(before);
  });
  it('every checklist link uses a real existing page route or preview anchor', () => {
    const routes = ['periods', 'sweater_settlements', 'finance_payroll', 'assets', 'ledger', 'finance_workbench', 'trial'];
    for (const c of periodReadiness('2026-08', data()).checks) {
      if (c.href.startsWith('?page=')) expect(routes).toContain(c.href.slice(6));
      else expect(['#recurring-vouchers', '#unposted-scan']).toContain(c.href);
    }
  });
  it('admin override cannot bypass unbalanced entries or draft journals', async () => {
    const bad = data(); bad.journal_entries.push(entry('draft', { status: 'draft' }));
    const db = database(bad); const before = JSON.stringify([...db.rows]);
    await expect(closePeriod(db, FieldValue, '2026-08', { userId: 'u', overrideReason: 'Test' })).rejects.toThrow(/مسودة|غير مُرحّل/);
    expect(JSON.stringify([...db.rows])).toBe(before);
  });
  it('server recomputes the checklist; refuses even a forged client ready flag without writing', async () => {
    const db = database({ ...data(), payroll_runs: [] }); const before = JSON.stringify([...db.rows]);
    await expect(dispatch(db, FieldValue, 'ledgerClosePeriod', { periodKey: '2026-08', ready: true }, { uid: 'u' })).rejects.toThrow(/غير جاهزة/);
    expect(JSON.stringify([...db.rows])).toBe(before);
  });
  it('admin override needs a reason and stored admin role; records every failed check in audit', async () => {
    const bad = { ...data(), payroll_runs: [] };
    const accountant = database(bad, 'accountant');
    await expect(dispatch(accountant, FieldValue, 'ledgerClosePeriod', { periodKey: '2026-08', overrideReason: 'Owner decision', role: 'admin' }, { uid: 'u' })).rejects.toThrow(/للمدير فقط/);
    const db = database(bad);
    await closePeriod(db, FieldValue, '2026-08', { userId: 'u', overrideReason: 'Owner decision' });
    expect(db.rows.get('accounting_periods/2026-08').closeOverrideReason).toBe('Owner decision');
    expect([...db.rows].find(([key]) => key.startsWith('audit_logs/'))[1].after.overrideReason).toBe('Owner decision');
  });
  it('complete checklist closes without override and current month cannot be overridden', async () => {
    const db = database(); await closePeriod(db, FieldValue, '2026-08', { userId: 'u' });
    expect(db.rows.get('accounting_periods/2026-08').status).toBe('closed');
    const future = database();
    await expect(closePeriod(future, FieldValue, '2099-01', { userId: 'u', overrideReason: 'test' })).rejects.toThrow(/قبل انتهائه/);
  });
  it('seller registration follows policy without concealing the untouched legacy conflict', () => {
    const raw = { name: 'Test', vatRegistered: false, vatNumber: '312345678901233', address: 'Test' };
    const policy = { known: true, vatRegistered: true };
    const seller = sellerRegistration(raw, policy);
    expect(seller).toMatchObject({ vatRegistered: true, legacyVatRegistered: false });
    expect(sellerIssuanceProblems(seller, policy).join(' ')).toMatch(/تعارض/);
    expect(raw.vatRegistered).toBe(false);
  });
});
