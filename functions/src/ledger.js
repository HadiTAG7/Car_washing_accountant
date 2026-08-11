// ═══════════════════════════════════════════════════════════════════════════
// الترحيل الموثوق — the only code that may write the ledger
// ═══════════════════════════════════════════════════════════════════════════
// Firestore rules deny every client write to journal_entries, journal_lines,
// posting_locks, counters, accounting_periods and audit_logs. These functions
// run with the Admin SDK, which bypasses rules, and are therefore the single
// door into the books.
//
// The four things that could not be enforced any other way:
//
//   1. **Balance.** Rules have no fold, so "debits equal credits" over a list
//      of unknown length is inexpressible. A client could previously write
//      Dr 100 / Cr 1 straight into the ledger.
//   2. **A real reversal.** Rules could see a status flip to `reversed` but
//      not that a balanced mirror entry exists. `reversedBy` could name
//      nothing at all.
//   3. **Lock integrity.** Releasing a source lock had to be allowed for an
//      accountant, since rules cannot tell "released as part of a reversal"
//      from "released to unlock an edit". Here it happens only inside the
//      reversal itself.
//   4. **Period truth.** `periodKey` is DERIVED from `entryDate` server-side,
//      so a July entry cannot be smuggled past a closed July by labelling it
//      August.
//
// Every function takes the Firestore instance and FieldValue as arguments so
// the same code runs under the emulator in tests as in production.
// ═══════════════════════════════════════════════════════════════════════════

import {
  normalizeEntry, normalizeLines, validateEntry, totalsOf,
  buildReversalLines, postingLockId, periodKeyOf, round2,
} from './invariants.js';

export const COL = {
  ACCOUNTS: 'chart_of_accounts',
  ENTRIES:  'journal_entries',
  PERIODS:  'accounting_periods',
  AUDIT:    'audit_logs',
  COUNTERS: 'counters',
  LOCKS:    'posting_locks',
};
const JOURNAL_COUNTER = 'journal';

/** An error the caller is meant to see, as opposed to a bug. */
export class LedgerError extends Error {
  constructor(message, { code = 'failed-precondition', problems = null } = {}) {
    super(message);
    this.name = 'LedgerError';
    this.code = code;
    if (problems) this.problems = problems;
  }
}

function auditRecord({ action, collectionName, documentId, userId, before, after, note }, FieldValue) {
  return {
    action,
    collectionName,
    documentId: documentId ?? null,
    userId: userId ?? null,
    note: note || '',
    before: before ?? null,
    after: after ?? null,
    at: FieldValue.serverTimestamp(),
    atIso: new Date().toISOString(),
  };
}

// ─── الترحيل ─────────────────────────────────────────────────────────────
/**
 * Posts one balanced entry.
 *
 * Reads before writes, as a Firestore transaction requires: the counter, the
 * period and the idempotency lock are all read up front, so two devices
 * posting at the same instant cannot mint the same number or double-post the
 * same source record.
 */
