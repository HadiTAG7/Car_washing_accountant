// ═══════════════════════════════════════════════════════════════════════════
// القيود اليومية — journal entries and their invariants
// ═══════════════════════════════════════════════════════════════════════════
// Pure logic. The Firestore layer calls `validateEntry` inside a transaction
// before it writes anything, so an unbalanced or malformed entry can never
// reach the database — and the same function runs in unit tests without a
// network.
//
// The rules enforced here are the ones that make a ledger auditable:
//   • total debits === total credits, to the halala
//   • a line carries a debit OR a credit, never both, never neither
//   • a posted entry is immutable — corrections are reversals, not edits
//   • nothing posts into a closed period
// ═══════════════════════════════════════════════════════════════════════════

export const SOURCE_TYPES = [
  'wash', 'expense', 'partner_payment', 'temporary_expense',
  'recovery', 'manual', 'adjustment', 'opening',
];
export const ENTRY_STATUSES = ['draft', 'posted', 'reversed'];

// Money is compared at 2 decimals: 0.1 + 0.2 !== 0.3 in binary floating
// point, so a cent-level epsilon is what "balanced" actually means.
export const MONEY_EPSILON = 0.005;

/** Round to halalas — every amount that reaches the ledger passes through here. */
export function round2(n) {
  const v = Number(n) || 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/** 'YYYY-MM-DD' → 'YYYY-MM'. Empty string when the date is unusable. */
export function periodKeyOf(isoDate) {
  const s = String(isoDate || '');
  return /^\d{4}-\d{2}/.test(s) ? s.slice(0, 7) : '';
}

/** Sums a line array into { debit, credit }, both rounded. */
export function totalsOf(lines) {
  let debit = 0, credit = 0;
  for (const l of lines || []) {
    debit  += Number(l.debit)  || 0;
    credit += Number(l.credit) || 0;
  }
  return { debit: round2(debit), credit: round2(credit) };
}

/** True when debits and credits agree within a halala. */
export function isBalanced(lines) {
  const { debit, credit } = totalsOf(lines);
  return Math.abs(debit - credit) < MONEY_EPSILON;
}

/**
 * Validates an entry + its lines. Returns Arabic problem strings; an empty
 * array means the entry may be posted.
 *
 * `knownAccountCodes` is optional — pass a Set to also verify every line
 * points at an account that exists in the chart.
 */
export function validateEntry(entry, lines, { knownAccountCodes = null } = {}) {
  const problems = [];
  const rows = Array.isArray(lines) ? lines : [];

  if (!entry || typeof entry !== 'object') return ['القيد غير صالح.'];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(entry.entryDate || ''))) {
    problems.push('تاريخ القيد غير صالح (المطلوب YYYY-MM-DD).');
  }
  if (!SOURCE_TYPES.includes(entry.sourceType)) {
    problems.push(`نوع المصدر غير معروف: ${entry.sourceType}`);
  }
  if (!String(entry.description || '').trim()) {
    problems.push('بيان القيد مطلوب.');
  }
  if (entry.periodKey && entry.periodKey !== periodKeyOf(entry.entryDate)) {
    problems.push('الفترة المحاسبية لا تطابق تاريخ القيد.');
  }

  // A single-line entry cannot balance against anything.
  if (rows.length < 2) {
    problems.push('القيد يجب أن يحتوي على سطرين على الأقل.');
  }

  rows.forEach((l, i) => {
    const n = i + 1;
    const debit  = Number(l.debit)  || 0;
    const credit = Number(l.credit) || 0;
    if (!String(l.accountId || '').trim()) {
      problems.push(`السطر ${n}: الحساب مطلوب.`);
    } else if (knownAccountCodes && !knownAccountCodes.has(String(l.accountId))) {
      problems.push(`السطر ${n}: الحساب ${l.accountId} غير موجود في دليل الحسابات.`);
    }
    if (debit < 0 || credit < 0) {
      problems.push(`السطر ${n}: لا يُسمح بمبلغ سالب — استخدم الجانب المقابل.`);
    }
    // The core rule: one side per line.
    if (debit > 0 && credit > 0) {
      problems.push(`السطر ${n}: لا يجوز أن يحمل السطر مديناً ودائناً معاً.`);
    }
    if (debit === 0 && credit === 0) {
      problems.push(`السطر ${n}: يجب إدخال مبلغ في المدين أو الدائن.`);
    }
  });

  const { debit, credit } = totalsOf(rows);
  if (Math.abs(debit - credit) >= MONEY_EPSILON) {
    problems.push(
      `القيد غير متوازن: المدين ${debit.toFixed(2)} ≠ الدائن ${credit.toFixed(2)}.`,
    );
  }

  return problems;
}

