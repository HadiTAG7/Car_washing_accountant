// ═══════════════════════════════════════════════════════════════════════════
// سجل مصاريف بند التأسيس — على الخادم وحده
// ═══════════════════════════════════════════════════════════════════════════
// `startup_cost_entries` was client-writable and `startup_costs` sat in the
// permissive operational wildcard, so an operator could write EVERY field on
// the parent — `actual_amount` and the whole tax-invoice block included. The
// accounting fix removed those from the forms; leaving them writable meant one
// direct write put them back, and a parent-level amount with an invoice on it
// enters the VAT return and can never reach `1200`.
//
// Three things a Firestore rule cannot do, and every write needs all three:
//
//   1. **Re-sum the siblings.** Rules have no fold, so a roll-up over a list
//      of unknown length is inexpressible; `actual_amount` would be whatever
//      the client last claimed.
//   2. **Re-derive `status`** from that sum against the budget.
//   3. **Check the posting lock and update the parent ATOMICALLY.** A rule can
//      see a lock. It cannot make the lock check and the parent's recompute
//      happen together, so a delete could remove an entry and leave the parent
//      describing a row that no longer exists.
//
// So the rules deny client writes and these three functions are the only door.
// Each one:
//   • takes the role from the verified token, never from the payload;
//   • reads the parent AND its sibling entries INSIDE the transaction — a
//     transactional query is part of the read set, so an entry appearing
//     mid-flight aborts the commit instead of being missed;
//   • checks `posting_locks` before touching an entry that is in the books;
//   • recomputes `actual_amount` and `status` from what will actually exist;
//   • writes an audit record naming the token's user.
//
// Nothing is trusted from the client except the fields of the row itself, and
// those go through the same validation the forms run.
// ═══════════════════════════════════════════════════════════════════════════

import { postingLockId, round2, periodKeyOf } from './invariants.js';
import { legacyLockIdFor } from './posting.js';
import {
  startupEntryProblems, startupConversionProblems, startupRollup,
  buildStartupConversionEntry, legacyEntryIdFor,
} from './startupMigration.js';

const COL = {
  ITEMS: 'startup_costs',
  ENTRIES: 'startup_cost_entries',
  LOCKS: 'posting_locks',
  PERIODS: 'accounting_periods',
  AUDIT: 'audit_logs',
};

/** A refusal the caller is meant to read, not a bug. */
export class StartupCostError extends Error {
  constructor(message, { code = 'failed-precondition' } = {}) {
    super(message);
    this.name = 'StartupCostError';
    this.code = code;
  }
}

/** Recording spend is operational work; migrating history is not. */
const WRITE_ROLES = ['admin', 'accountant', 'operator'];
const MIGRATE_ROLES = ['admin', 'accountant'];

function requireRole(role, allowed, what) {
  if (!allowed.includes(String(role || ''))) {
    throw new StartupCostError(
      `${what} مقصور على ${allowed.map((r) => ROLE_LABEL[r] || r).join(' أو ')}.`,
      { code: 'permission-denied' },
    );
  }
}
const ROLE_LABEL = { admin: 'المدير', accountant: 'المحاسب', operator: 'المشغّل' };

function auditRecord({ action, documentId, userId, before, after, note }, FieldValue) {
  return {
    action,
    collectionName: COL.ENTRIES,
    documentId: documentId ?? null,
    userId: userId ?? null,
    note: note || '',
    before: before ?? null,
    after: after ?? null,
    at: FieldValue.serverTimestamp(),
    atIso: new Date().toISOString(),
  };
}

/**
 * The parent and its entries, read transactionally.
 *
 * The QUERY is the phantom guard. Firestore counts a transactional query in
 * the read set, so an entry inserted for this parent between the read and the
 * commit changes the result and aborts the transaction — which is precisely
 * the race the old client-side flow had, where a `getDocs` taken before
 * `runTransaction` could be stale by the time it mattered.
 */
async function readParentAndEntries(db, tx, parentId) {
  const parentRef = db.collection(COL.ITEMS).doc(parentId);
  const [parentSnap, entriesSnap] = await Promise.all([
    tx.get(parentRef),
    tx.get(db.collection(COL.ENTRIES).where('startup_cost_id', '==', parentId)),
  ]);
  if (!parentSnap.exists) {
    throw new StartupCostError('بند رسوم التأسيس غير موجود.', { code: 'not-found' });
  }
  return {
    parentRef,
    parent: parentSnap.data(),
    entries: entriesSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  };
}

/** True when this entry has already been carried into the books. */
async function entryIsPosted(db, tx, entryId) {
  const [own, legacy] = await Promise.all([
    tx.get(db.collection(COL.LOCKS).doc(postingLockId('startup', entryId))),
    tx.get(db.collection(COL.LOCKS).doc(legacyLockIdFor('startup', entryId) || `expense__${entryId}`)),
  ]);
  return (own.exists && own.data()) || (legacy.exists && legacy.data()) || null;
}

