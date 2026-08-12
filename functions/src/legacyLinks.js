// ═══════════════════════════════════════════════════════════════════════════
// ربط الفواتير القديمة بقيودها — a dry-run first, and never a guess
// ═══════════════════════════════════════════════════════════════════════════
// Invoices issued before the two-path split carry neither `journalEntryId` nor
// `linkedJournalEntryId`. Nothing can be credited against them, because a note
// needs an accounting original to reduce — so they are not a footnote in the
// limits list, they are a migration that has to run before this goes live.
//
// Three rules make it safe to automate:
//
//   1. **A link is adopted only when the document DECLARES it.** A legacy
//      invoice saying `sourceType: 'wash', sourceId: 'w1'` is asserting which
//      record it is for; this verifies that assertion against the lock and the
//      posted entry and adopts it only when all of them agree. Matching by
//      "same day, same amount" would be a guess, and a guess here writes a
//      filed tax document's link to an entry that may not be its own.
//
//   2. **One record, one document.** Two invoices declaring the same wash —
//      or two declarations resolving to the same ENTRY — are a contradiction
//      the data cannot settle. Picking one would be picking arbitrarily, so
//      both go to review.
//
//   3. **The plan does not authorise the write.** `apply` re-reads everything
//      inside a per-document transaction and re-checks it there. A dry-run is
//      a photograph; between the photograph and the write, an entry can be
//      reversed, a claim can be taken, another invoice can be linked. A batch
//      built on the old snapshot would apply a decision that was true a minute
//      ago.
//
// Nothing historical is rewritten. Only link fields are written —
// `linkedJournalEntryId`, `linkedJournalEntryNumber`, `washId`, `issueMode`,
// `supplyDate` — plus the source claim. Numbers, sequences, dates, totals, VAT
// and QR payloads are never touched.
// ═══════════════════════════════════════════════════════════════════════════

import { round2, MONEY_EPSILON, postingLockId } from './invariants.js';
import { ADAPTERS } from './posting.js';
import { DOC_COL, saleTotalsOfEntry, sourceClaimId } from './invoicing.js';

export const LINK_METHOD = 'declared-source';

/** Why a document could not be linked without guessing. */
export const REVIEW_REASONS = {
  NO_DECLARED_SOURCE: 'الفاتورة لا تعلن سجلاً مصدراً — الربط يحتاج قراراً بشرياً',
  WASH_MISSING:       'السجل المُعلن غير موجود',
  NOT_POSTED:         'السجل المُعلن غير مُرحّل — لا قفل ترحيل له',
  ENTRY_MISSING:      'قفل الترحيل يشير إلى قيد غير موجود',
  ENTRY_NOT_POSTED:   'قيد السجل معكوس أو غير مُرحّل',
  AMOUNT_MISMATCH:    'إجمالي الفاتورة لا يطابق قيد السجل',
  ALREADY_CLAIMED:    'السجل مُطالَب به من مستند آخر',
  ALREADY_LINKED:     'يوجد مستند آخر مرتبط بهذا القيد',
  CLAIM_RELEASED_ELSEWHERE: 'مطالبة السجل محرّرة لمستند آخر — القرار بشري',
  DUPLICATE_DECLARED_SOURCE: 'أكثر من فاتورة تعلن السجل أو القيد نفسه — لا تُختار واحدة تلقائياً',
  CHANGED_SINCE_SCAN: 'تغيّرت الحالة بعد الفحص — أعد الفحص',
};

/** Invoices that still have no ledger link of any kind. */
export function legacyCandidates(documents) {
  return (documents || []).filter((d) => d.type === 'invoice'
    && d.status !== 'cancelled'
    && !d.journalEntryId
    && !d.linkedJournalEntryId);
}

/**
 * How a claim stands relative to ONE document.
 *
 * `held` by this document, or absent, means the link may proceed and the claim
 * ends up held by it either way. `released` is only re-holdable by the document
 * it was released FROM — that is the explicit, audited transition. A claim
 * released from someone else, or held by someone else, is a decision a person
 * has to make.
 */
export function claimVerdict(claim, documentId) {
  if (!claim) return { ok: true, action: 'create' };
  const owner = String(claim.documentId ?? '');
  const previous = String(claim.previousDocumentId ?? '');
  const id = String(documentId);
  if (claim.status === 'released') {
    if (previous === id || owner === id) return { ok: true, action: 'rehold' };
    return { ok: false, reason: REVIEW_REASONS.CLAIM_RELEASED_ELSEWHERE };
  }
  if (owner === id) return { ok: true, action: 'confirm' };
  return { ok: false, reason: REVIEW_REASONS.ALREADY_CLAIMED };
}

