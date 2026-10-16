import { createHash } from 'node:crypto';
import { isRealDate, isValidPeriodKey, postingLockId, round2 } from './invariants.js';
import { legacyLockIdFor } from './posting.js';
import { startupRollup, startupParentHasLegacySpend, unitIsListed } from './startupMigration.js';

export class ExpenseCorrectionError extends Error {
  constructor(message, code = 'failed-precondition') { super(message); this.code = code; }
}
const fail = (message, code) => { throw new ExpenseCorrectionError(message, code); };
const kinds = {
  variable: { collection: 'variable_expenses', amount: 'total_variable_cost', date: 'logged_date', title: 'expense_name' },
  monthly: { collection: 'monthly_expenses', amount: 'total_monthly_cost', date: 'logged_date', title: 'expense_name' },
  annual: { collection: 'annual_expense_entries', amount: 'amount', date: 'spent_date', title: 'description', parent: 'annual_expenses', fk: 'annual_expense_id' },
  startup: { collection: 'startup_cost_entries', amount: 'amount', date: 'spent_date', title: 'description', parent: 'startup_costs', fk: 'startup_cost_id' },
};
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    if (typeof value.toDate === 'function') return value.toDate().toISOString();
    return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  }
  return value;
}
const hash = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
function id(value, name) {
  if (typeof value !== 'string' || !/^[\p{L}\p{N}_.:-]{1,160}$/u.test(value)) fail(`${name} غير صالح.`, 'invalid-argument');
  return value;
}
function onlyKeys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k))) fail('حقول غير مسموحة.', 'invalid-argument');
}
function requiredText(value, name) {
  if (typeof value !== 'string' || value.trim().length < 2 || value.length > 1000) fail(`${name} مطلوب.`, 'invalid-argument');
  return value.trim();
}
function money(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1e9 || Math.abs(round2(value) - value) > 1e-7) fail('المبلغ يجب أن يكون موجباً وبدقة هللتين.', 'invalid-argument');
  return value;
}
async function openPeriods(db, tx, dates) {
  for (const date of [...new Set(dates.filter(Boolean))]) {
    if (!isRealDate(date)) fail('تاريخ المصروف غير صالح؛ صحح التاريخ صراحةً.', 'invalid-argument');
    const snap = await tx.get(db.collection('accounting_periods').doc(date.slice(0, 7)));
    if (snap.exists && snap.data().status === 'closed') fail(`الفترة ${date.slice(0, 7)} مقفلة.`);
  }
}
async function unposted(db, tx, kind, recordId, row) {
  const lockIds = new Set([postingLockId(kind, recordId), legacyLockIdFor(kind, recordId)].filter(Boolean));
  for (const lock of lockIds) if ((await tx.get(db.collection('posting_locks').doc(lock))).exists) fail('المصروف مرحّل؛ استخدم مسار التصحيح المحاسبي، لا تعدّل المصدر.');
  const journals = await tx.get(db.collection('journal_entries').where('sourceId', '==', recordId));
  if (journals.docs.some(d => d.data().status === 'posted') || row.journal_entry_id || row.posted_entry_id || row.posting_status === 'posted') fail('يوجد أثر دفتري للمصروف؛ التعديل مرفوض.');
}
async function parentState(db, tx, kind, parentId) {
  const spec = kinds[kind];
  if (!spec.parent) return null;
  id(parentId, 'البند الأب');
  const ref = db.collection(spec.parent).doc(parentId);
  const parent = await tx.get(ref);
  if (!parent.exists) fail('بند التصنيف غير موجود.', 'not-found');
  const siblings = await tx.get(db.collection(spec.collection).where(spec.fk, '==', parentId));
  const rows = siblings.docs.map(d => ({ id: d.id, ...d.data() }));
  const raw = parent.data();
  if (!rows.length && (kind === 'startup' ? startupParentHasLegacySpend({ actualAmount: raw.actual_amount, isTaxInvoice: raw.is_tax_invoice, invoiceNumber: raw.invoice_number, invoiceDate: raw.invoice_date, supplier: raw.supplier, vatAmount: raw.vat_amount, vatRate: raw.vat_rate }) : Number(raw.actual_amount) > 0)) fail('البند يحمل مبلغاً قديماً غير مفصل؛ يلزم تحويله قبل إضافة قيود جديدة.');
  return { ref, value: parent.data(), rows, kind };
}

