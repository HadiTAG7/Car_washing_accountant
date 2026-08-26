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
  isRealDate, isValidPeriodKey, journalCounterUpdate,
} from './invariants.js';
import { ADAPTERS, legacyLockIdFor } from './posting.js';
import { taxPolicyAt } from './taxPolicy.js';

export const COL = {
  ACCOUNTS: 'chart_of_accounts',
  ENTRIES:  'journal_entries',
  PERIODS:  'accounting_periods',
  AUDIT:    'audit_logs',
  COUNTERS: 'counters',
  LOCKS:    'posting_locks',
  DOCUMENTS: 'sales_documents',
};
const JOURNAL_COUNTER = 'journal';
const SETTINGS_DOC = 'accounting';

const DEFAULT_SETTINGS = { vatRegistered: true, washPriceMode: 'inclusive' };

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
export async function postEntry(db, FieldValue, { entry, lines }, {
  userId = null, checkAccounts = true, lockKind = null,
} = {}) {
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
    // `lockKind` identifies the SOURCE COLLECTION, not the entry's accounting
    // type — five collections share `sourceType: 'expense'`.
    const lockRef = lockKind && normEntry.sourceId
      ? db.collection(COL.LOCKS).doc(postingLockId(lockKind, normEntry.sourceId))
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
        kind:       lockKind,
        sourceType: normEntry.sourceType,
        sourceId:   normEntry.sourceId,
        entryId:    entryRef.id,
        entryNumber: nextNumber,
        lockedBy:   userId,
        lockedAt:   FieldValue.serverTimestamp(),
      });
    }
    tx.set(counterRef,
      journalCounterUpdate(counterSnap, nextNumber, normEntry.entryDate, FieldValue),
      { merge: true });
    tx.set(db.collection(COL.AUDIT).doc(), auditRecord({
      action: 'post', collectionName: COL.ENTRIES, documentId: entryRef.id, userId,
      after: { entryNumber: nextNumber, ...normEntry, totalDebit: totals.debit },
      note: `ترحيل قيد رقم ${nextNumber}`,
    }, FieldValue));

    return { entryId: entryRef.id, entryNumber: nextNumber, ...totals };
  });
}

/**
 * Posts a SOURCE RECORD. The caller names it; the server reads it.
 *
 * This is the difference between "server authoritative" as a slogan and as a
 * fact. `postEntry` validates the arithmetic of whatever it is handed, but has
 * no idea whether those lines describe the wash they claim to — a caller could
 * send a perfectly balanced 50,000-riyal entry citing a 115-riyal wash and the
 * books would take it. Here the payload is `{ kind, sourceId }` and nothing
 * else: the amount, the date, the payment method and the VAT treatment all
 * come out of the stored document.
 *
 * Every read — source, settings, period, lock, counter — happens before the
 * first write, which a Firestore transaction requires and which also means the
 * whole decision is made on one consistent snapshot.
 */
