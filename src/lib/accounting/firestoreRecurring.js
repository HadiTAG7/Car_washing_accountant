// ═══════════════════════════════════════════════════════════════════════════
// توليد السندات الدورية — persisting one dated voucher per template per month
// ═══════════════════════════════════════════════════════════════════════════
// Collection: `expense_vouchers`, document id = `<templateId>__<periodKey>`.
//
// The deterministic id is the whole idempotency design. Generating the same
// month twice writes the same document, so there is no counter to race, no
// "already generated" flag that a failed write could leave wrong, and a
// half-finished sweep is resumed simply by running it again.
//
// A voucher already carried into the ledger is frozen — the entry references
// it, and rewriting the document under a posted entry would make the two
// disagree.
// ═══════════════════════════════════════════════════════════════════════════

import {
  doc, getDoc, writeBatch, serverTimestamp, updateDoc,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../firebaseClient';
import { fetchRows } from '../firestoreCrud';
import { mapMonthlyExpense } from '../mappers';
import { fetchEntries } from './firestoreLedger';
import {
  missingVouchers, ungeneratableTemplates, voucherId, summariseVouchers,
} from './recurring';

export const VOUCHERS_COL = 'expense_vouchers';

function requireDb() {
  if (!isFirebaseConfigured) throw new Error('Firebase غير مُهيّأ.');
}

export const fetchVouchers = () => fetchRows(VOUCHERS_COL);

export async function fetchVoucher(id) {
  const snap = await getDoc(doc(db, VOUCHERS_COL, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/** The recurring templates, already mapped to app shape. */
export async function fetchTemplates() {
  const rows = await fetchRows('monthly_expenses');
  return rows.map(mapMonthlyExpense).map((t, i) => ({
    ...t,
    startPeriod: rows[i].start_period || null,
    endPeriod: rows[i].end_period || null,
    active: rows[i].active !== false,
  }));
}

/**
 * Shows what a generation run WOULD create, without creating it. The page
 * previews this so nobody discovers 40 unexpected vouchers after the fact.
 */
export async function previewGeneration({ from, through }) {
  const [templates, vouchers] = await Promise.all([fetchTemplates(), fetchVouchers()]);
  const existing = new Set(vouchers.map((v) => v.id));
  return {
    toCreate: missingVouchers(templates, existing, { from, through }),
    skipped: ungeneratableTemplates(templates, { from, through }),
    templateCount: templates.length,
  };
}

/**
 * Creates every missing voucher in the range.
 *
 * Batched rather than transactional on purpose: there is no shared counter to
 * protect, each document is independent, and a batch handles a year of
 * templates in one round trip. Chunked at 400 to stay inside the 500-write
 * batch limit.
 */
export async function generateVouchers({ from, through, userId = null }) {
  requireDb();
  const { toCreate, skipped } = await previewGeneration({ from, through });
  if (toCreate.length === 0) return { created: 0, skipped, periods: [] };

  const CHUNK = 400;
  for (let i = 0; i < toCreate.length; i += CHUNK) {
    const batch = writeBatch(db);
    for (const v of toCreate.slice(i, i + CHUNK)) {
      const { id, ...body } = v;
      // set() not create(): re-running must overwrite the identical document
      // rather than fail, which is what makes a resumed sweep safe.
      batch.set(doc(db, VOUCHERS_COL, id), {
        ...body,
        generatedBy: userId,
        generatedAt: serverTimestamp(),
        generatedAtIso: new Date().toISOString(),
      });
    }
    await batch.commit();
  }
  return {
    created: toCreate.length,
    skipped,
    periods: [...new Set(toCreate.map((v) => v.periodKey))].sort(),
  };
}

/** True when this voucher has already been carried into the ledger. */
async function isPosted(id) {
  const entries = await fetchEntries();
  return entries.some((e) => e.sourceType === 'expense' && e.sourceId === id && e.status === 'posted');
}

/** Marks a voucher paid (or back to pending) — the ledger side is separate. */
export async function setVoucherPayment(id, { paymentStatus, paidDate = null, userId = null }) {
  requireDb();
  if (await isPosted(id)) {
    throw new Error('السند مُرحّل إلى الدفاتر — لا يُعدَّل. سجّل التصحيح بقيد.');
  }
  await updateDoc(doc(db, VOUCHERS_COL, id), {
    paymentStatus: paymentStatus === 'paid' ? 'paid' : 'pending',
    paidDate: paymentStatus === 'paid' ? (paidDate || new Date().toISOString().slice(0, 10)) : null,
    updatedBy: userId,
    updatedAt: serverTimestamp(),
  });
  return { id };
}

/**
 * Cancels a voucher — a month the business did not actually incur (the shop
 * was closed, the contract paused). Deliberately not a delete: the gap in a
 * monthly series is itself information, and a cancelled voucher says "we
 * looked at this month and decided nothing was due".
 */
export async function cancelVoucher(id, { reason, userId = null } = {}) {
  requireDb();
  if (!String(reason || '').trim()) throw new Error('سبب الإلغاء مطلوب.');
  if (await isPosted(id)) {
    throw new Error('السند مُرحّل إلى الدفاتر — الإلغاء يكون بعكس القيد.');
  }
  await updateDoc(doc(db, VOUCHERS_COL, id), {
    status: 'cancelled',
    cancelReason: String(reason).trim(),
    cancelledBy: userId,
    cancelledAt: serverTimestamp(),
  });
  return { id };
}

/** Restores a cancelled voucher. */
export async function restoreVoucher(id, { userId = null } = {}) {
  requireDb();
  await updateDoc(doc(db, VOUCHERS_COL, id), {
    status: 'active', cancelReason: null, updatedBy: userId, updatedAt: serverTimestamp(),
  });
  return { id };
}

/** Everything the vouchers panel needs, in one pass. */
export async function fetchVoucherBundle() {
  const [vouchers, templates, entries] = await Promise.all([
    fetchVouchers(), fetchTemplates(), fetchEntries(),
  ]);
  const postedIds = new Set(
    entries.filter((e) => e.sourceType === 'expense' && e.status === 'posted')
      .map((e) => String(e.sourceId)),
  );
  return {
    vouchers: vouchers.map((v) => ({ ...v, posted: postedIds.has(String(v.id)) })),
    templates,
    summary: summariseVouchers(vouchers),
  };
}

export { voucherId };
