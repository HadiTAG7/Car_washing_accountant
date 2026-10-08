// Read-only partner management view, behind the existing partnerView guard.
// No raw operational rows, invoice fields, names or other partners' payments
// are returned. Neither this function nor its arithmetic writes to Firestore.
import { partnerOperatingStatement, partnerFoundingAllocation, normalizePartnerEntrySources } from '../../src/lib/accounting/partnerOperatingStatement.js';
import { ADAPTERS } from '../../src/lib/accounting/sourceAdapters.js';
import { taxPolicyAt } from '../../src/lib/accounting/taxPolicy.js';
import { monthRange } from '../../src/lib/accounting/monthlyStatement.js';
import { LedgerError } from './ledger.js';
import { DEFAULT_DYNAMIC_UNIT_COST } from '../../src/lib/variableExpenseTotals.js';
import { postedLines, sourceKindOf } from '../../src/lib/accounting/reports.js';
import { ACC } from '../../src/lib/accounting/chartOfAccounts.js';
import { normalizeExpenseDate } from '../../src/lib/expenseDates.js';
import { isRealCalendarDate } from '../../src/lib/vatFields.js';
import { partnerCapitalJourney } from './partnerCapitalJourney.js';
import { operatingParticipation, readEligibilityStates, currentEligibilityMonth } from './partnerWorkerEligibility.js';

const readRows = async (db, name) => {
  const snap = await db.collection(name).get();
  return snap.docs.map(d => {
    const row = { ...d.data(), id: d.id };
    // Read-only formatting compatibility, not a migration or date fallback.
    return name === 'variable_expenses' ? { ...row,
      logged_date: normalizeExpenseDate(row.logged_date),
      invoice_date: normalizeExpenseDate(row.invoice_date),
    } : row;
  });
};
const monthOf = date => String(date || '').slice(0, 7);
const validMonth = key => /^\d{4}-(0[1-9]|1[0-2])$/.test(key);
const FUNDING_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
});
const nextMonth = key => {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 1));
  return d.toISOString().slice(0, 7);
};

