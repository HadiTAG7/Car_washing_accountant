// ═══════════════════════════════════════════════════════════════════════════
// ترحيل العمليات — turning operational records into journal entries
// ═══════════════════════════════════════════════════════════════════════════
// Posting is a DELIBERATE act here, not a side effect of saving a wash. Two
// reasons, both practical:
//
//   • An operator editing a wash three times should not mint three entries
//     and two reversals. The ledger records the approved fact, once.
//   • Existing data predates the ledger entirely. The same function that
//     posts today's business also migrates the backlog — so there is one
//     code path to trust, not two.
//
// Idempotency is the load-bearing property: `sourceType + sourceId` already
// having a POSTED entry means "already in the books", and the record is
// skipped. Re-running the whole sweep is therefore always safe.
// ═══════════════════════════════════════════════════════════════════════════

import { fetchRows } from '../firestoreCrud';
import { postEntry, hasPostedEntryFor, fetchEntries, fetchAccounts, ensureAccount } from './firestoreLedger';
import {
  buildWashEntry, buildExpenseEntry, buildPartnerPaymentEntry,
  buildTemporaryExpenseEntry, buildRecoveryEntry, canPostWash, expenseAccountFor,
} from './postingRules';
import { partnerCapitalAccount, partnerCapitalCode } from './chartOfAccounts';
import { isPeriodClosed, indexPeriods } from './periods';
import { periodKeyOf } from './journal';
import { fetchPeriods } from './firestoreLedger';

/**
 * Collects every operational record that is eligible to post but has no
 * posted entry yet, and describes WHY anything was skipped — a silent skip
 * in an accounting tool is worse than no feature at all.
 */
