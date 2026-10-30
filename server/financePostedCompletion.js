import { z } from 'zod';
import { FINANCE_KINDS, financeHash, financeSourceHash, FinanceReviewError } from '../functions/src/financeReview.js';
import { invoiceLinesShapeIssues, invoiceLinesTotal } from '../functions/src/financeInvoiceLines.js';

/**
 * «استكمال مستند مرحّل»: on a posted record the admin fills only what carries no money — the purpose,
 * the quantity and how it is represented, the tax review reference. The amount, the accounts and the
 * entries never change here; the caller rebuilds the record's posting before and after and refuses
 * any difference. Every completion is kept on the record: who, when, why, and each field before/after.
 */
const fail = (message, code = 'failed-precondition') => { throw new FinanceReviewError(message, code); };
export const completionSchema = z.object({
  purpose: z.string().trim().min(2).max(500).optional(),
  quantityMode: z.enum(['single', 'lines']).optional(),
  quantity: z.number().finite().positive().max(1e6).optional(),
  invoiceLines: z.unknown().refine(value => invoiceLinesShapeIssues(value).length === 0, 'بنود الفاتورة غير صالحة.').optional(),
  taxReviewRef: z.string().trim().min(2).max(500).optional(),
}).strict().refine(c => c.purpose !== undefined || c.quantityMode !== undefined || c.taxReviewRef !== undefined, 'اختر حقلًا واحدًا على الأقل لاستكماله.');

// Everything else on the record — amount, dates, supplier, tax, payment, funding — must stay byte for byte.
const ROW_FIELDS = new Set(['quantity', 'unit_cost', 'finance_metadata', 'finance_revision']);
const META_FIELDS = new Set(['purpose', 'taxReviewRef', 'invoiceLines', 'postedCompletion']);
const same = (a, b) => financeHash(a ?? null) === financeHash(b ?? null);

function quantityOf(row) {
  const lines = row.finance_metadata?.invoiceLines;
  if (lines) return { mode: 'lines', items: Array.isArray(lines.items) ? lines.items.length : 0, total: invoiceLinesTotal(lines) };
  return { mode: 'single', quantity: row.quantity ?? null, unitCost: row.unit_cost ?? null };
}

/** The record after the completion (its history not yet added), and the fields that changed. */
export function applyCompletion(kind, before, c) {
  const spec = FINANCE_KINDS[kind], after = { ...before }, meta = { ...(before.finance_metadata || {}) };
  if (c.purpose !== undefined) meta.purpose = c.purpose;
  if (c.taxReviewRef !== undefined) meta.taxReviewRef = c.taxReviewRef;
  if (c.quantityMode === undefined && (c.quantity !== undefined || c.invoiceLines !== undefined)) fail('حدد طريقة تمثيل الكمية مع الكمية أو البنود.', 'invalid-argument');
  if (c.quantityMode !== undefined) {
    if (Object.hasOwn(meta, 'quantityException')) fail('كمية هذا المستند مثبتة باستثناء بقرار هادي؛ لا تُستكمل من هنا.');
    if (c.quantityMode === 'single') {
      if (c.quantity === undefined || c.invoiceLines !== undefined) fail('الكمية المتجانسة تحتاج عددًا واحدًا دون بنود.', 'invalid-argument');
      delete meta.invoiceLines;
      after.quantity = c.quantity; after.unit_cost = Number((before[spec.amount] / c.quantity).toFixed(8));
    } else {
      if (c.invoiceLines === undefined || c.quantity !== undefined) fail('البنود المختلفة تحتاج بنود الفاتورة دون كمية واحدة.', 'invalid-argument');
      meta.invoiceLines = c.invoiceLines; after.quantity = null; after.unit_cost = null;
    }
  }
  after.finance_metadata = meta;
  const fields = {};
  for (const [key, from, to] of [['purpose', before.finance_metadata?.purpose, meta.purpose], ['taxReviewRef', before.finance_metadata?.taxReviewRef, meta.taxReviewRef],
    ['quantity', quantityOf(before), quantityOf(after)]]) if (!same(from, to)) fields[key] = { before: from ?? null, after: to ?? null };
  if (!Object.keys(fields).length) fail('لا تغيير لاستكماله؛ القيم هي نفسها المحفوظة.', 'invalid-argument');
  const revision = before.finance_revision ?? 0;
  if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) fail('نسخة المصدر التقنية غير صالحة؛ لا تحفظ فوقها.');
  after.finance_revision = revision + 1;
  return { after, fields };
}

/** Only the completion fields differ between the two versions of the record. */
export function onlyCompletionFieldsChanged(before, after) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  if ([...keys].some(key => !ROW_FIELDS.has(key) && !same(before[key], after[key]))) return false;
  const a = before.finance_metadata || {}, b = after.finance_metadata || {};
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].every(key => META_FIELDS.has(key) || same(a[key], b[key]));
}

/** The record's hash without its completion history: what an approval, or a completion, was given on. */
export function completionBaseHash(row) {
  const meta = row?.finance_metadata;
  if (!meta || !Object.hasOwn(meta, 'postedCompletion')) return financeSourceHash(row);
  const { postedCompletion: _history, ...rest } = meta;
  return financeSourceHash({ ...row, finance_metadata: rest });
}

/** The approval was given to the version before the completions, and nothing but completions followed it. */
export function approvedBeforeCompletion(row, review) {
  const history = row?.finance_metadata?.postedCompletion;
  if (!Array.isArray(history) || !history.length || review?.status !== 'approved' || history[0]?.beforeHash !== review.sourceHash) return false;
  return history.every((item, index) => index === 0 || item?.beforeHash === history[index - 1]?.afterHash)
    && history.at(-1)?.afterHash === completionBaseHash(row);
}

/** What the workbench shows of the history: who completed which fields, and when. */
export function completionHistoryOf(row) {
  const history = row?.finance_metadata?.postedCompletion;
  return Array.isArray(history) ? history.map(item => ({ byName: item?.byName || null, atIso: item?.atIso || null, reason: item?.reason || null,
    fields: Object.keys(item?.fields || {}) })) : [];
}
