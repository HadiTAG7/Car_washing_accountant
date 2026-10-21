import { compareIds } from '../../incomeStatementScope.js';
import { liveIncomeStatement } from '../../liveIncomeStatement.js';
import { unpaidPayrollIncome } from '../../unpaidPayrollIncome.js';
import { operationalWashSales, reconcileOperational } from '../../monthlyStatement.js';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../../chartOfAccounts.js';
import { overviewOperations } from '../../../overviewDashboard.js';
import { mapWash, mapBiker } from '../../../mappers.js';
import { sortBy } from '../../../firestoreCrud.js';

// Random statement data with every awkward case the code has met — shared by
// the in-memory property test and its emulator twin.
// ── random data with every awkward case the code has met ──
export function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const MONTHS = ['2025-12', '2026-01', '2026-02', '2026-03', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];
export function dataset(seed) {
  const r = rng(seed); const pick = list => list[Math.floor(r() * list.length)]; const chance = p => r() < p;
  const day = m => `${m}-${String(1 + Math.floor(r() * 28)).padStart(2, '0')}`;
  const odd = m => pick([day(m), day(m), day(m), m, `${day(m)}T09:00`, `${m.slice(0, 5)}${Number(m.slice(5))}-5`, `${m}-30`, '2026-02-30']);
  const id = (prefix, i) => pick([`${prefix}${i}`, `${prefix}${i}`, `${prefix}${i}`, `${prefix}${i}ü`, `${prefix}${i}😀`]);
  const data = { washes: {}, bikers: {}, variable_expenses: {}, monthly_expenses: {}, annual_expense_entries: {}, expense_vouchers: {},
    sweater_bookings: {}, sweater_settlements: {}, journal_entries: {}, journal_lines: {} };
  for (let i = 0; i < 4; i += 1) data.bikers[`b${i}`] = { name: `عامل ${i}`, current_status: pick(['يشتغل', '', 'إجازة']), salary: 1000 };
  const ssp = Array.from({ length: 12 }, (_, i) => `S${i}`);
  const washIds = [];
  for (let i = 0; i < 40; i += 1) {
    const wid = id('w', i); washIds.push(wid);
    const m = pick(MONTHS);
    data.washes[wid] = { wash_date: chance(0.9) ? odd(m) : null, status: pick(['مكتملة', 'مكتملة', 'قيد التنفيذ', 'completed']),
      quantity: pick([1, 1, 1, 2, 0]), price: pick([23, 20]), biker_id: pick(['b0', 'b1', 'b2', 'b3', null]), biker_name: 'عامل',
      revenue_origin: pick(['sweater', 'direct']), ...(chance(0.6) ? { ssp_booking_id: pick(ssp) } : {}) };
  }
  const exp = (prefix, n, amountField) => {
    const out = {};
    for (let i = 0; i < n; i += 1) {
      const m = pick(MONTHS);
      out[id(prefix, i)] = { [amountField]: pick([100, 250.5, 0]), expense_name: pick(['وقود', 'إيجار', 'مواد']),
        ...(chance(0.6) ? { logged_date: odd(m) } : {}), ...(chance(0.4) ? { invoice_date: odd(pick(MONTHS)) } : {}),
        ...(chance(0.3) ? { spent_date: odd(m) } : {}) };
    }
    return out;
  };
  data.variable_expenses = exp('v', 12, 'total_variable_cost');
  data.annual_expense_entries = exp('a', 6, 'amount');
  data.monthly_expenses = exp('m', 8, 'total_monthly_cost');
  for (const row of Object.values(data.monthly_expenses)) {
    const kind = pick(['one_time', 'monthly', 'missing']);
    if (kind !== 'missing') row.recurrence = kind;
    if (chance(0.04)) row.expense_name = 'رواتب العمال';
  }
  for (let i = 0; i < 10; i += 1) {
    const m = pick(MONTHS);
    data.expense_vouchers[id('vo', i)] = { periodKey: m, dueDate: day(m), amount: pick([500, 75]), status: pick(['unpaid', 'paid', 'cancelled']),
      templateName: 'قالب', ...(chance(0.3) ? { invoiceDate: odd(pick(MONTHS)) } : {}) };
  }
  for (const m of MONTHS) {
    if (chance(0.5)) data.sweater_settlements[m] = { periodKey: m, figures: { lines: { eligible: [{ sspBookingId: pick(ssp) }] } } };
  }
  for (const s of ssp) {
    data.sweater_bookings[s] = { sspBookingId: s, periodKey: pick(MONTHS),
      ...(chance(0.2) ? { postedEntryId: 'e-x' } : {}), ...(chance(0.15) ? { processingStatus: pick(['posted', 'linked']) } : {}) };
  }
  // ── the journal ──
  const sources = [
    ...washIds.map(sid => ['wash', 'wash', sid, '4000', 'credit']),
    ...Object.keys(data.variable_expenses).map(sid => ['variable', 'expense', sid, '5100', 'debit']),
    ...Object.keys(data.expense_vouchers).map(sid => ['voucher', 'expense', sid, '5300', 'debit']),
    ...Object.keys(data.monthly_expenses).map(sid => ['monthly', 'expense', sid, '5300', 'debit']),
    ...Object.keys(data.sweater_settlements).map(sid => ['sweater_settlement', 'sweater_settlement', sid, '4000', 'credit']),
  ];
  let n = 0;
  const entry = (fields, account, side, amount) => {
    const eid = id('e', n++);
    data.journal_entries[eid] = { entryDate: day(pick(MONTHS)), status: 'posted', ...fields,
      lines: [{ accountId: account, debit: side === 'debit' ? amount : 0, credit: side === 'credit' ? amount : 0 },
        { accountId: '1010', debit: side === 'credit' ? amount : 0, credit: side === 'debit' ? amount : 0 }] };
    return eid;
  };
  for (const [kind, type, sid, account, side] of sources) {
    if (!chance(0.35)) continue;
    const eid = entry({ sourceKind: kind, sourceType: type, sourceId: sid }, account, side, pick([20, 100, 23]));
    if (chance(0.25)) { // reversed, sometimes re-posted in another month
      data.journal_entries[eid].status = 'reversed';
      const mirror = entry({ reversalOf: eid, reversedSourceKind: kind, sourceType: 'adjustment', sourceId: null }, account, side === 'debit' ? 'credit' : 'debit', 20);
      data.journal_entries[eid].reversedBy = mirror;
      if (chance(0.5)) entry({ sourceKind: kind, sourceType: type, sourceId: sid }, account, side, 21);
    }
  }
  for (const m of MONTHS) {
    if (!chance(0.5)) continue;
    const runId = `${m}__r1`;
    const marker = pick(['snapshot', 'runId', 'runId', chance(0.1) ? 'legacy' : 'runId']);
    const pid = entry({ sourceType: 'payroll', sourceKind: 'payroll', sourceId: marker === 'legacy' ? 'legacy' : runId,
      ...(marker === 'snapshot' ? { payrollSnapshot: { periodKey: m } } : {}) }, '5010', 'debit', 900);
    if (chance(0.2)) {
      data.journal_entries[pid].status = 'reversed';
      entry({ reversesEntryId: pid, sourceType: 'payroll_reversal', sourceKind: 'payroll_reversal', sourceId: runId }, '5010', 'credit', 900);
    }
  }
  if (chance(0.15)) entry({ sourceType: 'manual', sourceId: 'manual-1' }, '5010', 'debit', 50); // a salary outside payroll
  for (let i = 0; i < 6; i += 1) entry({ sourceType: 'manual', sourceId: null }, pick(['5200', '4000']), pick(['debit', 'credit']), 33);
  const entryIds = Object.keys(data.journal_entries);
  if (chance(0.3)) {
    const legacyEntry = entry({ sourceType: 'manual', sourceId: null }, '5200', 'debit', 0);
    delete data.journal_entries[legacyEntry].lines;
    data.journal_lines.l1 = { entryId: legacyEntry, accountId: '5200', debit: 44, credit: 0 };
    data.journal_lines.l2 = { entryId: pick(entryIds), accountId: '4000', debit: 0, credit: 7 };
  }
  for (const e of Object.values(data.journal_entries)) if (chance(0.05)) e.status = 'draft';
  return data;
}