export async function postEntry(db, FieldValue, { entry, lines }, { userId = null, checkAccounts = true } = {}) {
  const normEntry = normalizeEntry(entry);
  const normLines = normalizeLines(lines);

  let knownAccountCodes = null;
  if (checkAccounts) {
    const snap = await db.collection(COL.ACCOUNTS).get();
    knownAccountCodes = new Set(snap.docs.map((d) => d.id));
    // An empty chart means the books were never initialised; saying so beats
    // rejecting every line one by one for a missing account.
    if (knownAccountCodes.size === 0) {
      throw new LedgerError('دليل الحسابات غير مُهيّأ — هيّئه قبل الترحيل.');
    }
  }

  const problems = validateEntry(normEntry, normLines, { knownAccountCodes });
  if (problems.length) {
    throw new LedgerError(problems[0], { code: 'invalid-argument', problems });
  }

  const totals = totalsOf(normLines);

  return db.runTransaction(async (tx) => {
    const counterRef = db.collection(COL.COUNTERS).doc(JOURNAL_COUNTER);
    const periodRef  = db.collection(COL.PERIODS).doc(normEntry.periodKey);
    const lockRef = normEntry.sourceType && normEntry.sourceId
      ? db.collection(COL.LOCKS).doc(postingLockId(normEntry.sourceType, normEntry.sourceId))
      : null;

    // ── reads ──
    const [counterSnap, periodSnap, lockSnap] = await Promise.all([
      tx.get(counterRef),
      tx.get(periodRef),
      lockRef ? tx.get(lockRef) : Promise.resolve(null),
    ]);

    if (periodSnap.exists && periodSnap.data().status === 'closed') {
      throw new LedgerError(
        `الفترة ${normEntry.periodKey} مقفلة — لا يمكن الترحيل فيها. سجّل التصحيح في فترة مفتوحة.`,
      );
    }
    if (lockSnap && lockSnap.exists) {
      const prev = lockSnap.data();
      throw new LedgerError(
        `سبق ترحيل هذا السجل بالقيد رقم ${prev.entryNumber ?? '—'} — لا يُرحّل مرتين.`,
        { code: 'already-exists' },
      );
    }

    const nextNumber = counterSnap.exists ? (Number(counterSnap.data().nextNumber) || 1) : 1;

    // ── writes ──
    const entryRef = db.collection(COL.ENTRIES).doc();
    tx.set(entryRef, {
      ...normEntry,
      entryNumber: nextNumber,
      lines: normLines,
      lineCount: normLines.length,
      totalDebit: totals.debit,
      totalCredit: totals.credit,
      createdBy: userId,
      createdAt: FieldValue.serverTimestamp(),
      postedAt:  FieldValue.serverTimestamp(),
    });
    if (!periodSnap.exists) {
      tx.set(periodRef, {
        periodKey: normEntry.periodKey,
        status: 'open',
        closedAt: null, closedBy: null,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    if (lockRef) {
      tx.set(lockRef, {
        sourceType: normEntry.sourceType,
        sourceId:   normEntry.sourceId,
        entryId:    entryRef.id,
        entryNumber: nextNumber,
        lockedBy:   userId,
        lockedAt:   FieldValue.serverTimestamp(),
      });
    }
    tx.set(counterRef, {
      nextNumber: nextNumber + 1,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    tx.set(db.collection(COL.AUDIT).doc(), auditRecord({
      action: 'post', collectionName: COL.ENTRIES, documentId: entryRef.id, userId,
      after: { entryNumber: nextNumber, ...normEntry, totalDebit: totals.debit },
      note: `ترحيل قيد رقم ${nextNumber}`,
    }, FieldValue));

    return { entryId: entryRef.id, entryNumber: nextNumber, ...totals };
  });
}

// ─── العكس ───────────────────────────────────────────────────────────────
/**
 * Reverses a posted entry.
 *
 * The mirror entry is BUILT here from the original's own lines, so it is
 * balanced by construction — a caller cannot supply one. The original is
 * marked, its lines untouched, and its source lock released inside the same
 * transaction, which is the only place that release is legitimate.
 */
export async function reverseEntry(db, FieldValue, entryId, { entryDate, description, userId = null } = {}) {
  const date = String(entryDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const periodKey = periodKeyOf(date);
  if (!periodKey) throw new LedgerError('تاريخ القيد العكسي غير صالح.', { code: 'invalid-argument' });

  return db.runTransaction(async (tx) => {
    const originalRef = db.collection(COL.ENTRIES).doc(String(entryId));
    const counterRef  = db.collection(COL.COUNTERS).doc(JOURNAL_COUNTER);
    const periodRef   = db.collection(COL.PERIODS).doc(periodKey);

    const [originalSnap, counterSnap, periodSnap] = await Promise.all([
      tx.get(originalRef), tx.get(counterRef), tx.get(periodRef),
    ]);

    if (!originalSnap.exists) throw new LedgerError('القيد غير موجود.', { code: 'not-found' });
    const original = originalSnap.data();
    if (original.status !== 'posted') {
      throw new LedgerError('لا يمكن عكس قيد غير مُرحّل.');
    }
    if (periodSnap.exists && periodSnap.data().status === 'closed') {
      throw new LedgerError(`الفترة ${periodKey} مقفلة — اختر تاريخاً في فترة مفتوحة.`);
    }

    const originalLines = Array.isArray(original.lines) ? original.lines : null;
    if (!originalLines || originalLines.length < 2) {
      // A legacy entry whose lines still live in the old collection cannot be
      // reversed inside a transaction (queries are not allowed there), and
      // guessing at its lines would be worse than refusing.
      throw new LedgerError(
        'هذا القيد من صيغة قديمة لا تحمل سطوره داخله — سجّل قيد تسوية يدوياً بدل عكسه.',
      );
    }
    const revLines = buildReversalLines(originalLines);
    const totals = totalsOf(revLines);
    // Belt and braces: a mirror of a balanced entry is balanced, so a failure
    // here means the stored entry was never balanced to begin with.
    if (Math.abs(totals.debit - totals.credit) >= 0.005) {
      throw new LedgerError('القيد الأصلي غير متوازن — لا يمكن بناء عكس صحيح له.');
    }

    const nextNumber = counterSnap.exists ? (Number(counterSnap.data().nextNumber) || 1) : 1;
    const revRef = db.collection(COL.ENTRIES).doc();

    tx.set(revRef, {
      entryDate: date,
      periodKey,
      sourceType: original.sourceType || 'adjustment',
      sourceId: original.sourceId ?? null,
      description: description
        || `عكس قيد رقم ${original.entryNumber} — ${original.description || ''}`.trim(),
      status: 'posted',
      reversalOf: originalRef.id,
      entryNumber: nextNumber,
      lines: revLines,
      lineCount: revLines.length,
      totalDebit: totals.debit,
      totalCredit: totals.credit,
      createdBy: userId,
      createdAt: FieldValue.serverTimestamp(),
      postedAt: FieldValue.serverTimestamp(),
    });
    // The original is marked, never rewritten: its lines must keep showing
    // what was filed.
    tx.update(originalRef, {
      status: 'reversed',
      reversedBy: revRef.id,
      reversedAt: FieldValue.serverTimestamp(),
    });
    if (!periodSnap.exists) {
      tx.set(periodRef, {
        periodKey, status: 'open', closedAt: null, closedBy: null,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    // Releasing the source lock belongs HERE and nowhere else: the record is
    // free to be corrected precisely because its entry has been reversed.
    if (original.sourceType && original.sourceId) {
      tx.delete(db.collection(COL.LOCKS).doc(postingLockId(original.sourceType, original.sourceId)));
    }
    tx.set(counterRef, {
      nextNumber: nextNumber + 1, updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    tx.set(db.collection(COL.AUDIT).doc(), auditRecord({
      action: 'reverse', collectionName: COL.ENTRIES, documentId: originalRef.id, userId,
      before: { status: 'posted' },
      after: { status: 'reversed', reversalEntryId: revRef.id },
      note: `عكس القيد رقم ${original.entryNumber} بقيد رقم ${nextNumber}`,
    }, FieldValue));

    return { entryId: revRef.id, entryNumber: nextNumber, reversedEntryId: originalRef.id };
  });
}

// ─── الفترات ─────────────────────────────────────────────────────────────
/**
 * Closes a month, after re-running the preflight on server-read data.
 *
 * Every posted entry in the month must balance ON ITS OWN: two opposite
 * errors can cancel out across a month and hide both.
 */
export async function closePeriod(db, FieldValue, periodKey, { userId = null } = {}) {
  if (!/^\d{4}-\d{2}$/.test(String(periodKey || ''))) {
    throw new LedgerError('مفتاح الفترة غير صالح.', { code: 'invalid-argument' });
  }
  const snap = await db.collection(COL.ENTRIES).where('periodKey', '==', periodKey).get();
  const problems = [];
  let debit = 0, credit = 0, unbalanced = 0, drafts = 0;

  for (const d of snap.docs) {
    const e = d.data();
    if (e.status === 'draft') { drafts += 1; continue; }
    if (e.status !== 'posted') continue;
    const t = totalsOf(Array.isArray(e.lines) ? e.lines : []);
    // A legacy entry carries no embedded lines; its stored totals are used,
    // and where even those are missing the month cannot be certified.
    const hasLines = Array.isArray(e.lines) && e.lines.length > 0;
    const dr = hasLines ? t.debit : Number(e.totalDebit);
    const cr = hasLines ? t.credit : Number(e.totalCredit);
    if (!Number.isFinite(dr) || !Number.isFinite(cr)) {
      problems.push(`القيد رقم ${e.entryNumber ?? d.id} بصيغة قديمة بلا مجاميع — راجعه قبل الإقفال.`);
      continue;
    }
    if (Math.abs(dr - cr) >= 0.005) unbalanced += 1;
    debit += dr; credit += cr;
  }

  if (drafts) problems.push(`يوجد ${drafts} قيد غير مُرحّل (مسودة) في الفترة — رحّلها أو احذفها قبل الإقفال.`);
  if (unbalanced) problems.push(`يوجد ${unbalanced} قيد غير متوازن في الفترة — صحّحها قبل الإقفال.`);
  if (Math.abs(round2(debit) - round2(credit)) >= 0.005) {
    problems.push(`ميزان مراجعة الفترة غير متوازن: المدين ${round2(debit).toFixed(2)} ≠ الدائن ${round2(credit).toFixed(2)}.`);
  }
  if (problems.length) throw new LedgerError(problems[0], { problems });

  return db.runTransaction(async (tx) => {
    const ref = db.collection(COL.PERIODS).doc(periodKey);
    const cur = await tx.get(ref);
    if (cur.exists && cur.data().status === 'closed') {
      throw new LedgerError(`الفترة ${periodKey} مقفلة بالفعل.`, { code: 'already-exists' });
    }
    tx.set(ref, {
      periodKey, status: 'closed',
      closedAt: FieldValue.serverTimestamp(), closedBy: userId,
    }, { merge: true });
    tx.set(db.collection(COL.AUDIT).doc(), auditRecord({
      action: 'close', collectionName: COL.PERIODS, documentId: periodKey, userId,
      before: { status: 'open' }, after: { status: 'closed' },
      note: `إقفال الفترة ${periodKey} — ${snap.size} قيد، إجمالي ${round2(debit).toFixed(2)}`,
    }, FieldValue));
    return { periodKey, entryCount: snap.size, totals: { debit: round2(debit), credit: round2(credit) } };
  });
}

/** Re-opens a filed month. Admin-only, and the reason is not optional. */
export async function reopenPeriod(db, FieldValue, periodKey, { userId = null, reason = '' } = {}) {
  const why = String(reason || '').trim();
  if (!why) throw new LedgerError('سبب إعادة فتح الفترة مطلوب.', { code: 'invalid-argument' });

  return db.runTransaction(async (tx) => {
    const ref = db.collection(COL.PERIODS).doc(String(periodKey));
    const cur = await tx.get(ref);
    if (!cur.exists || cur.data().status !== 'closed') {
      throw new LedgerError(`الفترة ${periodKey} ليست مقفلة.`);
    }
    tx.set(ref, {
      status: 'open', reopenReason: why,
      reopenedAt: FieldValue.serverTimestamp(), reopenedBy: userId,
    }, { merge: true });
    tx.set(db.collection(COL.AUDIT).doc(), auditRecord({
      action: 'reopen', collectionName: COL.PERIODS, documentId: String(periodKey), userId,
      before: { status: 'closed' }, after: { status: 'open', reopenReason: why },
      note: `إعادة فتح الفترة ${periodKey} — ${why}`,
    }, FieldValue));
    return { periodKey, reason: why };
  });
}

// ─── التهيئة ─────────────────────────────────────────────────────────────
/** Seeds the chart of accounts. Idempotent: an existing account is left alone. */
export async function seedChartOfAccounts(db, FieldValue, accounts, { userId = null } = {}) {
  const chart = Array.isArray(accounts) ? accounts : [];
  if (chart.length === 0) throw new LedgerError('دليل حسابات فارغ.', { code: 'invalid-argument' });

  const existing = new Set((await db.collection(COL.ACCOUNTS).get()).docs.map((d) => d.id));
  const toCreate = chart.filter((a) => !existing.has(String(a.code)));
  if (toCreate.length === 0) return { created: 0, skipped: chart.length };

  const CHUNK = 400;
  for (let i = 0; i < toCreate.length; i += CHUNK) {
    const batch = db.batch();
    for (const a of toCreate.slice(i, i + CHUNK)) {
      batch.set(db.collection(COL.ACCOUNTS).doc(String(a.code)), {
        ...a,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    batch.set(db.collection(COL.AUDIT).doc(), auditRecord({
      action: 'seed', collectionName: COL.ACCOUNTS, userId,
      after: { codes: toCreate.slice(i, i + CHUNK).map((a) => a.code) },
      note: `تهيئة دليل الحسابات — ${Math.min(CHUNK, toCreate.length - i)} حساب`,
    }, FieldValue));
    await batch.commit();
  }
  return { created: toCreate.length, skipped: chart.length - toCreate.length };
}

/** Adds one account (a partner's capital sub-account, say). Idempotent. */
export async function ensureAccount(db, FieldValue, account, { userId = null } = {}) {
  const code = String(account?.code || '').trim();
  if (!code) throw new LedgerError('رقم الحساب مطلوب.', { code: 'invalid-argument' });
  const ref = db.collection(COL.ACCOUNTS).doc(code);
  if ((await ref.get()).exists) return { created: false };
  await ref.set({
    ...account,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await db.collection(COL.AUDIT).doc().set(auditRecord({
    action: 'create', collectionName: COL.ACCOUNTS, documentId: code, userId,
    after: account, note: `إضافة حساب ${code}`,
  }, FieldValue));
  return { created: true };
}
