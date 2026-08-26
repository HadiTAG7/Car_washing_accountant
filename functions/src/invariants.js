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
  // A sale documented by an invoice that has no operational record behind it —
  // a counter sale typed straight into the documents page. Its own type,
  // because it must never be mistaken for a wash: a wash already carries its
  // revenue into the books, and posting it twice is the whole hazard here.
  'sales_invoice',
  // ── تكامل سويتر: ثلاثة أنواع لا نوعٌ واحد ──
  // الخدمات تُعتمد شهرياً، والخصومات كلٌّ بمستنده وقد يُعترض عليها بعد
  // أسابيع، والتحصيل يصل في يومه. نوعٌ واحد يجعل عكسَ خصمٍ عكساً للشهر كله.
  'sweater_settlement', 'sweater_adjustment', 'sweater_collection',
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

/**
 * `HH:MM` or `HH:MM:SS` naming a real time of day.
 *
 * A regex of `\d{2}:\d{2}` accepts 25:70, which then rides into the QR
 * timestamp as a value no reader can parse. The parts are range-checked.
 */
export function normalizeTimeOfDay(value, fallback = '00:00:00') {
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(value ?? '').trim());
  if (!m) return fallback;
  const h = Number(m[1]), min = Number(m[2]), sec = m[3] === undefined ? 0 : Number(m[3]);
  if (h > 23 || min > 59 || sec > 59) return fallback;
  return `${m[1]}:${m[2]}:${String(sec).padStart(2, '0')}`;
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

/**
 * ما يُكتب على عدّاد القيود مع كل ترحيل — including the ledger's OLDEST date.
 *
 * `counters/journal` is already read and written by every transaction that
 * creates an entry, so carrying `earliestEntryDate` on it costs no extra read
 * and — this is the point — makes the bound move ATOMICALLY with the posting
 * that moves it.
 *
 * It lives HERE, in the module both writers import, because the guarantee is
 * only as good as its least careful caller. `ledger.js` used it and
 * `invoicing.js` did not: issuing a standalone invoice, voiding a document and
 * correcting one all create entries, and all three advanced `nextNumber` while
 * leaving `earliestEntryDate` untouched. A 2019 standalone invoice therefore
 * never lowered the bound, and `seedTaxPolicy` could accept a 2026 baseline
 * over books that began in 2019 — the exact hole the guard exists to close,
 * left open on three of the six paths that can open it.
 *
 * `seedTaxPolicy` needs that. It must refuse a baseline later than the oldest
 * entry, and it used to answer the question with a collection scan taken
 * BEFORE its transaction opened: an entry posted in the gap was invisible, the
 * seed was accepted, and a month sat in the books with no policy able to
 * explain it. Reading this one document inside the seed's transaction puts the
 * two in direct conflict, so one of them retries and sees the other.
 *
 * `min`, never overwrite: posting a 2024 entry today must lower the bound;
 * posting a 2026 one must leave it alone.
 */
export function journalCounterUpdate(counterSnap, nextNumber, entryDate, FieldValue) {
  const iso = String(entryDate || '').slice(0, 10);
  const known = counterSnap?.exists ? String(counterSnap.data().earliestEntryDate || '') : '';
  const valid = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d);
  const earliest = valid(iso) && (!valid(known) || iso < known) ? iso : (valid(known) ? known : null);
  return {
    nextNumber: nextNumber + 1,
    ...(earliest ? { earliestEntryDate: earliest } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  };
}
