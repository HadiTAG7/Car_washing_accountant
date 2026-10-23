// One read-only calculation for the page and the transactional close gate.
// A missing source is never interpreted as a successful reconciliation.
import { ADAPTERS } from '../../src/lib/accounting/sourceAdapters.js';
import { missingVouchers, ungeneratableTemplates } from '../../src/lib/accounting/recurring.js';
import { mapMonthlyExpense } from '../../src/lib/mappers.js';
import { depreciationForPeriod, periodEndDate, validateAsset } from '../../src/lib/accounting/depreciation.js';
import { reconcileAssetCost } from '../../src/lib/accounting/assetReconciliation.js';
import { closePreflight } from '../../src/lib/accounting/periods.js';
import { round2 } from './invariants.js';

export const CLOSE_COLLECTIONS = [
  'journal_entries', 'journal_lines', 'accounting_periods', 'chart_of_accounts',
  'washes', 'monthly_expenses', 'variable_expenses', 'annual_expense_entries',
  'startup_cost_entries', 'partner_payments', 'temporary_expenses', 'expense_vouchers',
  'sweater_settlements', 'sweater_metric_snapshots', 'payroll_runs', 'fixed_assets',
];
export const riyadhDay = (now = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(now);
const dateOf = value => {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(value || ''));
  return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : '';
};
const live = entry => entry?.status === 'posted' && !entry.reversalOf;
const sourcePosted = (entries, kind, id, sourceType) => entries.some(e => live(e)
  && String(e.sourceId) === String(id) && (e.sourceKind ? e.sourceKind === kind : e.sourceType === sourceType));
const amountOf = (kind, row) => round2(kind === 'wash' ? Number(row.quantity) * Number(row.price)
  : row.amount ?? row.total_variable_cost ?? row.total_monthly_cost ?? 0);

export async function readCloseData(db, tx = null) {
  const pairs = await Promise.all(CLOSE_COLLECTIONS.map(async name => {
    const query = db.collection(name);
    const snap = await (tx ? tx.get(query) : query.get());
    return [name, snap.docs.map(d => ({ ...d.data(), id: d.id }))];
  }));
  return Object.fromEntries(pairs);
}