/**
 * Builds the plan. Pure — takes rows in, returns the decision out, so the
 * dry-run and the apply run over exactly the same reasoning.
 *
 * `washes`, `entries`, `locks` and `claims` are arrays of `{ id, ...data }`.
 */
export function planLegacyInvoiceLinks({
  documents = [], washes = [], entries = [], locks = [], claims = [],
} = {}) {
  const washById  = new Map(washes.map((w) => [String(w.id), w]));
  const entryById = new Map(entries.map((e) => [String(e.id), e]));
  const lockById  = new Map(locks.map((l) => [String(l.id), l]));
  const claimById = new Map(claims.map((c) => [String(c.id), c]));

  // Candidate entries a human might match by eye, listed on review rows so the
  // manual decision has something in front of it. Never used to decide.
  const washEntries = entries.filter((e) => (e.sourceKind || e.sourceType) === 'wash'
    && e.status === 'posted' && !e.reversalOf);

  // Entries a document ALREADY points at. A legacy invoice resolving to one of
  // these would be the second paper for one sale.
  const takenEntries = new Set(
    (documents || [])
      .filter((d) => d.status !== 'cancelled' && d.linkedJournalEntryId)
      .map((d) => String(d.linkedJournalEntryId)),
  );

  const resolved = [];
  const review   = [];

  for (const doc of legacyCandidates(documents)) {
    const row = {
      documentId: doc.id,
      documentNumber: doc.documentNumber || null,
      issueDate: doc.issueDate || null,
      gross: round2(doc.gross),
    };

    const declared = doc.sourceType === 'wash' && doc.sourceId ? String(doc.sourceId) : '';
    if (!declared) {
      review.push({
        ...row,
        reason: REVIEW_REASONS.NO_DECLARED_SOURCE,
        // Same total, so a human has somewhere to start. Deliberately NOT
        // narrowed by date: an invoice issued days after its wash is normal,
        // and pretending the pair is obvious is how a wrong link gets written.
        candidates: washEntries
          .filter((e) => Math.abs(saleTotalsOfEntry(e.lines).gross - round2(doc.gross)) < MONEY_EPSILON)
          .map((e) => ({
            entryId: e.id, entryNumber: e.entryNumber ?? null,
            washId: e.sourceId ?? null, entryDate: e.entryDate || null,
            gross: saleTotalsOfEntry(e.lines).gross,
          })),
      });
      continue;
    }

    const wash = washById.get(declared);
    if (!wash) { review.push({ ...row, washId: declared, reason: REVIEW_REASONS.WASH_MISSING }); continue; }

    const lock = lockById.get(postingLockId(ADAPTERS.wash.lockKind, declared));
    if (!lock) { review.push({ ...row, washId: declared, reason: REVIEW_REASONS.NOT_POSTED }); continue; }

    const entry = entryById.get(String(lock.entryId || ''));
    if (!entry) { review.push({ ...row, washId: declared, reason: REVIEW_REASONS.ENTRY_MISSING }); continue; }
    if (entry.status !== 'posted') {
      review.push({ ...row, washId: declared, reason: REVIEW_REASONS.ENTRY_NOT_POSTED }); continue;
    }
    if (takenEntries.has(String(entry.id))) {
      review.push({
        ...row, washId: declared, entryId: entry.id, reason: REVIEW_REASONS.ALREADY_LINKED,
      });
      continue;
    }

    const verdict = claimVerdict(claimById.get(sourceClaimId('wash', declared)), doc.id);
    if (!verdict.ok) {
      const claim = claimById.get(sourceClaimId('wash', declared));
      review.push({
        ...row, washId: declared, reason: verdict.reason,
        claimedBy: claim?.documentNumber || claim?.previousDocumentNumber
          || claim?.documentId || claim?.previousDocumentId || null,
      });
      continue;
    }

    const sale = saleTotalsOfEntry(entry.lines);
    if (Math.abs(sale.gross - round2(doc.gross)) >= MONEY_EPSILON) {
      review.push({
        ...row, washId: declared, reason: REVIEW_REASONS.AMOUNT_MISMATCH,
        entryId: entry.id, entryGross: sale.gross,
      });
      continue;
    }

    resolved.push({
      ...row,
      washId: declared,
      entryId: String(entry.id),
      entryNumber: entry.entryNumber ?? null,
      entryGross: sale.gross,
      supplyDate: String(wash.wash_date || '').slice(0, 10) || null,
      claimAction: verdict.action,
      method: LINK_METHOD,
    });
  }

  // ── سجل واحد، مستند واحد ──
  // Two invoices declaring the same wash, or two declarations landing on the
  // same entry, cannot both be right. Choosing between them is exactly the
  // judgement a migration must not make on its own.
  const byWash  = new Map();
  const byEntry = new Map();
  for (const r of resolved) {
    byWash.set(r.washId, (byWash.get(r.washId) || 0) + 1);
    byEntry.set(r.entryId, (byEntry.get(r.entryId) || 0) + 1);
  }
  const linkable = [];
  for (const r of resolved) {
    const clashes = [];
    if (byWash.get(r.washId) > 1) clashes.push(`الغسلة ${r.washId}`);
    if (byEntry.get(r.entryId) > 1) clashes.push(`القيد رقم ${r.entryNumber ?? r.entryId}`);
    if (clashes.length) {
      review.push({
        ...r,
        reason: REVIEW_REASONS.DUPLICATE_DECLARED_SOURCE,
        conflictOn: clashes.join(' و'),
        conflictsWith: resolved
          .filter((o) => o.documentId !== r.documentId
            && (o.washId === r.washId || o.entryId === r.entryId))
          .map((o) => o.documentNumber || o.documentId),
      });
    } else {
      linkable.push(r);
    }
  }

  return {
    scanned: (documents || []).filter((d) => d.type === 'invoice').length,
    candidates: linkable.length + review.length,
    linkable,
    review,
  };
}

