// ═══════════════════════════════════════════════════════════════════════════
// ثوابت القيد — the SERVER's copy, and the authoritative one
// ═══════════════════════════════════════════════════════════════════════════
// The client has its own `validateEntry` in src/lib/accounting/journal.js.
// That one is a PREVIEW: it tells a user why a form will be rejected before
// they submit it. This one decides.
//
// The duplication is deliberate and the direction matters. A client check can
// be skipped by anyone holding a token, so it can never be the guard. And
// Firestore rules cannot help here either: rules have no loop and no fold, so
// there is no way to express "the debits sum to the credits" over a list of
// unknown length. That single limitation is why posting has to run on a
// trusted server rather than behind a rule.
//
// `functions/test/invariants.test.js` drives both implementations over the
// same battery of cases, so the two cannot drift apart unnoticed.
// ═══════════════════════════════════════════════════════════════════════════

export const SOURCE_TYPES = [
  'wash', 'expense', 'partner_payment', 'temporary_expense',
  'recovery', 'manual', 'adjustment', 'opening', 'depreciation', 'disposal',
];

// Money compares at 2 decimals: 0.1 + 0.2 !== 0.3 in binary floating point,
// so a halala-level epsilon is what "balanced" actually means.
export const MONEY_EPSILON = 0.005;

export function round2(n) {
  const v = Number(n) || 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True only for a date that exists.
 *
 * `Date.parse` is no use here: it ROLLS OVER, so '2026-02-30' silently
 * becomes 2 March rather than failing. The parsed date is compared back
 * against its parts instead, which is the only way to catch a day that never
 * happened — and a ledger entry dated to one would sit in the wrong period
 * forever.
 */
export function isRealDate(iso) {
  if (!ISO_DATE.test(String(iso || ''))) return false;
  const [y, m, d] = String(iso).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * A period key naming a real month. '2026-13' is not one, and neither is
 * '2026-00' — both would otherwise sail through a `\d{4}-\d{2}` test and
 * create a period that can never contain an entry.
 */
export function isValidPeriodKey(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(key || ''));
  if (!m) return false;
  const month = Number(m[2]);
  return month >= 1 && month <= 12;
}

/** Server-derived period key. The client never gets to name its own. */
export function periodKeyOf(isoDate) {
  const s = String(isoDate || '');
  return ISO_DATE.test(s) ? s.slice(0, 7) : '';
}

export function totalsOf(lines) {
  let debit = 0, credit = 0;
  for (const l of lines || []) {
    debit  += Number(l.debit)  || 0;
    credit += Number(l.credit) || 0;
  }
  return { debit: round2(debit), credit: round2(credit) };
}

export function isBalanced(lines) {
  const { debit, credit } = totalsOf(lines);
  return Math.abs(debit - credit) < MONEY_EPSILON;
}

/**
 * Normalises the caller's payload into exactly what will be stored.
 *
 * Everything derivable is DERIVED here rather than trusted: `periodKey` comes
 * from `entryDate`, amounts are rounded and coerced, and unknown fields are
 * dropped. A client that sends entryDate 2026-07-15 with periodKey 2026-08 —
 * to slip a July entry past a closed July — gets 2026-07 back and is refused
 * by the period check.
 */
export function normalizeEntry(input = {}) {
  const entryDate = String(input.entryDate || '').slice(0, 10);
  return {
    entryDate,
    periodKey:   periodKeyOf(entryDate),
    sourceType:  String(input.sourceType || 'manual'),
    sourceId:    input.sourceId == null ? null : String(input.sourceId),
    description: String(input.description || '').trim(),
    status:      'posted',
    reversalOf:  input.reversalOf == null ? null : String(input.reversalOf),
  };
}

export function normalizeLines(input = []) {
  return (Array.isArray(input) ? input : []).map((l) => ({
    accountId:   String(l?.accountId ?? '').trim(),
    debit:       round2(l?.debit),
    credit:      round2(l?.credit),
    description: String(l?.description ?? '').slice(0, 500),
  }));
}

/**
 * Every rule that makes a ledger auditable. Returns Arabic problems; empty
 * means the entry may be written.
 */
export function validateEntry(entry, lines, { knownAccountCodes = null } = {}) {
  const problems = [];
  const rows = Array.isArray(lines) ? lines : [];

  if (!entry || typeof entry !== 'object') return ['القيد غير صالح.'];
  if (!ISO_DATE.test(String(entry.entryDate || ''))) {
    problems.push('تاريخ القيد غير صالح (المطلوب YYYY-MM-DD).');
  } else if (!isRealDate(entry.entryDate)) {
    problems.push('تاريخ القيد غير موجود في التقويم.');
  }
  if (!SOURCE_TYPES.includes(entry.sourceType)) {
    problems.push(`نوع المصدر غير معروف: ${entry.sourceType}`);
  }
  if (!String(entry.description || '').trim()) problems.push('بيان القيد مطلوب.');
  // The client cannot name its own period: this must hold by construction,
  // and it is asserted so a future refactor cannot quietly break it.
  if (entry.periodKey !== periodKeyOf(entry.entryDate)) {
    problems.push('الفترة المحاسبية لا تطابق تاريخ القيد.');
  }
  if (rows.length < 2) problems.push('القيد يجب أن يحتوي على سطرين على الأقل.');

  rows.forEach((l, i) => {
    const n = i + 1;
    const debit = Number(l.debit) || 0;
    const credit = Number(l.credit) || 0;
    if (!String(l.accountId || '').trim()) {
      problems.push(`السطر ${n}: الحساب مطلوب.`);
    } else if (knownAccountCodes && !knownAccountCodes.has(String(l.accountId))) {
      problems.push(`السطر ${n}: الحساب ${l.accountId} غير موجود في دليل الحسابات.`);
    }
    if (!Number.isFinite(debit) || !Number.isFinite(credit)) {
      problems.push(`السطر ${n}: مبلغ غير رقمي.`);
    }
    if (debit < 0 || credit < 0) {
      problems.push(`السطر ${n}: لا يُسمح بمبلغ سالب — استخدم الجانب المقابل.`);
    }
    if (debit > 0 && credit > 0) {
      problems.push(`السطر ${n}: لا يجوز أن يحمل السطر مديناً ودائناً معاً.`);
    }
    if (debit === 0 && credit === 0) {
      problems.push(`السطر ${n}: يجب إدخال مبلغ في المدين أو الدائن.`);
    }
  });

  // THE check that no rule could make: debits must equal credits.
  const { debit, credit } = totalsOf(rows);
  if (Math.abs(debit - credit) >= MONEY_EPSILON) {
    problems.push(`القيد غير متوازن: المدين ${debit.toFixed(2)} ≠ الدائن ${credit.toFixed(2)}.`);
  }

  return problems;
}

/** The mirror image of an entry: every debit becomes a credit and vice versa. */
export function buildReversalLines(lines) {
  return (lines || []).map((l) => ({
    accountId:   l.accountId,
    debit:       round2(l.credit),
    credit:      round2(l.debit),
    description: l.description || '',
  }));
}

/**
 * `wash__abc123` — the lock that marks a source record as being in the books.
 *
 * Keyed on the record's KIND, not its `sourceType`: five collections post
 * with `sourceType: 'expense'`, so keying on the type put a monthly expense
 * and a variable expense in one namespace.
 */
export function postingLockId(kind, sourceId) {
  return `${kind}__${sourceId}`;
}