export function periodReadiness(periodKey, data, { today = riyadhDay() } = {}) {
  const rows = name => data[name] || [];
  const entries = rows('journal_entries');
  const lines = new Map(entries.map(e => [e.id, e.lines?.length ? e.lines
    : rows('journal_lines').filter(l => l.entryId === e.id)]));
  const preflight = closePreflight(periodKey, { entries, linesByEntry: lines });
  const end = periodEndDate(periodKey);
  const unposted = [], excluded = [], awaiting = [];
  for (const [kind, adapter] of Object.entries(ADAPTERS)) {
    for (const row of rows(adapter.collection)) {
      if (kind === 'recovery' && !(row.status === 'recovered' && row.recovered_date && !row.payroll_lock_id)) continue;
      const date = dateOf(adapter.dateOf(row));
      if (date.slice(0, 7) !== periodKey) continue;
      const item = { kind, id: row.id, date, amount: amountOf(kind, row), label: adapter.label(row) };
      if (sourcePosted(entries, kind, row.id, adapter.sourceType)) {
        excluded.push({ ...item, reason: 'مُرحّل مسبقاً' }); continue;
      }
      if (kind === 'voucher' && row.status === 'cancelled') {
        excluded.push({ ...item, reason: 'سند ملغى' }); continue;
      }
      const approved = adapter.isApproved(row);
      const reason = approved ? 'جاهز للفحص والترحيل' : (typeof adapter.notApprovedReason === 'function'
        ? adapter.notApprovedReason(row) : adapter.notApprovedReason) || 'غير معتمد بعد';
      // SSP revenue must be posted once, via the monthly settlement, not once per wash.
      if (kind === 'wash' && !approved) { excluded.push({ ...item, reason }); continue; }
      unposted.push({ ...item, reason, approved });
      if (['monthly', 'variable', 'annual', 'startup'].includes(kind) && row.approval_status !== 'approved') awaiting.push(item);
    }
  }
  const templates = rows('monthly_expenses').map(raw => ({ ...mapMonthlyExpense(raw),
    startPeriod: raw.start_period || null, endPeriod: raw.end_period || null, active: raw.active !== false }));
  const voucherRange = { from: periodKey, through: periodKey };
  const missing = missingVouchers(templates, new Set(rows('expense_vouchers').map(v => v.id)), voucherRange);
  const invalidTemplates = ungeneratableTemplates(templates, voucherRange)
    .filter(t => !['موقوف'].includes(t.reason) && !/^(انتهى|يبدأ)/.test(t.reason));
  const bookedWashes = rows('washes').filter(w => dateOf(w.wash_date).slice(0, 7) === periodKey && w.status === 'مكتملة')
    .reduce((sum, w) => sum + (Number(w.quantity) || 0), 0);
  const snapshot = rows('sweater_metric_snapshots').filter(s => s.periodKey === periodKey
    && s.metrics?.completedWashes != null).sort((a, b) => String(b.extractedAtIso).localeCompare(String(a.extractedAtIso)))[0];
  const settlement = rows('sweater_settlements').find(s => (s.periodKey || s.id) === periodKey);
  const settlementPosted = settlement?.status === 'approved' && live(entries.find(e => e.id === settlement.journalEntryId));
  const payroll = rows('payroll_runs').filter(p => p.periodKey === periodKey && !['cancelled', 'reversed'].includes(p.status));
  const payrollPosted = payroll.length > 0 && payroll.every(p => ['approved', 'paid'].includes(p.status)
    && live(entries.find(e => e.id === p.journalEntryId)));
  const assets = rows('fixed_assets').filter(a => !a.acquisitionDate || a.acquisitionDate <= end);
  const flatLines = [...lines].flatMap(([entryId, list]) => list.map(l => ({ ...l, entryId })));
  const cost = reconcileAssetCost(assets, entries, flatLines, { to: end });
  const charge = depreciationForPeriod(assets, periodKey);
  const chargeEntry = entries.find(e => live(e) && e.sourceType === 'depreciation' && e.sourceId === periodKey);
  const postedCharge = round2((chargeEntry && lines.get(chargeEntry.id) || [])
    .filter(l => ['5400', '5410'].includes(String(l.accountId))).reduce((s, l) => s + Number(l.debit || 0) - Number(l.credit || 0), 0));
  const cash = rows('chart_of_accounts').filter(a => ['1010', '1020'].includes(String(a.code || a.id))).map(a => {
    const id = String(a.code || a.id);
    const balance = round2(entries.filter(e => ['posted', 'reversed'].includes(e.status) && e.entryDate <= end)
      .reduce((sum, e) => sum + (lines.get(e.id) || []).filter(l => String(l.accountId) === id)
        .reduce((s, l) => s + Number(l.debit || 0) - Number(l.credit || 0), 0), 0));
    return { id, name: a.name, balance };
  });
  const negative = cash.filter(a => a.balance < -0.005);
  const checks = [];
  const add = (id, label, ok, count, amount, href, note = '', applicable = true) => checks.push({ id, label, ok, count, amount, href, note, applicable });
  add('ended', 'الشهر انتهى', end < today, 0, null, '?page=periods', end);
  add('washes', 'مطابقة عدد غسلات سويتر', !snapshot || bookedWashes === Number(snapshot.metrics.completedWashes), bookedWashes, null,
    '?page=sweater_settlements', snapshot ? `سويتر: ${snapshot.metrics.completedWashes} · اللقطة: ${snapshot.extractedAtIso}` : 'ما وصلت لقطة سويتر لهذا الشهر', Boolean(snapshot));
  add('settlement', 'تسوية سويتر معتمدة ومرحّلة', Boolean(settlementPosted), settlement?.figures?.counts?.needsReview || 0, settlement?.figures?.netDue ?? null, '?page=sweater_settlements');
  add('payroll', 'مسير الرواتب معتمد ومرحّل', payrollPosted, payroll.length, payroll.reduce((s, p) => s + Number(p.totals?.net || 0), 0), '?page=finance_payroll');
  add('recurring', 'السندات المتكررة منشأة', missing.length === 0 && invalidTemplates.length === 0, missing.length + invalidTemplates.length,
    round2(missing.reduce((s, v) => s + v.amount, 0)), '#recurring-vouchers');
  add('unposted', 'ما فيه عمليات غير مرحّلة للشهر', unposted.length === 0, unposted.length,
    round2(unposted.reduce((s, v) => s + v.amount, 0)), '#unposted-scan');
  add('depreciation', 'قيود الإهلاك مرحّلة والسجل مطابق', cost.matched && !assets.some(a => validateAsset(a).length)
    && (charge.total === 0 || postedCharge === charge.total), charge.rows.length, charge.total, '?page=assets',
    cost.matched ? '' : `فرق سجل الأصول: ${cost.difference.toFixed(2)}`);
  // No bank-reconciliation persistence path exists yet. Never invent a completed reconciliation.
  add('bank', 'مطابقة البنك', true, 0, null, '?page=ledger', 'غير متاحة بعد — لا تُعد مطابقة منجزة', false);
  add('cash', 'ما فيه حساب نقدي بالسالب', cash.length === 2 && negative.length === 0, negative.length,
    round2(negative.reduce((s, a) => s + a.balance, 0)), '?page=ledger', cash.length === 2 ? '' : 'دليل الحسابات غير مكتمل');
  add('approval', 'ما فيه مستندات بانتظار الاعتماد', awaiting.length === 0, awaiting.length,
    round2(awaiting.reduce((s, v) => s + v.amount, 0)), '?page=finance_workbench');
  add('balance', 'القيود متوازنة ولا توجد مسودات', preflight.ok, preflight.entryCount, preflight.totals.debit, '?page=trial', preflight.problems.join(' · '));
  return { periodKey, today, checkedAt: new Date().toISOString(), checks,
    ok: checks.every(c => c.ok), failedCount: checks.filter(c => !c.ok).length,
    preflight, unposted, excluded, missingVouchers: missing, invalidTemplates, cash };
}

export async function closeReadiness(db, { periodKey = null } = {}) {
  const data = await readCloseData(db);
  const keys = periodKey ? [periodKey] : [...new Set([riyadhDay().slice(0, 7),
    ...data.accounting_periods.map(p => p.periodKey), ...data.journal_entries.map(e => e.periodKey)].filter(Boolean))].sort().reverse();
  return { periods: keys.map(key => periodReadiness(key, data)) };
}