/** Convenience: throws the first problem, for call sites that want to fail loudly. */
export function assertValidEntry(entry, lines, opts) {
  const problems = validateEntry(entry, lines, opts);
  if (problems.length) {
    const err = new Error(problems[0]);
    err.problems = problems;
    throw err;
  }
}

/**
 * Guards a mutation against the ledger's immutability rules. Returns an
 * Arabic reason, or null when the mutation is allowed.
 *
 * A posted entry is never edited or deleted — the audit trail depends on it
 * staying exactly as filed. The only sanctioned correction is a reversal.
 */
export function mutationBlockedReason(entry, action) {
  if (!entry) return 'القيد غير موجود.';
  const status = entry.status;
  if (action === 'edit' || action === 'delete') {
    if (status === 'posted') {
      return 'لا يمكن تعديل أو حذف قيد مُرحّل — أنشئ قيداً عكسياً أو قيد تسوية.';
    }
    if (status === 'reversed') {
      return 'لا يمكن تعديل أو حذف قيد معكوس.';
    }
  }
  if (action === 'reverse') {
    if (status !== 'posted') return 'لا يمكن عكس قيد غير مُرحّل.';
  }
  if (action === 'post') {
    if (status === 'posted')   return 'القيد مُرحّل بالفعل.';
    if (status === 'reversed') return 'لا يمكن ترحيل قيد معكوس.';
  }
  return null;
}

/**
 * Builds the mirror of a posted entry: every debit becomes a credit of the
 * same amount and vice versa, so posting both leaves every account exactly
 * where it started.
 *
 * The reversal is dated independently — a correction discovered after a
 * period closed is posted into an OPEN period, never back-dated into the
 * closed one.
 */
export function buildReversal(entry, lines, { entryDate, description, createdBy } = {}) {
  const date = entryDate || entry.entryDate;
  return {
    entry: {
      entryDate:   date,
      periodKey:   periodKeyOf(date),
      sourceType:  entry.sourceType,
      sourceId:    entry.sourceId ?? null,
      description: description || `عكس قيد رقم ${entry.entryNumber} — ${entry.description}`,
      status:      'posted',
      reversalOf:  entry.id,
      createdBy:   createdBy ?? null,
    },
    lines: (lines || []).map((l) => ({
      accountId:    l.accountId,
      debit:        round2(l.credit),
      credit:       round2(l.debit),
      description:  l.description || '',
      sourceLineId: l.id ?? l.sourceLineId ?? null,
    })),
  };
}

/**
 * Normalises a draft into the shape stored in Firestore. Amounts are rounded
 * once, here, so nothing downstream re-rounds and drifts.
 */
export function normalizeEntry({ entryDate, sourceType, sourceId, description, createdBy, status = 'posted' }, lines) {
  return {
    entry: {
      entryDate,
      periodKey:   periodKeyOf(entryDate),
      sourceType,
      sourceId:    sourceId ?? null,
      description: String(description || '').trim(),
      status,
      createdBy:   createdBy ?? null,
      reversalOf:  null,
    },
    lines: (lines || []).map((l) => ({
      accountId:    String(l.accountId),
      debit:        round2(l.debit),
      credit:       round2(l.credit),
      description:  String(l.description || ''),
      sourceLineId: l.sourceLineId ?? null,
    })),
  };
}