export async function partnerAllocationReport(db, { partnerId, periodKey, today = new Date(), includeCapitalJourney = false } = {}) {
  const currentMonth = currentEligibilityMonth(today);
  const through = periodKey || currentMonth;
  if (!validMonth(through) || through > currentMonth) {
    throw new LedgerError('اختر شهراً صحيحاً حتى الشهر الحالي.', { code: 'invalid-argument' });
  }
  const names = ['partners', 'chart_of_accounts', 'journal_entries', 'journal_lines',
    'monthly_expenses', 'variable_expenses', 'annual_expenses', 'expense_vouchers',
    'annual_expense_entries', 'startup_cost_entries', 'partner_payments', 'fee_rules', 'variable_expense_categories'];
  if (includeCapitalJourney) names.push('startup_costs', 'categories');
  const [rows, settingsSnap, washSnap, bookingSnap, settlementSnap, eligibilityStates] = await Promise.all([
    Promise.all(names.map(name => readRows(db, name))),
    db.collection('app_settings').doc('accounting').get(),
    db.collection('washes').select('quantity', 'status', 'wash_date', 'price', 'price_mode',
      'ssp_booking_id', 'revenue_origin', 'collection_status', 'owner_tax_snapshot').get(),
    db.collection('sweater_bookings').select('sspBookingId', 'postedEntryId', 'processingStatus').get(),
    db.collection('sweater_settlements').select('figures').get(),
    readEligibilityStates(db),
  ]);
  const data = Object.fromEntries(names.map((name, i) => [name, rows[i]]));
  // Only financial/identity fields needed for the shared revenue calculator.
  // Worker names and full booking documents are neither selected nor returned.
  const revenueSources = {
    washes: washSnap.docs.map(d => ({ ...d.data(), id: d.id })),
    bookings: bookingSnap.docs.map(d => ({ ...d.data(), id: d.id })),
    settlements: settlementSnap.docs.map(d => ({ ...d.data(), id: d.id })),
  };
  const partners = data.partners;
  const selected = partners.find(p => p.id === String(partnerId));
  if (!selected) throw new LedgerError('لا شريك بهذا المعرّف.', { code: 'not-found' });
  const workersCount = Math.max(0, Number(selected.workers_count) || 0);
  const totalWorkers = partners.reduce((s, p) => s + Math.max(0, Number(p.workers_count) || 0), 0);
  const factor = totalWorkers ? workersCount / totalWorkers : 0;
  if (!data.chart_of_accounts.length) throw new LedgerError('دليل الحسابات غير متاح؛ لا يمكن تأكيد التقرير.');
  const entries = normalizePartnerEntrySources(data.journal_entries, {
    monthly: data.monthly_expenses, variable: data.variable_expenses, voucher: data.expense_vouchers,
    annual: data.annual_expense_entries, startup: data.startup_cost_entries,
  });
  const entryIndex = new Map(entries.map(e => [e.id, e]));
  const lines = entries.flatMap(e => (e.lines || []).map((l, i) => ({ ...l, id: `${e.id}:${i}`, entryId: e.id })))
    .concat(data.journal_lines.filter(l => !entries.find(e => e.id === l.entryId)?.lines));
  const settings = settingsSnap.exists ? (settingsSnap.data().value || settingsSnap.data()) : {};
  const feeRules = data.fee_rules.filter(r => r.active !== false).map(r => ({
    key: r.key || r.id, label: r.label || 'رسوم', rate: r.rate, basis: r.basis,
    effectiveFrom: r.effective_from || null,
  }));
  // Missing dates cannot silently disappear from a financial allocation.
  for (const r of data.variable_expenses) {
    if (!isRealCalendarDate(r.invoice_date || r.logged_date)) throw new LedgerError('يوجد مصروف متغير بلا تاريخ صحيح؛ يحتاج مراجعة قبل تأكيد التقرير.');
  }
  for (const r of data.monthly_expenses.filter(r => r.recurrence === 'one_time')) {
    if (!validMonth(monthOf(r.invoice_date || r.logged_date))) throw new LedgerError('يوجد مصروف شهري لمرة واحدة بلا تاريخ صحيح؛ يحتاج مراجعة.');
  }
  const dates = entries.map(e => monthOf(e.entryDate)).concat(
    data.variable_expenses.map(e => monthOf(e.invoice_date || e.logged_date)),
    data.monthly_expenses.map(e => monthOf(e.invoice_date || e.logged_date)),
    data.annual_expense_entries.map(e => monthOf(e.spent_date)),
    data.startup_cost_entries.map(e => monthOf(e.spent_date)),
    data.partner_payments.filter(p => p.partner_id === selected.id).map(p => monthOf(p.payment_date)),
    washSnap.docs.map(d => monthOf(d.data().wash_date)),
  ).filter(validMonth).filter(m => m <= through);
  const first = dates.length ? dates.sort()[0] : through;
  const dynamicCategories = data.variable_expense_categories.filter(c => c.is_dynamic === true);
  const dynamicIds = new Set(dynamicCategories.map(c => c.id));
  const washQuantities = new Map();
  for (const d of washSnap.docs) {
    const row = d.data();
    const month = monthOf(row.wash_date);
    if (row.status !== 'مكتملة' || !validMonth(month)) continue;
    washQuantities.set(month, (washQuantities.get(month) || 0) + Math.max(0, Number(row.quantity) || 0));
  }
  const months = [];
  for (let key = first; key <= through; key = nextMonth(key)) {
    if (months.length >= 120) throw new LedgerError('نطاق البيانات يتجاوز عشر سنوات؛ يحتاج مراجعة قبل حساب رصيد التأسيس.');
    months.push(key);
  }
  const firstAnnualMonths = new Map();
  for (const row of data.annual_expense_entries) {
    const key = row.annual_expense_id;
    const month = monthOf(row.paid_date || row.spent_date);
    if (validMonth(month) && (!firstAnnualMonths.has(key) || month < firstAnnualMonths.get(key))) firstAnnualMonths.set(key, month);
  }
  const initialSpend = [];
  const fundingCostCodes = new Set(data.chart_of_accounts.filter(a => a.accountType === 'expense').map(a => String(a.code)));
  fundingCostCodes.add(ACC.FIXED_ASSETS);
  fundingCostCodes.add(ACC.INPUT_VAT);
  const allPosted = postedLines(entries, lines);
  for (const [kind, sources] of [['startup', data.startup_cost_entries], ['annual', data.annual_expense_entries]]) {
    for (const row of sources) {
      const date = row.paid_date || row.spent_date;
      // Labels come from the plan, never a worker's name, receipt notes,
      // supplier details or the free-text journal description.
      const parent = (kind === 'startup' ? data.startup_costs : data.annual_expenses)?.find(p =>
        p.id === (kind === 'startup' ? row.startup_cost_id : row.annual_expense_id));
      // Startup categories are the same documented grouping used by the
      // administration page. Annual categories can span unlike liabilities,
      // so those retain their plan boundary. Linked reversals inherit both.
      const category = kind === 'startup' && parent
        ? data.categories?.find(c => c.id === parent.category && String(c.label || '').trim()) : null;
      const detail = { kind,
        groupKey: parent ? (category ? `${kind}:category:${category.id}` : `${kind}:${parent.id}`) : null,
        groupLabel: category?.label || null,
        description: (kind === 'startup' ? parent?.item_name : parent?.expense_name)
        || (kind === 'startup' ? 'صرف تأسيس' : 'دفعة سنوية أولى') };
      if (!validMonth(monthOf(date))) throw new LedgerError('يوجد صرف تأسيس أو سنوي بلا تاريخ صحيح؛ تعذّر تأكيد رصيد التأسيس.');
      if (kind === 'annual') {
        const beginning = firstAnnualMonths.get(row.annual_expense_id);
        const elapsed = (Number(monthOf(date).slice(0, 4)) - Number(beginning.slice(0, 4))) * 12
          + Number(monthOf(date).slice(5, 7)) - Number(beginning.slice(5, 7));
        if (elapsed >= 12) continue; // Renewals draw the already-reserved fund.
      }
      const originals = entries.filter(e => !e.reversalOf && ['posted', 'reversed'].includes(e.status)
        && sourceKindOf(e) === kind && e.sourceId === row.id);
      if (originals.length) {
        const ids = new Set(originals.map(e => e.id));
        const related = entries.filter(e => ids.has(e.id) || ids.has(e.reversalOf));
        for (const e of related) {
          const amount = allPosted.filter(l => l.entryId === e.id && fundingCostCodes.has(String(l.accountId)))
            .reduce((s, l) => s + (Number(l.debit) || 0) - (Number(l.credit) || 0), 0) * factor;
          if (amount) initialSpend.push({ ...detail, id: `${kind}:${row.id}:${e.id}`,
            date: e.reversalOf ? entryIndex.get(e.id).entryDate : date,
            reversal: Boolean(e.reversalOf), basis: 'posted',
            month: e.reversalOf ? monthOf(entryIndex.get(e.id).entryDate) : monthOf(date), amount });
        }
        continue;
      }
      // True cash cost (including non-recoverable/recoverable invoice VAT),
      // unlike the operating cost net of deductible tax in the statement.
      const built = ADAPTERS[kind].build(row, { policyAt: d => taxPolicyAt(settings, d) });
      initialSpend.push({ ...detail, id: `${kind}:${row.id}`, date, reversal: false, basis: 'recorded',
        month: monthOf(date), amount: built.lines.reduce((s, l) => s + (Number(l.debit) || 0), 0) * factor });
    }
  }
  // Founding participation is not a historical cash statement. A contribution
  // actually paid by the report date also funds the partner's earlier costs.
  // Allocate one capped pool oldest-first; never backdate a receipt or use
  // another partner's contribution. The cash timeline remains separate.
  const fundingDateParts = Object.fromEntries(FUNDING_DAY.formatToParts(today).map(part => [part.type, part.value]));
  const fundingAsOf = `${fundingDateParts.year}-${fundingDateParts.month}-${fundingDateParts.day}`;
  const fundingPayments = data.partner_payments.filter(p => p.partner_id === selected.id
    && validMonth(monthOf(p.payment_date)) && String(p.payment_date).slice(0, 10) <= fundingAsOf);
  const paid = fundingPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  let spentBefore = 0;
  const results = months.map(period => {
    const eligibility = operatingParticipation(partners, eligibilityStates, selected.id, period);
    const statement = partnerOperatingStatement({
      accounts: data.chart_of_accounts, entries, lines, periodKey: period, scalingFactor: eligibility.factor,
      feeRules, settings, revenueSources, monthlyExpenses: data.monthly_expenses,
      variableExpenses: data.variable_expenses.filter(v => !dynamicIds.has(v.category_id)), annualExpenses: data.annual_expenses,
      vouchers: data.expense_vouchers,
      dynamicCommissions: dynamicCategories.map(c => ({ id: c.id, periodKey: period, amount: (washQuantities.get(period) || 0) * DEFAULT_DYNAMIC_UNIT_COST })),
      dynamicVariableIds: data.variable_expenses.filter(v => dynamicIds.has(v.category_id)).map(v => v.id),
    });
    const cashPaidThroughMonth = fundingPayments.filter(p => monthOf(p.payment_date) <= period)
      .reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const initialSpentThisMonth = initialSpend.filter(s => s.month === period).reduce((s, r) => s + r.amount, 0);
    const founding = partnerFoundingAllocation({ workersCount, paid, spentBefore, initialSpentThisMonth, statement });
    spentBefore += initialSpentThisMonth + statement.totalAllocation;
    // Explicit allowlist: ledger descriptions/identities never leave server.
    const { ledgerStatement: _ledger, revenueRows: _revenue, costRows: _cost, expenseRows: _expense, ...safe } = statement;
    return { ...safe, eligibility, founding: { ...founding, fundingAsOf, fundingBasis: 'paid-through-report-date', cashPaidThroughMonth } };
  });
  return { partnerId: selected.id, factor, workersCount, totalWorkers,
    ...(includeCapitalJourney ? { capitalJourney: partnerCapitalJourney({
      statements: results, initialSpend, factor, through, fundingAsOf, plans: data.startup_costs,
      startupEntries: data.startup_cost_entries,
      receipts: data.partner_payments.filter(p => p.partner_id === selected.id),
    }) } : {}),
    asOf: today.toISOString(), fundingAsOf, fundingBasis: 'paid-through-report-date',
    from: `${first}-01`, through: monthRange(through).to,
    basis: 'partner-allocation', statements: results };
}