/** Writes the parent's roll-up from the entries that will exist. */
function applyRollup(tx, parentRef, parent, amounts, FieldValue, userId) {
  const { actualAmount, status } = startupRollup(amounts, parent.budgeted_amount);
  tx.update(parentRef, {
    actual_amount: actualAmount,
    status,
    updated_at: FieldValue.serverTimestamp(),
    updated_by: userId,
  });
  return { actualAmount, status };
}

/** The stored shape of one sub-ledger entry, built from validated input. */
function entryDocument(parentId, entry, FieldValue, userId, extra = {}) {
  return {
    startup_cost_id: parentId,
    description: String(entry.description || '').trim(),
    amount: round2(entry.amount),
    spent_date: String(entry.spentDate || '').slice(0, 10),
    notes: entry.notes ? String(entry.notes).trim() : null,
    is_tax_invoice: entry.isTaxInvoice === true,
    invoice_url: String(entry.invoiceUrl || '').trim() || null,
    invoice_number: String(entry.invoiceNumber || '').trim() || null,
    invoice_date: String(entry.invoiceDate || '').slice(0, 10) || null,
    supplier: String(entry.supplier || '').trim() || null,
    vat_amount: entry.vatAmount ?? null,
    vat_rate: entry.vatRate ?? null,
    price_mode: entry.priceMode === 'exclusive' ? 'exclusive' : 'inclusive',
    vat_deductible: entry.vatDeductible !== false,
    payment_method: ['cash', 'card', 'transfer', 'credit'].includes(entry.paymentMethod)
      ? entry.paymentMethod : 'cash',
    created_at: FieldValue.serverTimestamp(),
    created_by: userId,
    ...extra,
  };
}

// ─── الإضافة ─────────────────────────────────────────────────────────────
/**
 * Adds one spend document to a startup item and re-derives the parent.
 *
 * The roll-up is computed HERE, from the entries the transaction can see plus
 * the one it is writing — never from a total the client sends, which would be
 * a claim about rows the sender may not have read.
 */
export async function addStartupEntry(db, FieldValue, { parentId, entry = {} }, {
  userId = null, role = 'operator', onBeforeCommit = null,
} = {}) {
  requireRole(role, WRITE_ROLES, 'تسجيل مصروف تأسيس');
  const id = String(parentId ?? '').trim();
  if (!id) throw new StartupCostError('معرّف البند مطلوب.', { code: 'invalid-argument' });

  const problems = startupEntryProblems(entry);
  if (problems.length) throw new StartupCostError(problems[0], { code: 'invalid-argument' });

  return db.runTransaction(async (tx) => {
    const { parentRef, parent, entries } = await readParentAndEntries(db, tx, id);
    if (onBeforeCommit) await onBeforeCommit();

    const entryRef = db.collection(COL.ENTRIES).doc();
    tx.set(entryRef, entryDocument(id, entry, FieldValue, userId));
    const rollup = applyRollup(
      tx, parentRef, parent,
      [...entries.map((e) => e.amount), entry.amount],
      FieldValue, userId,
    );
    tx.set(db.collection(COL.AUDIT).doc(), auditRecord({
      action: 'startup-entry-add', documentId: entryRef.id, userId,
      before: { actualAmount: round2(parent.actual_amount), entryCount: entries.length },
      after: { ...rollup, entryCount: entries.length + 1, amount: round2(entry.amount) },
      note: `إضافة مصروف تأسيس على البند ${id}`,
    }, FieldValue));
    return { id: entryRef.id, parentId: id, ...rollup };
  });
}

// ─── الحذف ───────────────────────────────────────────────────────────────
/**
 * Removes a spend document — unless it is already in the books.
 *
 * The lock is read inside the transaction, so the refusal and the roll-up are
 * decided on one snapshot. A posted entry is corrected by reversing its entry,
 * which releases the lock; deleting it here would leave the ledger describing
 * a document that no longer exists.
 */
export async function deleteStartupEntry(db, FieldValue, { entryId }, {
  userId = null, role = 'operator', onBeforeCommit = null,
} = {}) {
  requireRole(role, WRITE_ROLES, 'حذف مصروف تأسيس');
  const eid = String(entryId ?? '').trim();
  if (!eid) throw new StartupCostError('معرّف المصروف مطلوب.', { code: 'invalid-argument' });

  return db.runTransaction(async (tx) => {
    const entryRef = db.collection(COL.ENTRIES).doc(eid);
    const entrySnap = await tx.get(entryRef);
    if (!entrySnap.exists) {
      throw new StartupCostError('المصروف غير موجود.', { code: 'not-found' });
    }
    const row = entrySnap.data();
    const parentId = String(row.startup_cost_id ?? '');
    const [{ parentRef, parent, entries }, lock] = await Promise.all([
      readParentAndEntries(db, tx, parentId),
      entryIsPosted(db, tx, eid),
    ]);
    if (lock) {
      throw new StartupCostError(
        `هذا المصروف مُرحّل بالقيد رقم ${lock.entryNumber ?? '—'} — لا يُحذف. `
        + 'اعكس القيد أولاً؛ العكس هو ما يفكّ القفل ويحرّر السجل.',
      );
    }
    if (onBeforeCommit) await onBeforeCommit();

    tx.delete(entryRef);
    const rollup = applyRollup(
      tx, parentRef, parent,
      entries.filter((e) => e.id !== eid).map((e) => e.amount),
      FieldValue, userId,
    );
    tx.set(db.collection(COL.AUDIT).doc(), auditRecord({
      action: 'startup-entry-delete', documentId: eid, userId,
      before: {
        actualAmount: round2(parent.actual_amount), entryCount: entries.length,
        amount: round2(row.amount), spentDate: row.spent_date ?? null,
      },
      after: { ...rollup, entryCount: entries.length - 1 },
      note: `حذف مصروف تأسيس من البند ${parentId}`,
    }, FieldValue));
    return { id: eid, parentId, ...rollup };
  });
}