export async function collectUnposted({ vatRegistered = true, washPriceMode = 'inclusive' } = {}) {
  const [
    entries, periods, washes, monthly, variable, annualEntries, startupEntries, payments, partners, temps,
  ] = await Promise.all([
    fetchEntries(), fetchPeriods(),
    fetchRows('washes'), fetchRows('monthly_expenses'), fetchRows('variable_expenses'),
    fetchRows('annual_expense_entries'), fetchRows('startup_cost_entries'),
    fetchRows('partner_payments'), fetchRows('partners'), fetchRows('temporary_expenses'),
  ]);
  const periodIndex = indexPeriods(periods);
  const partnerById = new Map(partners.map((p) => [p.id, p]));

  const ready = [];
  const skipped = [];
  const consider = (kind, sourceType, sourceId, date, build, label) => {
    if (hasPostedEntryFor(entries, sourceType, sourceId)) {
      skipped.push({ kind, label, reason: 'مُرحّل مسبقاً' }); return;
    }
    const key = periodKeyOf(date);
    if (!key) { skipped.push({ kind, label, reason: 'بلا تاريخ صالح' }); return; }
    if (isPeriodClosed(key, periodIndex)) {
      skipped.push({ kind, label, reason: `الفترة ${key} مقفلة` }); return;
    }
    ready.push({ kind, sourceType, sourceId, date, label, build });
  };

  // ── الغسلات — completed only ──────────────────────────────────────────
  for (const w of washes) {
    const label = `غسلات ${w.biker_name || ''} ${w.wash_date || ''}`.trim();
    if (!canPostWash({ status: w.status })) {
      skipped.push({ kind: 'wash', label, reason: 'غير مكتملة — لا يُعترف بالإيراد بعد' });
      continue;
    }
    consider('wash', 'wash', w.id, w.wash_date, () => buildWashEntry({
      id: w.id, bikerName: w.biker_name, quantity: w.quantity, price: w.price,
      status: w.status, washDate: w.wash_date, paymentMethod: w.payment_method || 'cash',
    }, { vatRegistered, priceMode: w.price_mode || washPriceMode }), label);
  }

  // ── المصروفات — one builder, four sources ─────────────────────────────
  const expenseSources = [
    ['monthly',  monthly,        (r) => ({ id: r.id, description: r.expense_name, amount: r.total_monthly_cost,
      date: r.logged_date, isTaxInvoice: r.is_tax_invoice, invoiceUrl: r.invoice_url,
      paymentMethod: r.payment_method, paymentStatus: r.payment_status === 'paid' ? 'paid' : 'unpaid',
      supplier: r.supplier, invoiceNumber: r.invoice_number, vatDeductible: r.vat_deductible })],
    ['variable', variable,       (r) => ({ id: r.id, description: r.expense_name, amount: r.total_variable_cost,
      date: r.logged_date, isTaxInvoice: r.is_tax_invoice, invoiceUrl: r.invoice_url,
      paymentMethod: r.payment_method, paymentStatus: 'paid',
      supplier: r.supplier, invoiceNumber: r.invoice_number, vatDeductible: r.vat_deductible })],
    ['annual',   annualEntries,  (r) => ({ id: r.id, description: r.description, amount: r.amount,
      date: r.spent_date, isTaxInvoice: r.is_tax_invoice, invoiceUrl: r.invoice_url,
      paymentMethod: 'cash', paymentStatus: 'paid' })],
    ['startup',  startupEntries, (r) => ({ id: r.id, description: r.description, amount: r.amount,
      date: r.spent_date, isTaxInvoice: r.is_tax_invoice, invoiceUrl: r.invoice_url,
      paymentMethod: 'cash', paymentStatus: 'paid' })],
  ];
  for (const [kind, rows, toExpense] of expenseSources) {
    for (const r of rows) {
      const e = toExpense(r);
      // A recurring monthly template has no single spend date — it is not a
      // document, so there is nothing to post. Its per-period invoices are.
      if (kind === 'monthly' && !e.date) {
        skipped.push({ kind, label: e.description || '', reason: 'مصروف متكرر بلا تاريخ — يحتاج سنداً مؤرخاً لكل فترة' });
        continue;
      }
      consider(kind, 'expense', r.id, e.date,
        () => buildExpenseEntry(e, { expenseAccount: expenseAccountFor(kind), vatRegistered }),
        `${e.description || 'مصروف'} — ${e.date || ''}`);
    }
  }

  // ── دفعات الشركاء ─────────────────────────────────────────────────────
  for (const p of payments) {
    const partner = partnerById.get(p.partner_id);
    const label = `دفعة ${partner?.partner_name || ''} ${p.payment_date || ''}`.trim();
    consider('partner_payment', 'partner_payment', p.id, p.payment_date, () => buildPartnerPaymentEntry({
      id: p.id, partnerId: p.partner_id, partnerName: partner?.partner_name,
      amount: p.amount, paymentDate: p.payment_date, paymentMethod: p.payment_method || 'transfer',
    }), label);
  }

  // ── العهد واستردادها ──────────────────────────────────────────────────
  for (const t of temps) {
    const label = `عهدة ${t.title || ''}`.trim();
    consider('temporary_expense', 'temporary_expense', t.id, t.spent_date, () => buildTemporaryExpenseEntry({
      id: t.id, title: t.title, amount: t.amount, spentDate: t.spent_date,
      paymentMethod: t.payment_method || 'cash',
    }), label);
    if (t.status === 'recovered' && t.recovered_date) {
      consider('recovery', 'recovery', t.id, t.recovered_date, () => buildRecoveryEntry({
        id: t.id, title: t.title, amount: t.amount, recoveredDate: t.recovered_date,
        paymentMethod: t.payment_method || 'cash',
      }), `استرداد ${t.title || ''}`.trim());
    }
  }

  ready.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return { ready, skipped, partners };
}

/**
 * Posts everything collected, oldest first, one transaction per entry.
 *
 * Sequential rather than parallel on purpose: the entry-number counter is a
 * single document, and concurrent transactions on it would contend and retry.
 * A failure on one record is recorded and the sweep continues — one bad row
 * must not strand the rest of the backlog.
 */
export async function postUnposted({
  userId = null, vatRegistered = true, washPriceMode = 'inclusive', onProgress = null,
} = {}) {
  const { ready, skipped, partners } = await collectUnposted({ vatRegistered, washPriceMode });

  // Each partner needs their capital sub-account to exist before the first
  // payment posts against it.
  const accounts = await fetchAccounts();
  const known = new Set(accounts.map((a) => String(a.code)));
  for (const p of partners) {
    const code = partnerCapitalCode(p.id);
    if (known.has(code)) continue;
    await ensureAccount(partnerCapitalAccount(p.id, p.partner_name), { userId });
    known.add(code);
  }

  const posted = [];
  const failed = [];
  for (let i = 0; i < ready.length; i += 1) {
    const item = ready[i];
    try {
      const res = await postEntry(item.build(), { userId, knownAccountCodes: known });
      posted.push({ ...item, ...res });
    } catch (e) {
      failed.push({ ...item, error: e?.message || String(e) });
    }
    onProgress?.({ done: i + 1, total: ready.length, label: item.label });
  }
  return { posted, failed, skipped, total: ready.length };
}
