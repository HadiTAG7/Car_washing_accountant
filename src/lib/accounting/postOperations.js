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
import { postSource, hasPostedEntryFor, fetchEntries, fetchAccounts, ensureAccount } from './firestoreLedger';
import { ADAPTERS } from './sourceAdapters';
import { partnerCapitalAccount, partnerCapitalCode } from './chartOfAccounts';
import { isPeriodClosed, indexPeriods } from './periods';
import { periodKeyOf } from './journal';
import { fetchPeriods } from './firestoreLedger';

/**
 * Collects every operational record that is eligible to post but has no
 * posted entry yet, and describes WHY anything was skipped — a silent skip
 * in an accounting tool is worse than no feature at all.
 */
export async function collectUnposted() {
  const [
    entries, periods, washes, monthly, variable, annualEntries, startupEntries,
    payments, partners, temps, vouchers,
  ] = await Promise.all([
    fetchEntries(), fetchPeriods(),
    fetchRows('washes'), fetchRows('monthly_expenses'), fetchRows('variable_expenses'),
    fetchRows('annual_expense_entries'), fetchRows('startup_cost_entries'),
    fetchRows('partner_payments'), fetchRows('partners'), fetchRows('temporary_expenses'),
    fetchRows('expense_vouchers'),
  ]);
  const periodIndex = indexPeriods(periods);
  const partnerById = new Map(partners.map((p) => [p.id, p]));

  const ready = [];
  const skipped = [];

  /**
   * One gate for every source, so a record is judged the same way whichever
   * pass found it. The adapter decides approval; this decides postability.
   */
  const consider = (adapterKey, row, ctx = {}) => {
    const a = ADAPTERS[adapterKey];
    const label = a.label(row, ctx);
    const kind = adapterKey;
    if (!a.isApproved(row)) {
      skipped.push({ kind, label, reason: a.notApprovedReason || 'غير معتمد بعد' });
      return;
    }
    const sourceId = a.sourceId(row);
    // Identity is the KIND + id. `sourceType` is only the fallback for
    // entries posted before the kind was recorded.
    if (hasPostedEntryFor(entries, adapterKey, sourceId, a.sourceType)) {
      skipped.push({ kind, label, reason: 'مُرحّل مسبقاً' }); return;
    }
    const date = a.dateOf(row);
    const key = periodKeyOf(date);
    if (!key) { skipped.push({ kind, label, reason: 'بلا تاريخ صالح' }); return; }
    if (isPeriodClosed(key, periodIndex)) {
      skipped.push({ kind, label, reason: `الفترة ${key} مقفلة` }); return;
    }
    // No `build` any more: the server reads the record and builds the entry.
    // What the client contributes is the SELECTION — which records are worth
    // trying — and the reason for every one it skips.
    ready.push({ kind, sourceType: a.sourceType, sourceId, date, label });
  };

  for (const w of washes)         consider('wash', w);
  for (const r of monthly)        consider('monthly', r);
  for (const r of variable)       consider('variable', r);
  for (const r of annualEntries)  consider('annual', r);
  for (const r of startupEntries) consider('startup', r);
  for (const v of vouchers)       consider('voucher', v);
  for (const p of payments) {
    consider('partner_payment', p, { partnerName: partnerById.get(p.partner_id)?.partner_name });
  }
  // An advance and its recovery are two entries from one row, so the same
  // record goes through two adapters.
  for (const t of temps) {
    consider('temporary_expense', t);
    if (t.status === 'recovered' && t.recovered_date) consider('recovery', t);
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
export async function postUnposted({ onProgress = null } = {}) {
  const { ready, skipped, partners } = await collectUnposted();

  // Each partner needs their capital sub-account to exist before the first
  // payment posts against it.
  const accounts = await fetchAccounts();
  const known = new Set(accounts.map((a) => String(a.code)));
  for (const p of partners) {
    const code = partnerCapitalCode(p.id);
    if (known.has(code)) continue;
    await ensureAccount(partnerCapitalAccount(p.id, p.partner_name));
    known.add(code);
  }

  const posted = [];
  const failed = [];
  for (let i = 0; i < ready.length; i += 1) {
    const item = ready[i];
    try {
      const res = await postSource(item.kind, item.sourceId);
      posted.push({ ...item, ...res });
    } catch (e) {
      failed.push({ ...item, error: e?.message || String(e) });
    }
    onProgress?.({ done: i + 1, total: ready.length, label: item.label });
  }
  return { posted, failed, skipped, total: ready.length };
}
