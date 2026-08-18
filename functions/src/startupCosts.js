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
  unitIsListed,
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
    // السكن الذي يخصّه هذا المصروف — تفصيلٌ داخل البند، لا بندٌ آخر.
    // Null is a real answer («غير محدد»), not a missing one: an expense that
    // belongs to the item as a whole has no unit and must not be forced into
    // one.
    unit: entry.unit ? String(entry.unit).trim() : null,
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

    // ── السكن يُتحقَّق داخل المعاملة، لا في النموذج ──
    // Checked against the list the transaction can SEE, so a unit renamed or
    // removed a moment ago cannot be written against. A typo here would mint
    // a phantom housing unit that shows as its own group with its own total —
    // money filed under a place that does not exist.
    if (entry.unit && !unitIsListed(entry.unit, parent.units || [])) {
      throw new StartupCostError(
        `«${entry.unit}» ليس من سكنات هذا البند. أضِفه إلى قائمة السكنات أولاً من تعديل البند.`,
        { code: 'invalid-argument' },
      );
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

// ─── التعديل ─────────────────────────────────────────────────────────────

/** الأعمدة التي تصل الدفاتر برقمٍ أو بتاريخ — لا تتغيّر بعد الترحيل. */
const LEDGER_BOUND_COLUMNS = [
  'amount', 'spent_date', 'is_tax_invoice', 'invoice_number', 'invoice_date',
  'supplier', 'vat_amount', 'vat_rate', 'price_mode', 'vat_deductible',
  'payment_method',
];

/** ما يُقبل في رقعة التعديل — بأسماء التطبيق كما يرسلها النموذج. */
const EDITABLE_FIELDS = [
  'description', 'amount', 'spentDate', 'notes', 'invoiceUrl', 'unit',
  'isTaxInvoice', 'invoiceNumber', 'invoiceDate', 'supplier',
  'vatAmount', 'vatRate', 'priceMode', 'vatDeductible', 'paymentMethod',
];

/**
 * الصف المخزَّن بشكل التطبيق.
 *
 * Exists so an edit is validated by `startupEntryProblems` — the SAME function
 * that guards creation. A second validator for edits is a second opinion about
 * what a valid expense is, and the two drift.
 */
function entryAsApp(row = {}) {
  return {
    description:   row.description || '',
    amount:        Number(row.amount) || 0,
    spentDate:     row.spent_date || '',
    notes:         row.notes || '',
    invoiceUrl:    row.invoice_url || '',
    isTaxInvoice:  row.is_tax_invoice === true,
    invoiceNumber: row.invoice_number || '',
    invoiceDate:   row.invoice_date || '',
    supplier:      row.supplier || '',
    vatAmount:     row.vat_amount ?? null,
    vatRate:       row.vat_rate ?? null,
    priceMode:     row.price_mode || 'inclusive',
    vatDeductible: row.vat_deductible !== false,
    paymentMethod: row.payment_method || 'cash',
    unit:          row.unit || '',
  };
}

/** أعمدة المستند بلا طوابع الإنشاء — للمقارنة وللكتابة معاً. */
function entryColumns(parentId, app, FieldValue, userId) {
  const doc = entryDocument(parentId, app, FieldValue, userId);
  delete doc.created_at;
  delete doc.created_by;
  return doc;
}

/**
 * يُبدّل الوصف القديم بالجديد أينما ظهر في نصّ القيد.
 *
 * ── لماذا استبدالٌ لا إعادة بناء ──
 * The journal narration is not the description; it WRAPS it — «سداد تزويد سكن
 * النزهه بمروحة» on the settlement line, the bare text on the expense line.
 * Rebuilding the entry from the posting rules would re-derive amounts and
 * accounts too, which is exactly what must not move. Substituting the old
 * text for the new changes the words and nothing else, and a narration that
 * never contained the old description is simply left alone.
 */
function renarrate(text, from, to) {
  const s = String(text ?? '');
  if (!from || !s.includes(from)) return s;
  return s.split(from).join(to);
}

/**
 * يعدّل مصروفاً مسجَّلاً — والقيد المُرحّل يتحدّث معه.
 *
 * ── ثلاث طبقات، لكلٍّ حكمٌ مختلف ──
 * `notes`, `invoice_url`, `unit` لا تصل الدفاتر إطلاقاً، فتُعدَّل دائماً.
 * والمبلغ والتاريخ وبيانات الضريبة تصل الدفاتر **برقم**: تغييرها بعد الترحيل
 * يجعل القيد يصف مستنداً لم يعد يقول ما قاله، فتُرفض — والتصحيح عكسٌ ثم
 * إعادة. والوصف حالةٌ ثالثة: يصل الدفاتر **نصّاً** فقط. فبدل أن يُترك القيد
 * يقول «النزهة» بينما المستند صار يقول «الشمال» — شاشتان تتناقضان — يُبدَّل
 * النص في القيد وسطوره في **نفس المعاملة**. لا مبلغ يتحرّك، ولا حساب، ولا
 * تاريخ، ولا رقم قيد.
 *
 * ── وحدّ ذلك: الفترة المقفلة ──
 * A closed period is closed for words as well as for numbers — its statements
 * have been read and its narration is part of what was read. So the refusal
 * there is the same refusal a posting gets, and it names the period.
 */
export async function updateStartupEntry(db, FieldValue, { entryId, patch = {} }, {
  userId = null, role = 'operator', onBeforeCommit = null,
} = {}) {
  requireRole(role, WRITE_ROLES, 'تعديل مصروف تأسيس');
  const eid = String(entryId ?? '').trim();
  if (!eid) throw new StartupCostError('معرّف المصروف مطلوب.', { code: 'invalid-argument' });

  const keys = Object.keys(patch || {});
  if (!keys.length) {
    throw new StartupCostError('لا حقول للتعديل.', { code: 'invalid-argument' });
  }
  const unknown = keys.filter((k) => !EDITABLE_FIELDS.includes(k));
  if (unknown.length) {
    // Refused out loud rather than dropped: a caller that sent a field and got
    // OK back believes it took effect.
    throw new StartupCostError(
      `حقول لا تُعدَّل من هنا: ${unknown.join('، ')}.`, { code: 'invalid-argument' },
    );
  }

  return db.runTransaction(async (tx) => {
    // ── كل القراءات أولاً ──
    // Firestore forbids a read after a write in the same transaction, and the
    // journal reads below depend on the lock read above.
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

    const before = entryAsApp(row);
    const next = { ...before, ...patch };

    const problems = startupEntryProblems(next);
    if (problems.length) throw new StartupCostError(problems[0], { code: 'invalid-argument' });

    const beforeCols = entryColumns(parentId, before, FieldValue, userId);
    const nextCols   = entryColumns(parentId, next, FieldValue, userId);
    const changed    = Object.keys(nextCols).filter((c) => !Object.is(nextCols[c], beforeCols[c]));
    if (!changed.length) {
      return { id: eid, parentId, changed: [], actualAmount: round2(parent.actual_amount), status: parent.status };
    }

    if (next.unit && !unitIsListed(next.unit, parent.units || [])) {
      throw new StartupCostError(
        `«${next.unit}» ليس من سكنات هذا البند. أضِفه إلى قائمة السكنات أولاً من تعديل البند.`,
        { code: 'invalid-argument' },
      );
    }

    // ── ما يصل الدفاتر برقم لا يتغيّر بعد الترحيل ──
    const blocked = changed.filter((c) => LEDGER_BOUND_COLUMNS.includes(c));
    if (lock && blocked.length) {
      throw new StartupCostError(
        `هذا المصروف مُرحّل بالقيد رقم ${lock.entryNumber ?? '—'} — المبلغ والتاريخ وبيانات `
        + 'الضريبة لا تتغيّر بعده. اعكس القيد أولاً؛ العكس هو ما يحرّر السجل. '
        + 'أما الاسم والملاحظات والتقسيم فتُعدَّل الآن.',
      );
    }

    // ── نصّ القيد يُقرأ الآن ليُكتب بعد قليل ──
    const renarrations = [];
    if (lock && changed.includes('description')) {
      const journalIds = [lock.entryId, lock.settlementEntryId].filter(Boolean);
      for (const jid of journalIds) {
        const jRef  = db.collection(COL.JOURNAL).doc(jid);
        const jSnap = await tx.get(jRef);
        if (!jSnap.exists) continue;
        const j = jSnap.data();
        const pSnap = await tx.get(db.collection(COL.PERIODS).doc(String(j.periodKey || '')));
        if (pSnap.exists && pSnap.data().status === 'closed') {
          throw new StartupCostError(
            `قيد هذا المصروف في فترة ${j.periodKey} وهي مقفلة — لا يتغيّر نصّه. `
            + 'افتح الفترة أو صحّح بقيد تسوية.',
          );
        }
        renarrations.push([jRef, {
          description: renarrate(j.description, before.description, next.description),
          lines: (j.lines || []).map((l) => ({
            ...l,
            description: renarrate(l.description, before.description, next.description),
          })),
        }]);
      }
    }

    if (onBeforeCommit) await onBeforeCommit();

    // ── ثم الكتابات ──
    tx.update(entryRef, {
      ...nextCols,
      updated_at: FieldValue.serverTimestamp(),
      updated_by: userId,
    });
    for (const [ref, payload] of renarrations) tx.update(ref, payload);

    // The roll-up is re-derived only when the money moved; an unposted amount
    // edit is the one case, and it must land in the same snapshot.
    const rollup = changed.includes('amount')
      ? applyRollup(
        tx, parentRef, parent,
        entries.map((e) => (e.id === eid ? round2(next.amount) : e.amount)),
        FieldValue, userId,
      )
      : { actualAmount: round2(parent.actual_amount), status: parent.status };

    tx.set(db.collection(COL.AUDIT).doc(), auditRecord({
      action: 'startup-entry-update', documentId: eid, userId,
      before: { description: before.description, amount: round2(before.amount), unit: before.unit || null },
      after: {
        description: next.description, amount: round2(next.amount), unit: next.unit || null,
        changed, renarrated: renarrations.length,
      },
      note: `تعديل مصروف تأسيس على البند ${parentId}`
        + (renarrations.length ? ` — وتحديث نصّ ${renarrations.length} قيد` : ''),
    }, FieldValue));

    return { id: eid, parentId, changed, renarrated: renarrations.length, ...rollup };
  });
}

// ─── إسناد المصاريف إلى السكنات ──────────────────────────────────────────
/**
 * يُسند سكناً لكل مصروف من قائمة، دفعةً واحدة.
 *
 * ── لماذا دفعة ──
 * The job this exists for is distributing twenty-seven already-recorded
 * expenses across the housing units they belong to. Twenty-seven separate
 * calls would leave the item half-assigned if the tenth failed, and would
 * write twenty-seven audit records for what the owner did as one act.
 *
 * ── ولماذا لا تجميعة هنا ──
 * Assigning a unit moves no money. The parent's `actual_amount` is
 * SUM(children) and the children are the same children — so `applyRollup` is
 * deliberately NOT called, and a test reads the total before and after and
 * demands it identical. Journal entries and locks are likewise untouched: the
 * parent's name is not in a journal entry, and a unit is a detail inside the
 * parent, further still.
 *
 * `unit: null` is a legitimate assignment — it puts a row back under «غير
 * محدد» rather than forcing every expense to belong to a place.
 */
export async function assignStartupUnits(db, FieldValue, { parentId, assignments = [] }, {
  userId = null, role = 'operator', onBeforeCommit = null,
} = {}) {
  requireRole(role, WRITE_ROLES, 'إسناد مصاريف إلى السكنات');
  const id = String(parentId ?? '').trim();
  if (!id) throw new StartupCostError('معرّف البند مطلوب.', { code: 'invalid-argument' });
  if (!Array.isArray(assignments) || assignments.length === 0) {
    throw new StartupCostError('لا توجد إسنادات لتنفيذها.', { code: 'invalid-argument' });
  }
  if (assignments.length > 500) {
    throw new StartupCostError('عدد الإسنادات أكبر مما تحتمله عملية واحدة.', { code: 'invalid-argument' });
  }

  return db.runTransaction(async (tx) => {
    const { parent, entries } = await readParentAndEntries(db, tx, id);
    const units = parent.units || [];
    const byId = new Map(entries.map((e) => [e.id, e]));

    // Everything is validated BEFORE anything is written: a half-applied
    // batch is worse than a refused one, because the owner cannot tell which
    // half took.
    const planned = [];
    for (const a of assignments) {
      const eid = String(a?.entryId ?? '').trim();
      const entry = byId.get(eid);
      if (!entry) {
        throw new StartupCostError(
          `المصروف ${eid || '(بلا معرّف)'} ليس ضمن مصاريف هذا البند.`,
          { code: 'not-found' },
        );
      }
      const unit = a?.unit ? String(a.unit).trim() : null;
      if (unit && !unitIsListed(unit, units)) {
        throw new StartupCostError(
          `«${unit}» ليس من سكنات هذا البند. أضِفه إلى قائمة السكنات أولاً.`,
          { code: 'invalid-argument' },
        );
      }
      planned.push({ eid, unit, before: entry.unit ?? null });
    }

    if (onBeforeCommit) await onBeforeCommit();

    for (const { eid, unit } of planned) {
      tx.update(db.collection(COL.ENTRIES).doc(eid), {
        unit,
        updated_at: FieldValue.serverTimestamp(),
        updated_by: userId,
      });
    }

    tx.set(db.collection(COL.AUDIT).doc(), auditRecord({
      action: 'startup-units-assign', documentId: id, userId,
      before: { assigned: planned.filter((x) => x.before).length, total: entries.length },
      after: {
        count: planned.length,
        // The distribution as applied, so the audit says WHAT was filed where
        // and not merely that something was.
        byUnit: planned.reduce((acc, x) => {
          const key = x.unit || 'غير محدد';
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {}),
      },
      note: `إسناد ${planned.length} مصروفاً إلى سكنات البند ${id} — المجموع والقيود لم تتغيّر`,
    }, FieldValue));

    return { parentId: id, count: planned.length };
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
    // Trimmed only. Blanks and near-duplicates («النزهة» vs «النزهه») were
    // already REFUSED by `unitListProblems` — loudly, because a list quietly
    // shortened on save is a list the user believes they saved. De-duplicating
    // here as well would be a second, contradictory answer to the same
    // question: tolerate, or refuse? The codebase refuses.
    if ('units' in patch) {
      next.units = (patch.units || []).map((u) => String(u ?? '').trim());
    }

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