async function correctionPlan(db, tx, request) {
  const { kind, sourceId, patch = {}, targetKind = kind } = request;
  if (!Object.hasOwn(kinds, kind) || !Object.hasOwn(kinds, targetKind)) fail('نوع المصروف غير مدعوم.', 'invalid-argument');
  id(sourceId, 'معرّف المصروف');
  onlyKeys(patch, ['description', 'date', 'quantity', 'amount', 'categoryId', 'unit']);
  const spec = kinds[kind], target = kinds[targetKind];
  const sourceRef = db.collection(spec.collection).doc(sourceId);
  const sourceSnap = await tx.get(sourceRef);
  if (!sourceSnap.exists) fail('المصروف غير موجود.', 'not-found');
  const before = sourceSnap.data();
  if (kind === 'monthly' && (!before.logged_date || before.recurrence === 'monthly' || before.biker_id || before.payrollSnapshot)) fail('قالب المصروف المتكرر أو الراتب ليس فاتورة قابلة للنقل بهذه الأداة.');
  await unposted(db, tx, kind, sourceId, before);
  const moving = targetKind !== kind;
  const amount = money(patch.amount ?? Number(before[spec.amount]));
  if ((moving || before.is_tax_invoice) && amount !== Number(before[spec.amount])) fail('النقل يحافظ على إجمالي الفاتورة والضريبة؛ لا تغيّر المبلغ معه.');
  const description = requiredText(patch.description ?? before[spec.title] ?? before.description, 'الوصف');
  const date = patch.date ?? before[spec.date] ?? before.paid_date;
  const quantity = patch.quantity ?? Number(before.quantity || 1);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1e6) fail('عدد الوحدات غير صالح.', 'invalid-argument');
  await openPeriods(db, tx, [before[spec.date], before.paid_date, before.invoice_date, date]);
  const oldParent = spec.parent ? await parentState(db, tx, kind, before[spec.fk]) : null;
  const parentId = target.parent ? request.targetParentId ?? (targetKind === kind ? before[spec.fk] : null) : null;
  if (!target.parent && request.targetParentId) fail('هذا التصنيف لا يقبل بنداً أباً.', 'invalid-argument');
  const newParent = target.parent ? (oldParent && targetKind === kind && parentId === before[spec.fk] ? oldParent : await parentState(db, tx, targetKind, parentId)) : null;
  const relocating = moving || (newParent && oldParent && newParent.ref.path !== oldParent.ref.path);
  const unit = patch.unit ?? before.unit ?? '';
  if (typeof unit !== 'string' || unit.length > 150) fail('الوحدة غير صالحة.', 'invalid-argument');
  if (unit && newParent && Array.isArray(newParent.value.units) && !unitIsListed(unit, newParent.value.units)) fail('الوحدة غير مدرجة في بند التصنيف.');
  if (!target.parent && unit) fail('الوحدة/السكن يحتاج بند تأسيس أو بند سنوي.', 'invalid-argument');
  const categoryId = patch.categoryId ?? (!moving ? before.category_id : null) ?? null;
  if (categoryId) {
    if (target.parent) fail('اختر البند الأب بدلاً من تصنيف مصروف متغير.', 'invalid-argument');
    id(categoryId, 'التصنيف');
    if (!(await tx.get(db.collection(`${targetKind}_expense_categories`).doc(categoryId))).exists) fail('التصنيف غير موجود.', 'not-found');
  }
  // Preserve attachments and invoice metadata, including legacy fields; only
  // remove the old collection's structural columns, never silently lose evidence.
  let after = { ...before };
  if (moving) for (const key of ['expense_name', 'description', 'total_variable_cost', 'total_monthly_cost', 'amount', 'logged_date', 'spent_date', 'category_id', 'startup_cost_id', 'annual_expense_id', 'recurrence', 'payment_day', 'unit']) delete after[key];
  after = { ...after, [target.title]: description, [target.amount]: amount, [target.date]: date, quantity, unit_cost: Number((amount / quantity).toFixed(8)) };
  // Normalize all legacy aliases so a corrected date cannot be shadowed by an old paid_date.
  if (after.paid_date !== undefined) after.paid_date = date;
  if (target.parent) { after[target.fk] = parentId; after.unit = unit; }
  else after.category_id = categoryId;
  if (targetKind === 'monthly') { after.recurrence = 'one_time'; after.payment_day = null; }
  if (after.approval_status !== undefined) after.approval_status = 'pending';
  const targetId = moving ? `mcp_move_${hash({ kind, sourceId }).slice(0, 40)}` : sourceId;
  const targetRef = db.collection(target.collection).doc(targetId);
  if (moving) {
    if ((await tx.get(targetRef)).exists) fail('يوجد قيد مستهدف؛ راجع النقل السابق ولا تكرره.', 'already-exists');
    await unposted(db, tx, targetKind, targetId, {});
    const candidates = await tx.get(db.collection(target.collection).where(before.invoice_number ? 'invoice_number' : target.title, '==', before.invoice_number || description));
    if (candidates.docs.some(d => { const r = d.data(); return Number(r[target.amount]) === amount && (before.invoice_number ? r.supplier === before.supplier : r[target.date] === date); })) fail('يوجد مصروف مطابق في التصنيف المستهدف؛ راجع النسخة الموجودة قبل النقل.', 'already-exists');
  }
  const parents = [...new Set([oldParent, newParent].filter(Boolean))];
  const previewHash = hash({ kind, sourceId, before, targetKind, targetId, after, parents: parents.map(p => ({ path: p.ref.path, value: p.value, rows: p.rows.sort((a,b) => a.id.localeCompare(b.id)) })) });
  return { preview: true, previewHash, kind, sourceId, targetKind, targetId, before, after, sourceRef, targetRef, parents, oldParent, newParent, relocating, moving };
}
function publicPlan(plan) {
  const { preview, previewHash, kind, sourceId, targetKind, targetId, before, after } = plan;
  return { preview, previewHash, kind, sourceId, targetKind, targetId, before, after, financialPosting: false };
}
export const previewExpenseCorrection = (db, request) => db.runTransaction(async tx => publicPlan(await correctionPlan(db, tx, request)));
export async function saveExpenseCorrection(db, FieldValue, request, { userId }) {
  if (request.confirm !== true || !/^[a-f0-9]{64}$/.test(request.previewHash || '')) fail('يلزم طلب صريح ومعاينة حديثة قبل الحفظ.', 'invalid-argument');
  const reason = requiredText(request.reason, 'سبب التصحيح');
  return db.runTransaction(async tx => {
    const receiptRef = db.collection('mcp_mutation_receipts').doc(hash({ userId, previewHash: request.previewHash, action: 'expense-correction' }));
    const receipt = await tx.get(receiptRef);
    const requestHash = hash({ kind: request.kind, sourceId: request.sourceId, targetKind: request.targetKind ?? request.kind, targetParentId: request.targetParentId ?? null, patch: request.patch ?? {}, reason });
    if (receipt.exists) {
      if (receipt.data().requestHash !== requestHash) fail('تغير الطلب بعد الحفظ؛ اطلب معاينة جديدة.');
      return { ...receipt.data().result, replay: true };
    }
    const plan = await correctionPlan(db, tx, request);
    if (plan.previewHash !== request.previewHash) fail('تغيّر المصروف أو البند بعد المعاينة؛ أعد المعاينة.');
    const updates = plan.parents.map(p => {
      let rows = p.rows.filter(r => !(p === plan.oldParent && r.id === request.sourceId));
      if (p === plan.newParent) rows = [...rows, { ...plan.after, id: plan.targetId }];
      const total = round2(rows.reduce((sum, r) => sum + Number(r.amount || 0), 0));
      return [p.ref, p.kind === 'startup' ? { actual_amount: total, status: startupRollup([total], p.value.budgeted_amount).status } : { actual_amount: total, payment_status: Number(p.value.annual_cost) > 0 && total >= Number(p.value.annual_cost) ? 'paid' : 'pending' }];
    });
    tx.set(plan.targetRef, { ...plan.after, updated_at: FieldValue.serverTimestamp(), updated_by: userId });
    if (plan.moving) tx.delete(plan.sourceRef);
    for (const [ref, value] of updates) tx.update(ref, value);
    const auditRef = db.collection('audit_logs').doc();
    tx.set(auditRef, { action: 'expense-correction', userId, before: plan.before, after: plan.after, source: plan.sourceRef.path, target: plan.targetRef.path, reason, previewHash: plan.previewHash, at: FieldValue.serverTimestamp() });
    const result = { saved: true, collection: kinds[plan.targetKind].collection, id: plan.targetId, auditId: auditRef.id, before: plan.before, after: plan.after, financialPosting: false };
    tx.set(receiptRef, { requestHash, result, userId, at: FieldValue.serverTimestamp() });
    return result;
  });
}