/**
 * Re-checks ONE planned link against live data and writes it, in one
 * transaction.
 *
 * Everything the plan concluded is concluded again here, on a snapshot that
 * cannot change under the write. Returns `{ ok: true }` or `{ ok: false,
 * reason }` — a row that no longer qualifies is skipped with its reason, never
 * forced through on the strength of a stale scan.
 */
async function applyOneLink(db, FieldValue, item, { userId = null } = {}) {
  return db.runTransaction(async (tx) => {
    // ══ reads ══
    const docRef   = db.collection(DOC_COL.DOCUMENTS).doc(item.documentId);
    const washRef  = db.collection(ADAPTERS.wash.collection).doc(item.washId);
    const lockRef  = db.collection(DOC_COL.LOCKS).doc(postingLockId(ADAPTERS.wash.lockKind, item.washId));
    const claimRef = db.collection(DOC_COL.SOURCES).doc(sourceClaimId('wash', item.washId));

    const [docSnap, washSnap, lockSnap, claimSnap] = await Promise.all([
      tx.get(docRef), tx.get(washRef), tx.get(lockRef), tx.get(claimRef),
    ]);

    if (!docSnap.exists) return { ok: false, reason: REVIEW_REASONS.CHANGED_SINCE_SCAN };
    const doc = docSnap.data();
    if (doc.type !== 'invoice' || doc.status === 'cancelled'
      || doc.journalEntryId || doc.linkedJournalEntryId) {
      return { ok: false, reason: REVIEW_REASONS.CHANGED_SINCE_SCAN };
    }
    if (String(doc.sourceType || '') !== 'wash' || String(doc.sourceId || '') !== item.washId) {
      return { ok: false, reason: REVIEW_REASONS.CHANGED_SINCE_SCAN };
    }
    if (!washSnap.exists) return { ok: false, reason: REVIEW_REASONS.WASH_MISSING };
    if (!lockSnap.exists) return { ok: false, reason: REVIEW_REASONS.NOT_POSTED };

    // The lock must still name the entry the plan settled on. A wash reversed
    // and re-posted since the scan has a different one, and linking a filed
    // invoice to it is a decision, not a migration.
    const entryId = String(lockSnap.data().entryId || '');
    if (!entryId || entryId !== item.entryId) {
      return { ok: false, reason: REVIEW_REASONS.CHANGED_SINCE_SCAN };
    }
    const entrySnap = await tx.get(db.collection(DOC_COL.ENTRIES).doc(entryId));
    if (!entrySnap.exists) return { ok: false, reason: REVIEW_REASONS.ENTRY_MISSING };
    const entry = entrySnap.data();
    if (entry.status !== 'posted') return { ok: false, reason: REVIEW_REASONS.ENTRY_NOT_POSTED };

    const sale = saleTotalsOfEntry(entry.lines);
    if (Math.abs(sale.gross - round2(doc.gross)) >= MONEY_EPSILON) {
      return { ok: false, reason: REVIEW_REASONS.AMOUNT_MISMATCH };
    }

    // No other live document may already point at this entry — read as a
    // query inside the transaction, so a concurrent apply cannot slip past.
    const linkedElsewhere = await tx.get(
      db.collection(DOC_COL.DOCUMENTS).where('linkedJournalEntryId', '==', entryId),
    );
    if (linkedElsewhere.docs.some((x) => x.id !== item.documentId && x.data().status !== 'cancelled')) {
      return { ok: false, reason: REVIEW_REASONS.ALREADY_LINKED };
    }

    const verdict = claimVerdict(claimSnap.exists ? claimSnap.data() : null, item.documentId);
    if (!verdict.ok) return { ok: false, reason: verdict.reason };

    // ══ writes ══
    tx.update(docRef, {
      issueMode: 'linked',
      washId: item.washId,
      linkedJournalEntryId: entryId,
      linkedJournalEntryNumber: entry.entryNumber ?? null,
      supplyDate: String(washSnap.data().wash_date || '').slice(0, 10) || null,
      linkMethod: LINK_METHOD,
      linkedBy: userId,
      linkedAt: FieldValue.serverTimestamp(),
    });
    // The claim always ends HELD by this document. Leaving a released claim
    // released would let a second invoice be issued for a wash that already
    // has one.
    tx.set(claimRef, {
      sourceType: 'wash', sourceId: item.washId,
      documentId: item.documentId,
      documentNumber: doc.documentNumber || null,
      status: 'held',
      previousDocumentId: verdict.action === 'rehold'
        ? (claimSnap.data().previousDocumentId ?? null) : null,
      heldBy: userId,
      heldAt: FieldValue.serverTimestamp(),
      at: FieldValue.serverTimestamp(),
    }, { merge: true });
    tx.set(db.collection(DOC_COL.AUDIT).doc(), {
      action: 'link', collectionName: DOC_COL.DOCUMENTS, documentId: item.documentId,
      userId,
      before: { linkedJournalEntryId: null, claimStatus: claimSnap.exists ? claimSnap.data().status : null },
      after: {
        linkedJournalEntryId: entryId, washId: item.washId,
        method: LINK_METHOD, claimStatus: 'held', claimAction: verdict.action,
      },
      note: `ربط ${doc.documentNumber} بقيد رقم ${entry.entryNumber ?? '—'} للغسلة ${item.washId} `
        + `(مطابقة معلنة، إجمالي ${sale.gross.toFixed(2)})`,
      at: FieldValue.serverTimestamp(),
      atIso: new Date().toISOString(),
    });

    return { ok: true, entryId, entryNumber: entry.entryNumber ?? null };
  });
}

