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
  startupParentHasLegacySpend, startupParentHasLegacyTaxFields,
  startupPlanUpdateProblems, LEGACY_BLOCKS_ENTRY,
} from './startupMigration.js';

const COL = {
  ITEMS: 'startup_costs',
  ENTRIES: 'startup_cost_entries',
  LOCKS: 'posting_locks',
  PERIODS: 'accounting_periods',
  AUDIT: 'audit_logs',
  JOURNAL: 'journal_entries',
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

/** The stored parent in the vocabulary the shared rules speak. */
function parentAsApp(id, row) {
  return {
    id,
    itemName: row.item_name,
    plannedAmount: Number(row.budgeted_amount) || 0,
    actualAmount: round2(row.actual_amount),
    isTaxInvoice: row.is_tax_invoice === true,
    invoiceNumber: row.invoice_number || '',
    invoiceDate: row.invoice_date || '',
    supplier: row.supplier || '',
    vatAmount: row.vat_amount ?? null,
    vatRate: row.vat_rate ?? null,
    invoiceUrl: row.invoice_url || '',
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

    // ── الصرف القديم يُحوَّل، ولا يُدفن تحت مصروف جديد ──
    // Checked HERE, inside the transaction, and not in the form: a parent that
    // still holds its own `actual_amount` or its own invoice fields is a
    // record in mid-migration. Adding a child recomputed `actual_amount` as
    // SUM(children) — 1,150 became 100 — and the child's mere existence took
    // the parent out of the VAT report's parent pass, so its invoice stopped
    // being counted. Two silent losses from one write.
    if (startupParentHasLegacySpend(parentAsApp(id, parent), { hasEntries: entries.length > 0 })) {
      throw new StartupCostError(LEGACY_BLOCKS_ENTRY);
    }

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

// ─── النقل بين البنود ────────────────────────────────────────────────────
/**
 * ينقل مصروفاً من بندِ تأسيسٍ إلى آخر — ويُعيد اشتقاق تجميعتَي الأبوين معاً.
 *
 * ── لماذا هذا محايدٌ تجاه الدفاتر ──
 * The wager this whole operation rests on, stated so it can be checked: the
 * ledger does not know which parent an entry belongs to. `ADAPTERS.startup`
 * reads the ENTRY — `description` is the entry's own, the debit account is a
 * constant (`EXPENSE_ACCOUNT.startup` → 1500), `sourceId` is the entry's id
 * and the lock is `startup__<entryId>`. The parent's name appears in none of
 * them. So a move — even of a POSTED entry — changes no journal entry, no
 * lock and no account; it changes only which parent sums it. The test
 * «مصروف مُرحَّل يُنقل والقيد لا يتغيّر» reads the entry and the lock back
 * afterwards and demands they are byte-identical, because a claim this load-
 * bearing should be proven rather than asserted in a comment.
 *
 * ── ولماذا لا بد أن يكون خادمياً ──
 * Two roll-ups have to move as one. A rule cannot sum siblings (no fold) and
 * cannot write two documents, so a client doing this would leave one parent
 * describing rows it no longer owns for however long the second write took —
 * or forever, if it failed.
 */
export async function moveStartupEntry(db, FieldValue, { entryId, toParentId }, {
  userId = null, role = 'operator', onBeforeCommit = null,
} = {}) {
  requireRole(role, WRITE_ROLES, 'نقل مصروف تأسيس');
  const eid = String(entryId ?? '').trim();
  const toId = String(toParentId ?? '').trim();
  if (!eid) throw new StartupCostError('معرّف المصروف مطلوب.', { code: 'invalid-argument' });
  if (!toId) throw new StartupCostError('معرّف البند المنقول إليه مطلوب.', { code: 'invalid-argument' });

  return db.runTransaction(async (tx) => {
    const entryRef = db.collection(COL.ENTRIES).doc(eid);
    const entrySnap = await tx.get(entryRef);
    if (!entrySnap.exists) {
      throw new StartupCostError('المصروف غير موجود.', { code: 'not-found' });
    }
    const row = entrySnap.data();
    const fromId = String(row.startup_cost_id ?? '');

    // Refused rather than treated as a no-op: a caller asking to move a row
    // where it already is has misread something, and an audit record saying
    // «نُقل من س إلى س» is noise that hides the real moves.
    if (fromId === toId) {
      throw new StartupCostError('المصروف مسجَّل على هذا البند أصلاً.', { code: 'invalid-argument' });
    }

    // Both parents on ONE snapshot, each with a transactional query over its
    // children — the phantom guard: an entry arriving at either parent between
    // the read and the commit aborts and retries, so neither roll-up can be
    // written from a set that changed underneath it.
    const [source, target] = await Promise.all([
      readParentAndEntries(db, tx, fromId),
      readParentAndEntries(db, tx, toId),
    ]);

    // Same refusal that guards `addStartupEntry`, for the same reason: a
    // parent still holding its own legacy `actual_amount` would have that
    // amount silently replaced by SUM(children) the moment it gained one.
    if (startupParentHasLegacySpend(parentAsApp(toId, target.parent), {
      hasEntries: target.entries.length > 0,
    })) {
      throw new StartupCostError(LEGACY_BLOCKS_ENTRY);
    }

    if (onBeforeCommit) await onBeforeCommit();

    tx.update(entryRef, {
      startup_cost_id: toId,
      moved_at: FieldValue.serverTimestamp(),
      moved_by: userId,
    });

    const before = {
      from: { id: fromId, actualAmount: round2(source.parent.actual_amount) },
      to: { id: toId, actualAmount: round2(target.parent.actual_amount) },
    };
    const fromRollup = applyRollup(
      tx, source.parentRef, source.parent,
      source.entries.filter((e) => e.id !== eid).map((e) => e.amount),
      FieldValue, userId,
    );
    const toRollup = applyRollup(
      tx, target.parentRef, target.parent,
      [...target.entries.map((e) => e.amount), row.amount],
      FieldValue, userId,
    );

    tx.set(db.collection(COL.AUDIT).doc(), auditRecord({
      action: 'startup-entry-move', documentId: eid, userId,
      before,
      after: {
        from: { id: fromId, ...fromRollup },
        to: { id: toId, ...toRollup },
        amount: round2(row.amount),
      },
      note: `نقل مصروف تأسيس من البند ${fromId} إلى ${toId} — القيد في الدفاتر لم يتغيّر`,
    }, FieldValue));

    return { id: eid, fromParentId: fromId, toParentId: toId, from: fromRollup, to: toRollup };
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
    const app = parentAsApp(id, parent);

    // ── فاتورة قديمة بلا مبلغ: تُمسح بقرار، لا بصمت ──
    // A parent can hold the invoice half of a legacy record with no amount
    // behind it — a flag and a supplier typed in and never spent against.
    // Those fields are a claim the VAT report reads, so they block adding an
    // ordinary entry; and there is no amount to turn into a document, so the
    // conversion has nothing to build. Rather than leave the item frozen, the
    // accountant clears them EXPLICITLY here, and it is audited as its own
    // action. Nothing is erased as a side effect of something else.
    if (app.actualAmount === 0 && startupParentHasLegacyTaxFields(app)) {
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
        action: 'startup-clear-legacy-tax', documentId: id, userId,
        before: {
          actualAmount: 0, isTaxInvoice: app.isTaxInvoice,
          invoiceNumber: app.invoiceNumber || null, supplier: app.supplier || null,
        },
        after: { isTaxInvoice: false, entryCount: 0, role },
        note: `مسح بيانات فاتورة قديمة بلا مبلغ عن بند التأسيس ${id}`,
      }, FieldValue));
      return { id: entryId, parentId: id, created: false, cleared: true };
    }

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

// ─── تعديل الخطة ─────────────────────────────────────────────────────────
/**
 * Edits the plan and RE-DERIVES the status from it, in one transaction.
 *
 * `status` used to be a plain column: `startupRollup` derived it whenever an
 * entry changed, and the client could also write it by hand and could edit
 * `budgeted_amount` straight through the rules. So raising a budget from 1,000
 * to 2,000 against 1,500 of spend left the row saying `completed` — the number
 * it was derived from had moved and nothing re-ran the derivation.
 *
 * Now the budget can only change here, and changing it recomputes the status
 * from the entries the transaction can actually see. A patch that tries to
 * carry `status`, `actual_amount` or the tax block is refused rather than
 * ignored: a caller that sent them believes they took effect.
 */
export async function updateStartupPlan(db, FieldValue, { parentId, patch = {} }, {
  userId = null, role = 'operator', onBeforeCommit = null,
} = {}) {
  requireRole(role, WRITE_ROLES, 'تعديل خطة رسوم التأسيس');
  const id = String(parentId ?? '').trim();
  if (!id) throw new StartupCostError('معرّف البند مطلوب.', { code: 'invalid-argument' });

  const problems = startupPlanUpdateProblems(patch);
  if (problems.length) throw new StartupCostError(problems[0], { code: 'invalid-argument' });

  return db.runTransaction(async (tx) => {
    const { parentRef, parent, entries } = await readParentAndEntries(db, tx, id);
    if (onBeforeCommit) await onBeforeCommit();

    const next = {};
    if ('category' in patch) next.category = String(patch.category || '');
    if ('itemName' in patch) next.item_name = String(patch.itemName).trim();
    if ('quantity' in patch) next.quantity = Math.max(1, Math.trunc(Number(patch.quantity)));
    if ('plannedAmount' in patch) next.budgeted_amount = round2(patch.plannedAmount);

    // The budget the roll-up is judged against is the one being written, so a
    // 1,000 → 2,000 edit takes effect in the SAME snapshot that re-derives.
    const planned = 'budgeted_amount' in next
      ? next.budgeted_amount : (Number(parent.budgeted_amount) || 0);
    const rollup = startupRollup(entries.map((e) => e.amount), planned);

    tx.update(parentRef, {
      ...next,
      actual_amount: rollup.actualAmount,
      status: rollup.status,
      updated_at: FieldValue.serverTimestamp(),
      updated_by: userId,
    });
    tx.set(db.collection(COL.AUDIT).doc(), auditRecord({
      action: 'startup-plan-update', documentId: id, userId,
      before: {
        itemName: parent.item_name ?? null,
        plannedAmount: Number(parent.budgeted_amount) || 0,
        actualAmount: round2(parent.actual_amount),
        status: parent.status ?? null,
      },
      after: { ...next, ...rollup, entryCount: entries.length },
      note: `تعديل خطة بند التأسيس ${id}`,
    }, FieldValue));
    return { id, ...rollup };
  });
}

// ─── حذف الخطة ───────────────────────────────────────────────────────────
/**
 * Deletes a plan — only when there is nothing hanging off it.
 *
 * `allow delete: if isOperator()` used to sit on the collection, so a plan
 * could be removed while its `startup_cost_entries`, their journal entries and
 * their posting locks stayed behind, referring to a parent that no longer
 * existed. Nothing detected it afterwards; the sub-ledger simply had rows
 * whose owner was gone.
 *
 * NOT a cascade. Deleting a plan must not quietly delete spend documents, and
 * it certainly must not touch one that is in the books — a posted entry is
 * reversed, which releases its lock, and only then may its document go. So
 * this refuses and says which step is missing.
 */
export async function deleteStartupPlan(db, FieldValue, { parentId }, {
  userId = null, role = 'operator', onBeforeCommit = null,
} = {}) {
  requireRole(role, WRITE_ROLES, 'حذف خطة رسوم التأسيس');
  const id = String(parentId ?? '').trim();
  if (!id) throw new StartupCostError('معرّف البند مطلوب.', { code: 'invalid-argument' });

  return db.runTransaction(async (tx) => {
    const { parentRef, parent, entries } = await readParentAndEntries(db, tx, id);
    // A lock or a live entry naming the plan itself, or the legacy document it
    // would have produced. Read transactionally like everything else, so the
    // refusal and the delete are decided on one snapshot.
    const [selfLock, legacyLock, liveEntries] = await Promise.all([
      tx.get(db.collection(COL.LOCKS).doc(postingLockId('startup', id))),
      tx.get(db.collection(COL.LOCKS).doc(postingLockId('startup', legacyEntryIdFor(id)))),
      tx.get(db.collection(COL.JOURNAL).where('sourceId', '==', id)),
    ]);
    if (onBeforeCommit) await onBeforeCommit();

    if (entries.length) {
      throw new StartupCostError(
        `لهذا البند ${entries.length} مصروفاً في سجله — لا يُحذف وهي قائمة. `
        + 'احذف المصاريف غير المُرحّلة أولاً؛ والمُرحّل منها يُعكس قيده ثم يُحذف مصروفه.',
      );
    }
    if ((Number(parent.actual_amount) || 0) !== 0) {
      throw new StartupCostError(
        `البند يحمل مبلغاً فعلياً (${round2(parent.actual_amount).toFixed(2)}) مسجَّلاً عليه مباشرة — `
        + 'حوّله إلى مستند مؤرَّخ أولاً، أو اطلب من المحاسب مسحه صراحةً.',
      );
    }
    const live = liveEntries.docs.map((x) => x.data()).filter((e) => e.status === 'posted' && !e.reversalOf);
    if (selfLock.exists || legacyLock.exists || live.length) {
      throw new StartupCostError(
        'البند مرتبط بقيد مُرحّل أو بقفل ترحيل — اعكس القيد أولاً، فالعكس هو ما يفكّ القفل.',
      );
    }

    tx.delete(parentRef);
    tx.set(db.collection(COL.AUDIT).doc(), auditRecord({
      action: 'startup-plan-delete', documentId: id, userId,
      before: {
        itemName: parent.item_name ?? null,
        plannedAmount: Number(parent.budgeted_amount) || 0,
        actualAmount: round2(parent.actual_amount),
        entryCount: 0,
      },
      after: null,
      note: `حذف خطة بند التأسيس ${id}`,
    }, FieldValue));
    return { id, deleted: true };
  });
}
