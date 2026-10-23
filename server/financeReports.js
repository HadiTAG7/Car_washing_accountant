import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AuthError, callerRole } from '../functions/src/handlers.js';
import { parseFinanceReport } from '../src/lib/financeReportContract.js';
import { financeDay } from '../src/lib/financeReportContract.js';
import { financeArchiveSearch, financeOwnerView } from '../src/lib/financeReportPresentation.js';

export const FINANCE_REPORTS = 'finance_reports';
const id = z.string().regex(/^finance-\d{4}-\d{2}-\d{2}-[123]-(daily|weekly|monthly|ad-hoc)-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}$/);
const bad = (message, code = 'invalid-argument') => { throw new AuthError(message, { code }); };
async function adminOnly(db, auth) {
  if (await callerRole(db, auth) !== 'admin') bad('تقارير المالية التفصيلية للإدارة فقط.', 'permission-denied');
}
const revisionId = revision => String(revision).padStart(6, '0');
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const reportHead = r => ({ reportId: r.reportId, dateRiyadh: r.dateRiyadh, sourceRole: r.sourceRole,
  period: r.period, title: r.title, revision: r.revision, cutAtRiyadh: r.cutAtRiyadh });
const newestFirst = (a, b) => b.cutAtRiyadh.localeCompare(a.cutAtRiyadh) || b.reportId.localeCompare(a.reportId);
async function savedVersion(db, head, revision = head.revision) {
  const snap = await db.collection(FINANCE_REPORTS).doc(head.reportId).collection('revisions').doc(revisionId(revision)).get();
  if (!snap.exists) bad('نسخة تقرير المالية غير متاحة.', 'failed-precondition');
  return parseFinanceReport(JSON.parse(snap.data().reportJson));
}
async function previousFinanceReport(db, heads, report) {
  const previous = heads.filter(item => item.reportId !== report.reportId && item.sourceRole === report.sourceRole
    && item.period.kind === report.period.kind && Date.parse(item.cutAtRiyadh) < Date.parse(report.cutAtRiyadh)).sort(newestFirst)[0];
  return previous ? savedVersion(db, previous) : null;
}
// Bounded parallel reads, never a write or backfill. A search must inspect the
// entire matching archive before applying numbered pagination.
async function searchArchive(db, heads, query) {
  const matches = [];
  for (let index = 0; index < heads.length; index += 6) {
    const reports = await Promise.all(heads.slice(index, index + 6).map(head => savedVersion(db, head)));
    reports.forEach((report, offset) => { if (financeArchiveSearch(report, query)) matches.push(heads[index + offset]); });
  }
  return matches;
}

/** Administrative snapshots, not financial transactions. Source-role labels
 * are attribution only: authorization is the actual caller's current membership. */