/**
 * Runs the plan against the database.
 *
 * `apply: false` (the default) reads and decides and writes nothing — the
 * dry-run you look at before you let it touch anything. `apply: true` still
 * re-decides every row inside its own transaction; the plan only says which
 * rows are worth trying.
 */
export async function runLegacyInvoiceLinks(db, FieldValue, { apply = false } = {}, { userId = null } = {}) {
  const [docSnap, washSnap, entrySnap, lockSnap, claimSnap] = await Promise.all([
    db.collection(DOC_COL.DOCUMENTS).get(),
    db.collection(ADAPTERS.wash.collection).get(),
    db.collection(DOC_COL.ENTRIES).get(),
    db.collection(DOC_COL.LOCKS).get(),
    db.collection(DOC_COL.SOURCES).get(),
  ]);
  const rows = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const plan = planLegacyInvoiceLinks({
    documents: rows(docSnap),
    washes:    rows(washSnap),
    entries:   rows(entrySnap),
    locks:     rows(lockSnap),
    claims:    rows(claimSnap),
  });

  if (!apply || plan.linkable.length === 0) {
    return { ...plan, applied: 0, skipped: [], dryRun: true };
  }

  const skipped = [];
  let applied = 0;
  // Sequential: two rows can contend for the same claim document, and a
  // transaction retry storm is slower than doing them in order.
  for (const item of plan.linkable) {
    const result = await applyOneLink(db, FieldValue, item, { userId });
    if (result.ok) applied += 1;
    else skipped.push({ ...item, reason: result.reason });
  }

  return {
    ...plan,
    // Rows that failed re-validation belong with the review list, not silently
    // dropped: "we planned 5 and wrote 3" has to say which two and why.
    linkable: plan.linkable.filter((i) => !skipped.some((s) => s.documentId === i.documentId)),
    review: [...plan.review, ...skipped],
    skipped,
    applied,
    dryRun: false,
  };
}
