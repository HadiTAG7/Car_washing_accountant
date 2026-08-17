// ═══════════════════════════════════════════════════════════════════════════
// إحصاءات البايكر — دوال صافية تقرأ ما هو موجود ولا تخزّن شيئاً
// ═══════════════════════════════════════════════════════════════════════════
// A biker's numbers are all DERIVED: washes from the wash log, commission
// from the same rule the Variable Expenses page applies, advances from
// `temporary_expenses`. Nothing here is cached onto the biker document,
// because a stored aggregate is a number that can disagree with the rows it
// claims to summarise — the exact bug the partners page already documents
// with its `paid_amount` cache.
//
// ── مفتاح الربط هو الاسم، والقول به أصدق من إخفائه ──
// Washes carry a free-text `biker_name`; legacy rows have nothing else. So
// wash/commission stats match on the TRIMMED NAME — the same normalisation
// `variableItemsForMonth` uses — and renaming a biker leaves their old washes
// under the old name. Advances are the opposite: they were built for this
// registry, so they link by `biker_id` and survive a rename.
// ═══════════════════════════════════════════════════════════════════════════

import { monthOf, DEFAULT_DYNAMIC_UNIT_COST } from './variableExpenseTotals';

/**
 * Completed washes and the commission they earn for ONE biker in ONE month.
 *
 * Filter and normalisation are deliberately identical to
 * `variableItemsForMonth` (status === 'مكتملة', month prefix match, trimmed
 * name, quantity summed): the Variable Expenses page and the biker profile
 * must never quote two different commissions for the same person — the drift
 * test in bikerStats.test.js locks the two together.
 */
export function washStatsFor(bikerName, washes = [], monthKey, unitCost = DEFAULT_DYNAMIC_UNIT_COST) {
  const name = String(bikerName || '').trim();
  if (!name || !monthKey) return { washCount: 0, commission: 0 };
  let qty = 0;
  for (const w of washes) {
    if (w.status !== 'مكتملة') continue;
    if (monthOf(w.washDate) !== monthKey) continue;
    if (String(w.bikerName || '').trim() !== name) continue;
    qty += w.quantity || 0;
  }
  return { washCount: qty, commission: qty * unitCost };
}

/**
 * The advances a biker still owes: linked by id, `pending` only.
 * Returns the rows themselves (the salary dialog lists them as checkboxes)
 * plus their sum for the table column.
 */
export function pendingAdvancesFor(bikerId, temporaryExpenses = []) {
  if (!bikerId) return { advances: [], total: 0 };
  const advances = temporaryExpenses.filter(
    (t) => t.bikerId === bikerId && t.status === 'pending',
  );
  return {
    advances,
    total: advances.reduce((s, t) => s + (Number(t.amount) || 0), 0),
  };
}

/** حدّ التنبيه — الإقامة التي تنتهي خلال شهرين تستحق اهتماماً الآن. */
export const IQAMA_WARN_DAYS = 60;

/**
 * 'expired' | 'soon' | 'ok' | null (null = no expiry recorded).
 *
 * Pure date arithmetic on YYYY-MM-DD strings at UTC midnight, so the verdict
 * does not shift with the machine's timezone. `today` is injectable for tests.
 */
export function iqamaStatus(iqamaExpiry, today) {
  const expiry = String(iqamaExpiry || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return null;
  const ref = String(today || '').slice(0, 10);
  const refMs = Date.parse(`${/^\d{4}-\d{2}-\d{2}$/.test(ref) ? ref : new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const expMs = Date.parse(`${expiry}T00:00:00Z`);
  if (!Number.isFinite(expMs) || !Number.isFinite(refMs)) return null;
  const days = Math.floor((expMs - refMs) / 86_400_000);
  if (days < 0) return 'expired';
  if (days <= IQAMA_WARN_DAYS) return 'soon';
  return 'ok';
}

/**
 * صافي المدفوع = الراتب − السلف المختارة للخصم.
 *
 * Clamped at zero and SAID rather than silently allowed negative: deducting
 * more than the salary means the biker still owes the difference, and the
 * dialog must show that as remaining advances — not as a negative payment.
 */
export function netSalary(salary, checkedAdvances = []) {
  const gross = Math.max(0, Number(salary) || 0);
  const deducted = checkedAdvances.reduce((s, a) => s + (Number(a?.amount ?? a) || 0), 0);
  return {
    gross,
    deducted,
    net: Math.max(0, gross - deducted),
    exceedsSalary: deducted > gross,
  };
}

/**
 * الأسماء الموجودة في الغسلات ولا سجلّ لها — وقود زر «استيراد الأسماء».
 * Distinct trimmed names, minus the ones already registered, Arabic order.
 */
export function unregisteredBikerNames(washes = [], bikers = []) {
  const registered = new Set(bikers.map((b) => String(b.name || '').trim()).filter(Boolean));
  const seen = new Set();
  for (const w of washes) {
    const name = String(w.bikerName || '').trim();
    if (name && !registered.has(name)) seen.add(name);
  }
  return [...seen].sort((a, b) => a.localeCompare(b, 'ar'));
}