// ── a Firestore that only does what Firestore does ──
export function memoryFirestore(data) {
  const reads = { docs: 0, queries: 0 };
  const rows = name => Object.entries(data[name] || {}).map(([id, doc]) => ({ ...structuredClone(doc), id }))
    .sort((a, b) => compareIds(a.id, b.id));
  const billed = list => { reads.queries += 1; reads.docs += Math.max(1, list.length); return list; };
  return { reads, exec: {
    all: async name => billed(rows(name)),
    range: async (name, field, from, to) => billed(rows(name).filter(r => typeof r[field] === 'string' && r[field] >= from && r[field] < to)),
    equals: async (name, field, value) => billed(rows(name).filter(r => r[field] === value)),
    notNull: async (name, field) => billed(rows(name).filter(r => r[field] !== undefined && r[field] !== null)),
    inValues: async (name, field, values) => {
      if (values.length > 30) throw new Error('in > 30');
      return billed(rows(name).filter(r => values.includes(r[field])));
    },
    byIds: async (name, ids) => billed(rows(name).filter(r => ids.includes(r.id))),
    count: async (name, field, values) => { reads.queries += 1; reads.docs += 1; return rows(name).filter(r => values.includes(r[field])).length; },
    probe: async name => { reads.queries += 1; reads.docs += 1; return rows(name).length > 0; },
  } };
}

