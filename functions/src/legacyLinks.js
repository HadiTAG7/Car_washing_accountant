// ═══════════════════════════════════════════════════════════════════════════
// ربط الفواتير القديمة بقيودها — a dry-run first, and never a guess
// ═══════════════════════════════════════════════════════════════════════════
// Invoices issued before the two-path split carry neither `journalEntryId` nor
// `linkedJournalEntryId`. Nothing can be credited against them, because a note
// needs an accounting original to reduce — so they are not a footnote in the
// limits list, they are a migration that has to run before this goes live.
//
// The rule that makes it safe to run at all: **a link is only ever adopted
// when the document already DECLARES it.** A legacy invoice that says
// `sourceType: 'wash', sourceId: 'w1'` is asserting which record it is for;
// this tool verifies that assertion against the lock and the posted entry and
// adopts it only when all four agree — record exists, lock exists, entry is
// posted, and the money matches to the halala.
//
// Everything else goes to a review list. Matching by "same day, same amount"
// would be a guess, and a guess here writes a tax document's link to a journal
// entry it may not belong to. The review rows carry the candidates a human
// would look at, clearly as information, never as a decision.
//
// Nothing historical is rewritten. The tool writes link fields only —
// `linkedJournalEntryId`, `linkedJournalEntryNumber`, `washId`, `issueMode`,
// `supplyDate`. Numbers, sequences, dates, totals, VAT and QR payloads are
// never touched.
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
};

/** Invoices that still have no ledger link of any kind. */
export function legacyCandidates(documents) {
  return (documents || []).filter((d) => d.type === 'invoice'
    && d.status !== 'cancelled'
    && !d.journalEntryId
    && !d.linkedJournalEntryId);
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

  const linkable = [];
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

    // A claim held by a DIFFERENT document means two papers for one record —
    // a human decides which one is real.
    const claim = claimById.get(sourceClaimId('wash', declared));
    if (claim && claim.status !== 'released' && String(claim.documentId) !== String(doc.id)) {
      review.push({
        ...row, washId: declared, reason: REVIEW_REASONS.ALREADY_CLAIMED,
        claimedBy: claim.documentNumber || claim.documentId || null,
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

    linkable.push({
      ...row,
      washId: declared,
      entryId: entry.id,
      entryNumber: entry.entryNumber ?? null,
      entryGross: sale.gross,
      supplyDate: String(wash.wash_date || '').slice(0, 10) || null,
      claimMissing: !claim,
      method: LINK_METHOD,
    });
  }

  return {
    scanned: (documents || []).filter((d) => d.type === 'invoice').length,
    candidates: linkable.length + review.length,
    linkable,
    review,
  };
}

/**
 * Runs the plan against the database.
 *
 * `apply: false` (the default) reads and decides and writes nothing — the
 * dry-run you look at before you let it touch anything.
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
    return { ...plan, applied: 0, dryRun: true };
  }

  // One batch per document plus its claim, so a failure mid-run leaves each
  // document either fully linked or untouched — never half.
  let applied = 0;
  for (const item of plan.linkable) {
    const batch = db.batch();
    batch.update(db.collection(DOC_COL.DOCUMENTS).doc(item.documentId), {
      // Link fields ONLY. The number, the sequence, the year, `issueDate`, the
      // totals, the VAT rate and the QR payload are what a filed document says
      // and are never restated by a migration.
      issueMode: 'linked',
      washId: item.washId,
      linkedJournalEntryId: item.entryId,
      linkedJournalEntryNumber: item.entryNumber,
      supplyDate: item.supplyDate,
      linkMethod: LINK_METHOD,
      linkedBy: userId,
      linkedAt: FieldValue.serverTimestamp(),
    });
    if (item.claimMissing) {
      batch.set(db.collection(DOC_COL.SOURCES).doc(sourceClaimId('wash', item.washId)), {
        sourceType: 'wash', sourceId: item.washId,
        documentId: item.documentId, documentNumber: item.documentNumber,
        status: 'held',
        previousDocumentId: null,
        at: FieldValue.serverTimestamp(),
      });
    }
    batch.set(db.collection(DOC_COL.AUDIT).doc(), {
      action: 'link', collectionName: DOC_COL.DOCUMENTS, documentId: item.documentId,
      userId, before: { linkedJournalEntryId: null },
      after: { linkedJournalEntryId: item.entryId, washId: item.washId, method: LINK_METHOD },
      note: `ربط ${item.documentNumber} بقيد رقم ${item.entryNumber} للغسلة ${item.washId} `
        + `(مطابقة معلنة، إجمالي ${item.entryGross.toFixed(2)})`,
      at: FieldValue.serverTimestamp(),
      atIso: new Date().toISOString(),
    });
    await batch.commit();
    applied += 1;
  }

  return { ...plan, applied, dryRun: false };
}
