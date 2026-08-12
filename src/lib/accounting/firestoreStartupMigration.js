// ═══════════════════════════════════════════════════════════════════════════
// تحويل المبلغ الفعلي على بند التأسيس إلى قيد له مستند — على Firestore
// ═══════════════════════════════════════════════════════════════════════════
// The rules live in ./startupMigration.js; this is the part that touches the
// database. Two properties matter and both are structural rather than
// hopeful:
//
//   • **Idempotency.** The entry's document id is derived from the parent
//     (`legacy__<parentId>`), so converting twice writes the SAME document
//     rather than a second one. There is no "converted" flag to trust and no
//     counter to race.
//   • **Atomicity.** The entry, the parent's roll-up and the clearing of the
//     parent's tax flag happen in one transaction. A half-done conversion —
//     an entry written while the parent still claims its own VAT — is exactly
//     the double count the whole exercise removes.
// ═══════════════════════════════════════════════════════════════════════════

import {
  doc, getDoc, getDocs, collection, query, where, runTransaction, serverTimestamp,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../firebaseClient';
import { mapStartupCost, toStartupCostEntryInsert } from '../mappers';
import {
  legacyEntryIdFor, startupConversionProblems, buildStartupConversionEntry,
} from './startupMigration';

const ITEMS = 'startup_costs';
const ENTRIES = 'startup_cost_entries';
const PERIODS = 'accounting_periods';

function requireDb() {
  if (!isFirebaseConfigured) throw new Error('Firebase غير مُهيّأ.');
}

/** The months that are closed, so a conversion cannot aim an entry at one. */
async function closedPeriodKeys() {
  const snap = await getDocs(query(collection(db, PERIODS), where('status', '==', 'closed')));
  return new Set(snap.docs.map((d) => d.data().periodKey || d.id).filter(Boolean));
}

/** Existing sub-ledger entries for a parent — the double-count guard. */
async function entryIdsOf(parentId) {
  const snap = await getDocs(query(collection(db, ENTRIES), where('startup_cost_id', '==', parentId)));
  return snap.docs.map((d) => d.id);
}

/**
 * Turns a parent-level `actual_amount` into a real sub-ledger entry.
 *
 * `form` supplies what the legacy row cannot: `spentDate`, `paymentMethod`,
 * and — when it is a tax invoice — the invoice's number, date and supplier.
 * None of the three is inferred, and `created_at` is not used as any of them.
 *
 * Returns `{ id, created }`; `created: false` means the entry was already
 * there and nothing was written a second time.
 */
export async function convertStartupParentSpend(parentId, form = {}, { userId = null } = {}) {
  requireDb();
  const id = String(parentId ?? '').trim();
  if (!id) throw new Error('معرّف البند مطلوب.');

  const parentSnap = await getDoc(doc(db, ITEMS, id));
  if (!parentSnap.exists()) throw new Error('البند غير موجود.');
  const parent = mapStartupCost({ id, ...parentSnap.data() });

  const entryId = legacyEntryIdFor(id);
  const existing = await entryIdsOf(id);
  // An entry that is NOT this conversion's own means the item is already
  // ledger-managed and its actual amount is a roll-up, not a figure to move.
  const otherEntries = existing.filter((x) => x !== entryId);

  const problems = startupConversionProblems(parent, form, {
    hasEntries: otherEntries.length > 0,
    closedPeriods: await closedPeriodKeys(),
  });
  if (problems.length) throw new Error(problems[0]);

  const entryRef = doc(db, ENTRIES, entryId);
  const parentRef = doc(db, ITEMS, id);

  return runTransaction(db, async (tx) => {
    const [entrySnap, freshParent] = await Promise.all([tx.get(entryRef), tx.get(parentRef)]);
    if (!freshParent.exists()) throw new Error('البند غير موجود.');
    if (entrySnap.exists()) {
      // Already converted. Re-running is a no-op rather than a duplicate —
      // and rather than an error, so a retried click or a resumed sweep is
      // safe.
      return { id: entryId, created: false };
    }
    const amount = Math.max(0, Number(freshParent.data().actual_amount) || 0);
    if (!(amount > 0)) throw new Error('لا يوجد مبلغ فعلي على البند ليُحوَّل.');

    const row = buildStartupConversionEntry({ ...parent, actualAmount: amount }, form);
    const { id: _dropped, startupCostId, ...rest } = row;
    tx.set(entryRef, {
      ...toStartupCostEntryInsert({ ...rest, startupCostId }),
      created_at: serverTimestamp(),
      created_by: userId,
      converted_from_parent: true,
    });
    // ── والأب يعود خطةً ──
    // `actual_amount` stays at the same figure because it is now the SUM of
    // exactly one entry. The tax fields are CLEARED: leaving them would let a
    // reader that has not noticed the entry claim the same VAT again, and the
    // whole point is that the two can never both count.
    tx.update(parentRef, {
      actual_amount: amount,
      is_tax_invoice: false,
      invoice_number: null,
      invoice_date: null,
      supplier: null,
      vat_amount: null,
      vat_rate: null,
      vat_deductible: true,
      converted_at: serverTimestamp(),
      converted_by: userId,
    });
    return { id: entryId, created: true };
  });
}

export { legacyEntryIdFor };