const accounts = DEFAULT_CHART_OF_ACCOUNTS;
const policyAt = date => (String(date) < '2026-01-01' ? { known: false } : { known: true, vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15 });
const previews = months => months.map(periodKey => ({ periodKey, estimated: false, lines: [{ basicDue: 1000, bonus: 0, deduction: 0 }] }));
const settle = fn => { try { return { ok: fn() }; } catch (e) { return { error: e.message }; } };

export function outputs({ sources, statementMonths, periodKey, today }) {
  const entries = sources.journalEntries;
  const lines = entries.flatMap(e => (e.lines || []).map((l, i) => ({ ...l, entryId: e.id, id: `${e.id}:${i}` }))).concat(sources.legacyLines);
  const withPayroll = { ...sources, payrollPreviews: previews(statementMonths) };
  const washEntryBySource = new Map();
  for (const e of entries) if (e.status === 'posted' && !e.reversalOf && (e.sourceKind ? e.sourceKind === 'wash' : e.sourceType === 'wash')) washEntryBySource.set(String(e.sourceId ?? ''), e);
  const washes = sources.washes.map(mapWash);
  return {
    statements: statementMonths.map(m => settle(() => liveIncomeStatement({ accounts, entries, lines, periodKey: m, sources: withPayroll, policyAt }))),
    payroll: statementMonths.map(m => settle(() => unpaidPayrollIncome({ preview: withPayroll.payrollPreviews.find(p => p.periodKey === m), accounts, entries, lines, periodKey: m, monthlyExpenses: sources.monthlies }))),
    reconciliation: statementMonths.map(m => settle(() => {
      const statement = liveIncomeStatement({ accounts, entries, lines, periodKey: m, sources: withPayroll, policyAt });
      const operational = operationalWashSales(washes, { periodKey: m, policyAt, isPosted: w => washEntryBySource.has(String(w.id)), postedEntryOf: w => washEntryBySource.get(String(w.id)) });
      return reconcileOperational({ operational, statement: { ...statement, netRevenue: statement.ledgerNetRevenue }, entries, lines });
    })),
    operations: settle(() => overviewOperations({ washes: sortBy(sources.washes, [{ key: 'wash_date', dir: 'desc' }]).map(mapWash),
      bikers: sortBy(sources.bikers || [], [{ key: 'name' }]).map(mapBiker), periodKey, today })),
    dueVouchers: sources.vouchers.filter(v => v.status === 'unpaid' && String(v.dueDate || '').slice(0, 7) === periodKey && v.dueDate <= today),
  };
}

export async function fullSources(exec) {
  const [washes, variables, monthlies, annualEntries, vouchers, bookings, settlements, journalEntries, legacyLines, bikers] = await Promise.all(
    ['washes', 'variable_expenses', 'monthly_expenses', 'annual_expense_entries', 'expense_vouchers', 'sweater_bookings',
      'sweater_settlements', 'journal_entries', 'journal_lines', 'bikers'].map(name => exec.all(name)));
  return { washes, variables, monthlies, annualEntries, vouchers, bookings, settlements, journalEntries, legacyLines, bikers };
}

