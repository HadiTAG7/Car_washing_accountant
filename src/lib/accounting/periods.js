// ═══════════════════════════════════════════════════════════════════════════
// الفترات المحاسبية — accounting periods
// ═══════════════════════════════════════════════════════════════════════════
// A period is one month, keyed 'YYYY-MM'. Closing a period freezes it: no
// entry may be posted, reversed or amended with a date inside it. A mistake
// found later is corrected by a dated entry in an OPEN period, which is what
// keeps a filed month matching what was filed.
//
// Documents live in `accounting_periods`:
//   { periodKey, status: 'open' | 'closed', closedAt, closedBy }
//
// A period with no document is treated as OPEN — the ledger should not refuse
// to record business just because nobody has opened this month yet.
// ═══════════════════════════════════════════════════════════════════════════

import { periodKeyOf, isBalanced, totalsOf, MONEY_EPSILON } from './journal';

export const PERIOD_STATUSES = ['open', 'closed'];

/** 'YYYY-MM' for the month containing `date` (defaults to today, local zone). */
export function currentPeriodKey(date = new Date()) {
  const off = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - off).toISOString().slice(0, 7);
}

/** The month before `periodKey`. */
export function previousPeriodKey(periodKey) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(periodKey || ''));
  if (!m) return '';
  let y = +m[1], mo = +m[2] - 1;
  if (mo === 0) { mo = 12; y -= 1; }
  return `${y}-${String(mo).padStart(2, '0')}`;
}

/** Index period docs by key. */
export function indexPeriods(periods) {
  const map = new Map();
  for (const p of periods || []) map.set(String(p.periodKey), p);
  return map;
}

/** A period is closed only when a document says so. */
export function isPeriodClosed(periodKey, periodIndex) {
  const p = periodIndex?.get?.(String(periodKey));
  return Boolean(p && p.status === 'closed');
}

/**
 * Guard used before any write that lands in the ledger. Returns an Arabic
 * reason, or null when the date is postable.
 */
export function postingBlockedReason(entryDate, periodIndex) {
  const key = periodKeyOf(entryDate);
  if (!key) return 'تاريخ غير صالح.';
  if (isPeriodClosed(key, periodIndex)) {
    return `الفترة ${key} مقفلة — لا يمكن الترحيل فيها. سجّل التصحيح في فترة مفتوحة.`;
  }
  return null;
}

/**
 * Pre-close checks. A month is only safe to close when everything inside it
 * balances and nothing is still a draft.
 *
 * Returns { ok, problems, warnings, totals } — `problems` block the close,
 * `warnings` are shown but do not.
 */
export function closePreflight(periodKey, { entries = [], linesByEntry = new Map() } = {}) {
  const problems = [];
  const warnings = [];
  const inPeriod = entries.filter((e) => e.periodKey === periodKey);

  const drafts = inPeriod.filter((e) => e.status === 'draft');
  if (drafts.length) {
    problems.push(`يوجد ${drafts.length} قيد غير مُرحّل (مسودة) في الفترة — رحّلها أو احذفها قبل الإقفال.`);
  }

  // Every posted entry must balance on its own, not just in aggregate: two
  // opposite errors can cancel out across a month and hide both.
  let unbalanced = 0;
  for (const e of inPeriod) {
    if (e.status !== 'posted') continue;
    const lines = linesByEntry.get(e.id) || [];
    if (!isBalanced(lines)) unbalanced += 1;
  }
  if (unbalanced) {
    problems.push(`يوجد ${unbalanced} قيد غير متوازن في الفترة — صحّحها قبل الإقفال.`);
  }

  // Aggregate trial balance for the period.
  const allLines = inPeriod
    .filter((e) => e.status === 'posted')
    .flatMap((e) => linesByEntry.get(e.id) || []);
  const totals = totalsOf(allLines);
  if (Math.abs(totals.debit - totals.credit) >= MONEY_EPSILON) {
    problems.push(
      `ميزان مراجعة الفترة غير متوازن: المدين ${totals.debit.toFixed(2)} ≠ الدائن ${totals.credit.toFixed(2)}.`,
    );
  }

  if (inPeriod.length === 0) {
    warnings.push('لا توجد قيود في هذه الفترة — سيتم إقفالها فارغة.');
  }

  return { ok: problems.length === 0, problems, warnings, totals, entryCount: inPeriod.length };
}