export async function recordWorkerAdvance(db, FieldValue, request, { userId }) {
  onlyKeys(request, ['bikerId', 'amount', 'spentDate', 'assignmentMonth', 'paymentMethod', 'description', 'requestId', 'confirm']);
  const bikerId = id(request.bikerId, 'العامل'), requestId = id(request.requestId, 'مفتاح منع التكرار');
  const amount = money(request.amount), description = requiredText(request.description, 'الوصف');
  if (!isRealDate(request.spentDate) || !isValidPeriodKey(request.assignmentMonth) || !['cash', 'bank'].includes(request.paymentMethod)) fail('تاريخ الصرف وشهر الراتب وطريقة الدفع مطلوبة.', 'invalid-argument');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  if (request.spentDate > today) fail('لا يُسجّل دفع سلفة بتاريخ مستقبلي.', 'invalid-argument');
  const row = { biker_id: bikerId, title: description, amount, spent_date: request.spentDate, assignment_month: request.assignmentMonth, payment_method: request.paymentMethod, status: 'pending', recovered_date: null, recovered_amount: 0 };
  const docId = `mcp_advance_${hash({ userId, requestId }).slice(0, 40)}`, requestHash = hash(row);
  return db.runTransaction(async tx => {
    const ref = db.collection('temporary_expenses').doc(docId), prior = await tx.get(ref);
    if (prior.exists) {
      if (prior.data().mcp_request_hash !== requestHash) fail('مفتاح الطلب مستخدم لسلفة مختلفة.', 'already-exists');
      return { saved: true, replay: true, id: docId, financialPosting: false };
    }
    if (!(await tx.get(db.collection('bikers').doc(bikerId))).exists) fail('العامل غير موجود.', 'not-found');
    await openPeriods(db, tx, [request.spentDate, `${request.assignmentMonth}-01`]);
    const runs = await tx.get(db.collection('payroll_runs').where('periodKey', '==', request.assignmentMonth));
    for (const run of runs.docs) {
      if (!['approved', 'paid', 'partially_paid'].includes(run.data().status)) continue;
      if ((await tx.get(db.collection('payroll_runs').doc(run.id).collection('items').doc(bikerId))).exists) fail('شهر السلفة مرتبط بمسير معتمد أو مصروف للعامل؛ يلزم تسويته بمسار الرواتب، لا إضافة خصم خلفه.');
    }
    const existing = await tx.get(db.collection('temporary_expenses').where('biker_id', '==', bikerId));
    if (existing.docs.some(d => { const r = d.data(); return Number(r.amount) === amount && r.spent_date === row.spent_date; })) fail('توجد سلفة مطابقة للعامل والمبلغ والتاريخ؛ راجعها قبل التكرار.', 'already-exists');
    if (request.confirm !== true) return { preview: true, id: docId, row, financialPosting: false };
    tx.set(ref, { ...row, mcp_request_hash: requestHash, created_by: userId, created_at: FieldValue.serverTimestamp() });
    tx.set(db.collection('audit_logs').doc(), { action: 'worker-advance-recorded', userId, documentId: docId, after: row, at: FieldValue.serverTimestamp() });
    return { saved: true, id: docId, row, financialPosting: false };
  });
}