export async function postSource(db, FieldValue, { kind, sourceId }, { userId = null } = {}) {
  const adapter = ADAPTERS[String(kind)];
  if (!adapter) throw new LedgerError(`نوع سجل غير معروف: ${kind}`, { code: 'invalid-argument' });
  const id = String(sourceId ?? '').trim();
  // An operational entry without a source id has nothing to be idempotent
  // against, so it could be posted again and again.
  if (!id) throw new LedgerError('معرّف السجل المصدر مطلوب.', { code: 'invalid-argument' });

  // The chart is a collection read; taken before the transaction so the
  // transaction body holds only document reads, in one clean block.
  const chartSnap = await db.collection(COL.ACCOUNTS).get();
  const knownAccountCodes = new Set(chartSnap.docs.map((d) => d.id));
  if (knownAccountCodes.size === 0) {
    throw new LedgerError('دليل الحسابات غير مُهيّأ — هيّئه قبل الترحيل.');
  }

  return db.runTransaction(async (tx) => {
    // ══ reads ══════════════════════════════════════════════════════════
    const sourceRef   = db.collection(adapter.collection).doc(id);
    const settingsRef = db.collection('app_settings').doc(SETTINGS_DOC);
    const lockRef     = db.collection(COL.LOCKS).doc(postingLockId(adapter.lockKind, id));
    const legacyId    = legacyLockIdFor(kind, id);
    const legacyRef   = legacyId ? db.collection(COL.LOCKS).doc(legacyId) : null;
    const counterRef  = db.collection(COL.COUNTERS).doc(JOURNAL_COUNTER);

    const [sourceSnap, settingsSnap, lockSnap, legacySnap, counterSnap] = await Promise.all([
      tx.get(sourceRef), tx.get(settingsRef), tx.get(lockRef),
      legacyRef ? tx.get(legacyRef) : Promise.resolve(null),
      tx.get(counterRef),
    ]);

    if (!sourceSnap.exists) {
      throw new LedgerError('السجل المصدر غير موجود.', { code: 'not-found' });
    }
    const row = sourceSnap.data();
    if (adapter.approved && !adapter.approved(row)) {
      // نصٌّ أو دالة: معظم المُحوِّلات لها سببٌ واحد ثابت، وغسلةُ سويتر لها
      // سببان مختلفان (غير مكتملة / مصدرها المنصة) فتحتاج أن تنظر في الصف.
      const why = typeof adapter.notApproved === 'function'
        ? adapter.notApproved(row) : adapter.notApproved;
      throw new LedgerError(why || 'السجل غير معتمد للترحيل بعد.');
    }
    // Locks written before locks were keyed on the kind still count.
    const existing = (lockSnap.exists && lockSnap) || (legacySnap?.exists && legacySnap) || null;
    if (existing) {
      throw new LedgerError(
        `سبق ترحيل هذا السجل بالقيد رقم ${existing.data().entryNumber ?? '—'} — لا يُرحّل مرتين.`,
        { code: 'already-exists' },
      );
    }

    const settings = { ...DEFAULT_SETTINGS, ...(settingsSnap.exists ? (settingsSnap.data().value || {}) : {}) };
    // ── the rules of the record's OWN day ──
    // Not today's. Posting a July wash in September must file it under July's
    // policy: if the business re-quoted its prices as VAT-exclusive in August,
    // the July sale was still quoted inclusive, and reading the current switch
    // would restate it. With no policy history stored this is exactly the
    // current settings, so an existing install is unaffected.
    const recordDate = adapter.dateOf?.(row);
    const policy = taxPolicyAt(recordDate, settings);
    if (!policy.known) {
      throw new LedgerError(
        `السياسة الضريبية غير مهيأة لتاريخ ${recordDate || '—'} `
        + `(السجل التاريخي يبدأ من ${policy.baselineFrom || '—'}) — `
        + 'هيّئ تاريخ بداية السياسة قبل ترحيل سجلات أقدم منه.',
      );
    }
    const built = adapter.build(row, id, {
      vatRegistered: policy.vatRegistered,
      washPriceMode: policy.washPriceMode,
      vatRate: policy.vatRate,
      recordDate,
      // The whole dated record, not one resolved policy. A purchase is taxed
      // under its INVOICE's date, which is routinely earlier than the day the
      // money left — a March invoice paid in April is deducted in March, at
      // March's rate. Only the builder knows which date it needs.
      policyAt: (d) => taxPolicyAt(d, settings),
    });

    const normEntry = normalizeEntry(built.entry);
    const normLines = normalizeLines(built.lines);
    const problems = validateEntry(normEntry, normLines, { knownAccountCodes });
    if (problems.length) {
      throw new LedgerError(problems[0], { code: 'invalid-argument', problems });
    }

    // ── قيد السداد، حين يختلف يوم الدفع عن يوم الفاتورة ──
    // A purchase then produces TWO entries: the supplier's invoice on its own
    // date (expense + input VAT against a payable), and the payment on the day
    // the money actually left. One entry cannot carry two dates, and choosing
    // either one alone puts a real figure in the wrong period — the VAT in the
    // payment's month, or the cash in the invoice's.
    const settlement = built.settlement
      ? {
        entry: normalizeEntry(built.settlement.entry),
        lines: normalizeLines(built.settlement.lines),
      }
      : null;
    if (settlement) {
      const sp = validateEntry(settlement.entry, settlement.lines, { knownAccountCodes });
      if (sp.length) throw new LedgerError(sp[0], { code: 'invalid-argument', problems: sp });
    }

    // Both periods are read, and BOTH must be open: half a purchase in the
    // books is worse than none, and committing the accrual into an open March
    // while April is closed would leave a payable nobody can ever settle.
    const periodKeys = settlement && settlement.entry.periodKey !== normEntry.periodKey
      ? [normEntry.periodKey, settlement.entry.periodKey]
      : [normEntry.periodKey];
    const periodRefs = periodKeys.map((k) => db.collection(COL.PERIODS).doc(k));
    const periodSnaps = await Promise.all(periodRefs.map((r) => tx.get(r)));
    for (const [i, snap] of periodSnaps.entries()) {
      if (snap.exists && snap.data().status === 'closed') {
        throw new LedgerError(
          `الفترة ${periodKeys[i]} مقفلة — لا يمكن الترحيل فيها. سجّل التصحيح في فترة مفتوحة.`,
        );
      }
    }

    // ══ writes ═════════════════════════════════════════════════════════
    const totals = totalsOf(normLines);
    const nextNumber = counterSnap.exists ? (Number(counterSnap.data().nextNumber) || 1) : 1;
    const entryRef = db.collection(COL.ENTRIES).doc();
    const settlementRef = settlement ? db.collection(COL.ENTRIES).doc() : null;

    tx.set(entryRef, {
      ...normEntry,
      entryNumber: nextNumber,
      sourceKind: adapter.lockKind,
      // What the tax rules said on this record's own day, frozen. Every later
      // reader asking "what was this wash's net revenue?" reads it here rather
      // than re-deriving it from switches that may since have moved.
      taxSnapshot: built.taxSnapshot || null,
      // The purchase side of the same idea: which of the three sources priced
      // this invoice, at what rate, against which policy row, and why an input
      // VAT asset was or was not recognised. Without it, "why is 1200 debited
      // 5.00 here?" is answered by re-running today's switches over the row.
      purchaseTaxSnapshot: built.purchaseTaxSnapshot || null,
      // Names the payment entry that belongs to this one, so a reader — and
      // the reversal — can find the other half rather than infer it.
      settlementEntryId: settlementRef ? settlementRef.id : null,
      lines: normLines,
      lineCount: normLines.length,
      totalDebit: totals.debit,
      totalCredit: totals.credit,
      createdBy: userId,
      createdAt: FieldValue.serverTimestamp(),
      postedAt: FieldValue.serverTimestamp(),
    });
    let settlementTotals = null;
    if (settlement) {
      settlementTotals = totalsOf(settlement.lines);
      tx.set(settlementRef, {
        ...settlement.entry,
        entryNumber: nextNumber + 1,
        sourceKind: adapter.lockKind,
        taxSnapshot: null,
        // The payment carries no tax of its own — it moves an existing
        // liability. Recording a snapshot here would double-count the
        // deduction for any reader that sums snapshots.
        purchaseTaxSnapshot: null,
        settlementOf: entryRef.id,
        lines: settlement.lines,
        lineCount: settlement.lines.length,
        totalDebit: settlementTotals.debit,
        totalCredit: settlementTotals.credit,
        createdBy: userId,
        createdAt: FieldValue.serverTimestamp(),
        postedAt: FieldValue.serverTimestamp(),
      });
    }
    for (const [i, snap] of periodSnaps.entries()) {
      if (!snap.exists) {
        tx.set(periodRefs[i], {
          periodKey: periodKeys[i], status: 'open',
          closedAt: null, closedBy: null, createdAt: FieldValue.serverTimestamp(),
        });
      }
    }
    tx.set(lockRef, {
      kind: adapter.lockKind,
      sourceType: normEntry.sourceType,
      sourceId: id,
      // The lock names the ACCRUAL: it is the entry the source became, and the
      // one whose reversal frees the record.
      entryId: entryRef.id,
      entryNumber: nextNumber,
      settlementEntryId: settlementRef ? settlementRef.id : null,
      lockedBy: userId,
      lockedAt: FieldValue.serverTimestamp(),
    });
    tx.set(counterRef,
      journalCounterUpdate(
        counterSnap, settlement ? nextNumber + 1 : nextNumber,
        // The EARLIER of the two dates — the bound is a minimum, and the
        // accrual is usually but not always the older one (a prepayment is
        // settled before its invoice is dated).
        settlement && settlement.entry.entryDate < normEntry.entryDate
          ? settlement.entry.entryDate : normEntry.entryDate,
        FieldValue,
      ),
      { merge: true });
    tx.set(db.collection(COL.AUDIT).doc(), auditRecord({
      action: 'post', collectionName: COL.ENTRIES, documentId: entryRef.id, userId,
      after: {
        entryNumber: nextNumber, kind: adapter.lockKind, sourceId: id,
        totalDebit: totals.debit,
        ...(settlement ? {
          settlementEntryNumber: nextNumber + 1,
          settlementDate: settlement.entry.entryDate,
        } : {}),
      },
      note: `ترحيل ${adapter.lockKind} — قيد رقم ${nextNumber}`
        + (settlement ? ` وقيد سداد رقم ${nextNumber + 1} بتاريخ ${settlement.entry.entryDate}` : ''),
    }, FieldValue));

    return {
      entryId: entryRef.id,
      entryNumber: nextNumber,
      kind: adapter.lockKind,
      ...totals,
      ...(settlement ? {
        settlementEntryId: settlementRef.id,
        settlementEntryNumber: nextNumber + 1,
      } : {}),
    };
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
  // No default date. A reversal lands in a period and changes what that
  // period says, so "today" is a decision the caller has to make and own —
  // silently choosing it for them is how a correction ends up in the wrong
  // month.
  const date = String(entryDate ?? '').slice(0, 10);
  if (!isRealDate(date)) {
    throw new LedgerError(
      'تاريخ القيد العكسي مطلوب ويجب أن يكون تاريخاً حقيقياً (YYYY-MM-DD).',
      { code: 'invalid-argument' },
    );
  }
  const periodKey = periodKeyOf(date);

  return db.runTransaction(async (tx) => {
    const originalRef = db.collection(COL.ENTRIES).doc(String(entryId));
    const counterRef  = db.collection(COL.COUNTERS).doc(JOURNAL_COUNTER);
    const periodRef   = db.collection(COL.PERIODS).doc(periodKey);

    const [originalSnap, counterSnap, periodSnap] = await Promise.all([
      tx.get(originalRef), tx.get(counterRef), tx.get(periodRef),
    ]);

    if (!originalSnap.exists) throw new LedgerError('القيد غير موجود.', { code: 'not-found' });
    const original = originalSnap.data();

    // The lock is read INSIDE the transaction, so the decision to release it
    // is made on the same snapshot as everything else.
    const lockKind = original.sourceKind || original.sourceType;
    const lockRef = lockKind && original.sourceId
      ? db.collection(COL.LOCKS).doc(postingLockId(lockKind, original.sourceId))
      : null;
    const lockSnap = lockRef ? await tx.get(lockRef) : null;
    // ── النصف الآخر من المشتريات ──
    // A purchase whose invoice and payment fall on different days is TWO
    // entries: the accrual (expense + input VAT against a payable) and the
    // settlement (payable against cash). Reversing the accrual alone would
    // leave the payment standing against a liability that no longer exists —
    // a permanent debit balance on 2000 that nothing explains. So the pair
    // moves together, in this transaction, and the caller is told.
    const settlementSnap = original.settlementEntryId
      ? await tx.get(db.collection(COL.ENTRIES).doc(String(original.settlementEntryId)))
      : null;
    const settlement = settlementSnap?.exists ? settlementSnap.data() : null;
    const reverseSettlement = Boolean(settlement && settlement.status === 'posted');

    if (original.status !== 'posted') {
      throw new LedgerError('لا يمكن عكس قيد غير مُرحّل.');
    }
    if (periodSnap.exists && periodSnap.data().status === 'closed') {
      throw new LedgerError(`الفترة ${periodKey} مقفلة — اختر تاريخاً في فترة مفتوحة.`);
    }

    // A reversal of a reversal unwinds the correction and leaves two mirror
    // entries with nothing to say which is live. The way back from a mistaken
    // reversal is a fresh adjusting entry, which states its own intent.
    if (original.reversalOf) {
      throw new LedgerError(
        'لا يُعكس قيد عكسي — سجّل قيد تسوية جديداً يوضّح التصحيح.',
      );
    }

    // ── فاتورة سارية تشير إلى هذا القيد ──
    // An ISSUED tax invoice pointing at a REVERSED entry is a state the books
    // must never hold: the paper says a sale happened and the ledger says it
    // did not, and the invoice is already in a customer's hands. Reversing the
    // entry on its own would create exactly that, so it is refused here and
    // the caller is sent to the path that moves both together.
    //
    // Two shapes of link: `linkedJournalEntryId` (a wash invoice documenting
    // an entry it did not create) and `journalEntryId` (a standalone sale or a
    // note, whose entry belongs to the document itself).
    const [linkedDocs, ownDocs] = await Promise.all([
      tx.get(db.collection(COL.DOCUMENTS).where('linkedJournalEntryId', '==', originalRef.id)),
      tx.get(db.collection(COL.DOCUMENTS).where('journalEntryId', '==', originalRef.id)),
    ]);
    const blockingLinked = linkedDocs.docs.map((x) => x.data()).filter((x) => x.status !== 'cancelled');
    const blockingOwn    = ownDocs.docs.map((x) => x.data()).filter((x) => x.status !== 'cancelled');
    if (blockingLinked.length) {
      const numbers = blockingLinked.map((x) => x.documentNumber).filter(Boolean).join('، ');
      throw new LedgerError(
        `القيد موثّق بفاتورة سارية (${numbers}) — لا يُعكس وحده، وإلا بقيت فاتورة ضريبية `
        + 'صادرة مقابل قيد معكوس. استخدم «تصحيح فاتورة الغسلة»: يلغي المستند ويعكس القيد '
        + 'ويفك القفل ويحرّر السجل في عملية واحدة، ثم صحّح الغسلة وأعد ترحيلها وأصدر فاتورة بديلة.',
      );
    }
    if (blockingOwn.length) {
      const numbers = blockingOwn.map((x) => x.documentNumber).filter(Boolean).join('، ');
      throw new LedgerError(
        `هذا القيد مملوك للمستند ${numbers} — ألغِ المستند نفسه (يعكس قيده في المعاملة ذاتها) `
        + 'بدل عكس القيد من دفتر الأستاذ.',
      );
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

    // The settlement mirror is built the same way — from the stored lines, so
    // it is balanced by construction.
    let settlementRevLines = null;
    if (reverseSettlement) {
      const lines = Array.isArray(settlement.lines) ? settlement.lines : null;
      if (!lines || lines.length < 2) {
        throw new LedgerError(
          'قيد السداد المرتبط بصيغة قديمة لا تحمل سطوره داخله — اعكسه يدوياً أولاً.',
        );
      }
      settlementRevLines = buildReversalLines(lines);
    }

    const nextNumber = counterSnap.exists ? (Number(counterSnap.data().nextNumber) || 1) : 1;
    const settlementRevNumber = reverseSettlement ? nextNumber + 1 : null;
    const revRef = db.collection(COL.ENTRIES).doc();
    const settlementRevRef = reverseSettlement ? db.collection(COL.ENTRIES).doc() : null;

    tx.set(revRef, {
      entryDate: date,
      periodKey,
      // ── المرآة ليست ترحيلاً للمصدر ──
      // The mirror used to inherit `sourceType` and `sourceId` from the entry
      // it cancels, and that made the reversal self-defeating: the lock was
      // released, so the record was free to be corrected — but every reader
      // that asks "does this source have a posted entry?" found the MIRROR
      // and answered yes. The wash could never be re-posted, and the whole
      // correct-and-re-post path was dead.
      //
      // A reversal is an adjustment. What it reverses is recorded in its own
      // fields, so the audit trail keeps every bit of that information without
      // the mirror pretending to be a posting of the source.
      sourceType: 'adjustment',
      sourceId: null,
      sourceKind: null,
      reversedSourceKind: original.sourceKind ?? null,
      reversedSourceType: original.sourceType ?? null,
      reversedSourceId:   original.sourceId ?? null,
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
    if (reverseSettlement) {
      const st = totalsOf(settlementRevLines);
      tx.set(settlementRevRef, {
        entryDate: date,
        periodKey,
        sourceType: 'adjustment',
        sourceId: null,
        sourceKind: null,
        reversedSourceKind: settlement.sourceKind ?? null,
        reversedSourceType: settlement.sourceType ?? null,
        reversedSourceId: settlement.sourceId ?? null,
        description: `عكس قيد سداد رقم ${settlement.entryNumber} — ${settlement.description || ''}`.trim(),
        status: 'posted',
        reversalOf: settlementSnap.id,
        entryNumber: settlementRevNumber,
        lines: settlementRevLines,
        lineCount: settlementRevLines.length,
        totalDebit: st.debit,
        totalCredit: st.credit,
        createdBy: userId,
        createdAt: FieldValue.serverTimestamp(),
        postedAt: FieldValue.serverTimestamp(),
      });
      tx.update(settlementSnap.ref, {
        status: 'reversed',
        reversedBy: settlementRevRef.id,
        reversedAt: FieldValue.serverTimestamp(),
      });
    }
    if (!periodSnap.exists) {
      tx.set(periodRef, {
        periodKey, status: 'open', closedAt: null, closedBy: null,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    // Releasing the source lock belongs HERE and nowhere else: the record is
    // free to be corrected precisely because its entry has been reversed.
    //
    // But ONLY if the lock still points at THIS entry. A source can be
    // corrected and re-posted, and the newer entry then owns the lock —
    // reversing the older one must not unlock a record the books still hold.
    if (lockRef && lockSnap?.exists) {
      if (lockSnap.data().entryId === originalRef.id) {
        tx.delete(lockRef);
      }
      // Otherwise the lock belongs to a later entry and stays exactly as it
      // is; `lockRetained` tells the caller so, rather than reporting a
      // release that did not happen.
    }
    tx.set(counterRef,
      journalCounterUpdate(counterSnap, settlementRevNumber ?? nextNumber, date, FieldValue),
      { merge: true });
    tx.set(db.collection(COL.AUDIT).doc(), auditRecord({
      action: 'reverse', collectionName: COL.ENTRIES, documentId: originalRef.id, userId,
      before: { status: 'posted' },
      after: {
        status: 'reversed', reversalEntryId: revRef.id,
        ...(reverseSettlement ? { settlementReversalEntryId: settlementRevRef.id } : {}),
      },
      note: `عكس القيد رقم ${original.entryNumber} بقيد رقم ${nextNumber}`
        + (reverseSettlement ? ` ومعه قيد السداد رقم ${settlement.entryNumber} بقيد رقم ${settlementRevNumber}` : ''),
    }, FieldValue));

    return {
      entryId: revRef.id,
      entryNumber: nextNumber,
      reversedEntryId: originalRef.id,
      ...(reverseSettlement ? {
        settlementReversalEntryId: settlementRevRef.id,
        settlementReversalNumber: settlementRevNumber,
        reversedSettlementEntryId: settlementSnap.id,
      } : {}),
      // False when the lock belongs to a newer entry for the same source.
      lockReleased: Boolean(lockRef && lockSnap?.exists && lockSnap.data().entryId === originalRef.id),
      lockRetained: Boolean(lockRef && lockSnap?.exists && lockSnap.data().entryId !== originalRef.id),
    };
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
  if (!isValidPeriodKey(periodKey)) {
    throw new LedgerError('مفتاح الفترة غير صالح (المطلوب YYYY-MM بشهر 01–12).', { code: 'invalid-argument' });
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
  if (!isValidPeriodKey(periodKey)) {
    throw new LedgerError('مفتاح الفترة غير صالح (المطلوب YYYY-MM بشهر 01–12).', { code: 'invalid-argument' });
  }
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