// ─── ترحيل المبلغ القديم ─────────────────────────────────────────────────
/**
 * Turns a legacy parent-level `actual_amount` into a real spend document.
 *
 * Everything is re-read INSIDE the transaction: the parent, its entries, and
 * the closed periods. The old client-side version read all three before
 * `runTransaction` opened, so an entry added or a period closed in between was
 * invisible and the conversion committed on a snapshot that no longer
 * described the data.
 *
 * Restricted to admin and accountant. Migrating historical records decides
 * which period a deduction is claimed in; that is not day-to-day operational
 * work, and an operator recording today's spend has no business back-dating a
 * document into a quarter that may already have been filed.
 */
export async function convertLegacyStartupSpend(db, FieldValue, { parentId, form = {} }, {
  userId = null, role = 'accountant', onBeforeCommit = null,
} = {}) {
  requireRole(role, MIGRATE_ROLES, 'ترحيل مبلغ قديم إلى قيد');
  const id = String(parentId ?? '').trim();
  if (!id) throw new StartupCostError('معرّف البند مطلوب.', { code: 'invalid-argument' });

  const entryId = legacyEntryIdFor(id);

  return db.runTransaction(async (tx) => {
    const { parentRef, parent, entries } = await readParentAndEntries(db, tx, id);
    // The closed periods, transactionally — so a month closed mid-flight
    // aborts this and the retry sees it closed.
    const closedSnap = await tx.get(db.collection(COL.PERIODS).where('status', '==', 'closed'));
    const closedPeriods = new Set(
      closedSnap.docs.map((d) => d.data().periodKey || d.id).filter(Boolean),
    );
    if (onBeforeCommit) await onBeforeCommit();

    // Already converted: a no-op, so a retried click or a resumed sweep is
    // safe. Checked against what the transaction can SEE, not a flag.
    if (entries.some((e) => e.id === entryId)) {
      return { id: entryId, parentId: id, created: false };
    }
    // …and any OTHER entry means the item is already ledger-managed: its
    // `actual_amount` is a roll-up, not a figure of its own to move. This is
    // the concurrent-add case — the transactional query is what sees it.
    const app = {
      id,
      itemName: parent.item_name,
      actualAmount: round2(parent.actual_amount),
      invoiceUrl: parent.invoice_url || '',
    };
    const problems = startupConversionProblems(app, form, {
      hasEntries: entries.length > 0,
      closedPeriods,
    });
    if (problems.length) throw new StartupCostError(problems[0]);

    const built = buildStartupConversionEntry(app, form);
    const entryRef = db.collection(COL.ENTRIES).doc(entryId);
    tx.set(entryRef, entryDocument(id, built, FieldValue, userId, {
      notes: built.notes,
      converted_from_parent: true,
    }));
    const rollup = applyRollup(tx, parentRef, parent, [built.amount], FieldValue, userId);
    // ── والأب يعود خطةً ──
    // The tax fields are cleared in the SAME write, so a reader that has not
    // noticed the entry cannot claim the same VAT again. Half a conversion is
    // the double count the whole exercise removes.
    tx.update(parentRef, {
      is_tax_invoice: false,
      invoice_number: null,
      invoice_date: null,
      supplier: null,
      vat_amount: null,
      vat_rate: null,
      vat_deductible: true,
      converted_at: FieldValue.serverTimestamp(),
      converted_by: userId,
    });
    tx.set(db.collection(COL.AUDIT).doc(), auditRecord({
      action: 'startup-convert-legacy', documentId: entryId, userId,
      before: {
        actualAmount: app.actualAmount,
        isTaxInvoice: parent.is_tax_invoice === true,
        invoiceNumber: parent.invoice_number ?? null,
        entryCount: 0,
      },
      after: {
        ...rollup, entryCount: 1,
        spentDate: built.spentDate,
        invoiceDate: built.invoiceDate || null,
        periodKey: periodKeyOf(built.invoiceDate || built.spentDate),
        role,
      },
      note: `تحويل مبلغ بند التأسيس ${id} إلى مصروف مؤرّخ`,
    }, FieldValue));
    return { id: entryId, parentId: id, created: true, ...rollup };
  });
}