export async function expenseCorrectionOptions(db) {
  const result = {};
  for (const [kind, collection] of [['startup', 'startup_costs'], ['annual', 'annual_expenses'], ['variable', 'variable_expense_categories'], ['monthly', 'monthly_expense_categories']]) {
    const snap = await db.collection(collection).limit(201).get();
    result[kind] = { truncated: snap.docs.length > 200, records: snap.docs.slice(0, 200).map(d => {
      const r = d.data(); return { id: d.id, name: r.item_name || r.expense_name || r.label || '', units: r.units || [], planned: r.budgeted_amount ?? r.annual_cost ?? null, actual: r.actual_amount ?? null };
    }) };
  }
  return result;
}
export async function payrollReadStatus(db, { periodKey, runId } = {}) {
  if (!isValidPeriodKey(periodKey)) fail('شهر الرواتب غير صالح.', 'invalid-argument');
  const snapshots = runId ? [await db.collection('payroll_runs').doc(id(runId, 'المسير')).get()] : (await db.collection('payroll_runs').where('periodKey', '==', periodKey).limit(21).get()).docs;
  const runs = [];
  for (const doc of snapshots.slice(0, 20)) {
    if (!doc.exists) fail('المسير غير موجود.', 'not-found');
    const run = doc.data();
    if (run.periodKey !== periodKey) fail('المسير لا يخص الشهر المحدد.', 'invalid-argument');
    const items = await db.collection('payroll_runs').doc(doc.id).collection('items').limit(501).get();
    runs.push({ id: doc.id, periodKey, status: run.status, revision: run.revision, totals: run.totals || null, paymentSummary: run.paymentSummary || null, itemsTruncated: items.docs.length > 500,
      items: items.docs.slice(0, 500).map(item => { const r = item.data(); return { bikerId: r.bikerId, name: r.name || '', status: r.status, basicDue: r.basicDue, commission: r.commission, advanceDeduction: r.advanceDeduction, netDue: r.netDue }; }) });
  }
  return { periodKey, runsTruncated: snapshots.length > 20, runs };
}