export async function financeReports(db, auth, input, now = new Date()) {
  await adminOnly(db, auth);
  if (input?.action === 'archive') {
    const p = z.object({ action: z.literal('archive'), page: z.number().int().min(1).max(100000).default(1),
      pageSize: z.number().int().min(1).max(30).default(10), from: financeDay.optional(), to: financeDay.optional(),
      sourceRole: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(), search: z.string().trim().max(300).default('') }).strict().safeParse(input);
    if (!p.success || (p.data.from && p.data.to && p.data.from > p.data.to)) bad('تصفية أرشيف المالية غير صالحة.');
    const r = p.data, snap = await db.collection(FINANCE_REPORTS).get();
    let heads = snap.docs.map(doc => doc.data()).filter(head => (!r.from || head.dateRiyadh >= r.from)
      && (!r.to || head.dateRiyadh <= r.to) && (!r.sourceRole || head.sourceRole === r.sourceRole)).sort(newestFirst);
    if (r.search) heads = await searchArchive(db, heads, r.search);
    const pages = Math.max(1, Math.ceil(heads.length / r.pageSize)), page = Math.min(r.page, pages);
    const selectedHeads = heads.slice((page - 1) * r.pageSize, page * r.pageSize);
    const pageReports = await Promise.all(selectedHeads.map(head => savedVersion(db, head)));
    await adminOnly(db, auth);
    return { items: selectedHeads.map((head, index) => ({ ...reportHead(head), headline: financeOwnerView(pageReports[index]).headline })), total: heads.length, page, pages, pageSize: r.pageSize };
  }
  if (input?.action === 'forExecutive') {
    const p = z.object({ action: z.literal('forExecutive'), at: z.string().datetime({ offset: true }).optional() }).strict().safeParse(input);
    if (!p.success) bad('طلب ملخص المالية غير صالح.');
    const cut = p.data.at ? Date.parse(p.data.at) : now.getTime();
    const snap = await db.collection(FINANCE_REPORTS).where('sourceRole', '==', 1).get();
    const heads = snap.docs.map(doc => doc.data()).filter(head => Date.parse(head.cutAtRiyadh) <= cut).sort(newestFirst);
    const head = heads[0], report = head ? await savedVersion(db, head) : null;
    const previousReport = report ? await previousFinanceReport(db, heads, report) : null;
    await adminOnly(db, auth);
    return { report, previousReport };
  }
  if (input?.action === 'list') {
    const p = z.object({ action: z.literal('list'), before: id.optional() }).strict().safeParse(input);
    if (!p.success) bad('طلب أرشيف المالية غير صالح.');
    let query = db.collection(FINANCE_REPORTS).orderBy('reportId', 'desc');
    if (p.data.before) query = query.where('reportId', '<', p.data.before);
    const snap = await query.limit(31).get();
    const all = snap.docs.map(doc => doc.data());
    return { items: all.slice(0, 30).map(r => ({ reportId: r.reportId, dateRiyadh: r.dateRiyadh,
      sourceRole: r.sourceRole, period: r.period, title: r.title, revision: r.revision, cutAtRiyadh: r.cutAtRiyadh })),
    nextBefore: all.length > 30 ? all[29].reportId : null };
  }
  if (input?.action === 'read') {
    const p = z.object({ action: z.literal('read'), reportId: id, revision: z.number().int().min(1).max(999999).optional() }).strict().safeParse(input);
    if (!p.success) bad('طلب قراءة تقرير المالية غير صالح.');
    const ref = db.collection(FINANCE_REPORTS).doc(p.data.reportId), head = await ref.get();
    if (!head.exists) return { report: null, history: [] };
    const current = head.data().revision;
    if (p.data.revision && p.data.revision > current) bad('النسخة غير موجودة.', 'not-found');
    const version = await ref.collection('revisions').doc(revisionId(p.data.revision || current)).get();
    if (!version.exists) bad('نسخة تقرير المالية غير متاحة.', 'failed-precondition');
    const history = await ref.collection('revisions').orderBy('revision', 'desc').limit(30).get();
    const report = parseFinanceReport(JSON.parse(version.data().reportJson));
    const heads = await db.collection(FINANCE_REPORTS).where('sourceRole', '==', report.sourceRole).get();
    const previousReport = await previousFinanceReport(db, heads.docs.map(doc => doc.data()), report);
    return { report, previousReport, currentRevision: current,
      history: history.docs.map(doc => ({ revision: doc.data().revision, savedAt: doc.data().savedAt,
        reason: doc.data().correctionReason || 'الإصدار الأول' })), historyLimited: history.size === 30 };
  }
  const p = z.object({ action: z.literal('save'), report: z.unknown(), expectedRevision: z.number().int().min(0).max(999998) }).strict().safeParse(input);
  if (!p.success) bad('طلب حفظ تقرير المالية غير صالح.');
  let report;
  try { report = parseFinanceReport(p.data.report); } catch (error) { bad(error.message); }
  if (Date.parse(report.cutAtRiyadh) > now.getTime()) bad('لا يحفظ تقرير بوقت قطع مستقبلي.');
  if (p.data.expectedRevision !== report.revision - 1) bad('النسخة المتوقعة غير صحيحة.');
  const contentHash = hash(report), ref = db.collection(FINANCE_REPORTS).doc(report.reportId);
  return db.runTransaction(async tx => {
    const authDb = { collection: name => ({ doc: key => ({ get: () => tx.get(db.collection(name).doc(key)) }) }) };
    await adminOnly(authDb, auth);
    const head = await tx.get(ref), versionRef = ref.collection('revisions').doc(revisionId(report.revision));
    const version = await tx.get(versionRef);
    if (version.exists) {
      if (version.data().contentHash === contentHash) return { reportId: report.reportId, revision: report.revision, duplicate: true };
      bad('هذه النسخة موجودة بمحتوى مختلف؛ لا يستبدل التاريخ.', 'already-exists');
    }
    if ((head.exists ? head.data().revision : 0) !== p.data.expectedRevision) bad('وصلت نسخة أخرى؛ أعد القراءة قبل الحفظ.', 'failed-precondition');
    const savedAt = now.toISOString();
    // JSON preserves table rows (arrays of arrays), which Firestore cannot
    // represent directly. The parsed, bounded contract is validated on read.
    tx.create(versionRef, { revision: report.revision, reportJson: JSON.stringify(report),
      correctionReason: report.correctionReason || null, contentHash, savedAt, publishedByUid: auth.uid });
    tx.set(ref, { reportId: report.reportId, dateRiyadh: report.dateRiyadh, sourceRole: report.sourceRole, period: report.period,
      title: report.title, cutAtRiyadh: report.cutAtRiyadh, revision: report.revision, savedAt, contentHash });
    return { reportId: report.reportId, revision: report.revision, duplicate: false };
  });
}
