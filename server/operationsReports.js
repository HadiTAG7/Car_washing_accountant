import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AuthError, callerRole } from '../functions/src/handlers.js';
import { parseOperationsReport } from '../src/lib/operationsReportContract.js';

export const OPERATIONS_REPORTS = 'operations_reports';
const id = z.string().regex(/^ops-\d{4}-\d{2}-\d{2}-\d{1,2}-(morning_review|sync|assets|weekly|targeted)-[A-Za-z0-9_-]{1,24}-(?:\d{4}-\d{2}-\d{2}|unknown)-(?:\d{4}-\d{2}-\d{2}|unknown)$/);
const bad = (message, code = 'invalid-argument') => { throw new AuthError(message, { code }); };
async function adminOnly(db, auth) {
  if (await callerRole(db, auth) !== 'admin') bad('تقارير العمليات التفصيلية للإدارة فقط.', 'permission-denied');
}
const revisionId = revision => String(revision).padStart(6, '0');
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');

/** Administrative snapshots, not financial transactions. Source-role labels
 * are attribution only: authorization is the actual caller's current membership. */
export async function operationsReports(db, auth, input, now = new Date()) {
  await adminOnly(db, auth);
  if (input?.action === 'list') {
    const p = z.object({ action: z.literal('list'), before: id.optional() }).strict().safeParse(input);
    if (!p.success) bad('طلب أرشيف العمليات غير صالح.');
    let query = db.collection(OPERATIONS_REPORTS).orderBy('reportId', 'desc');
    if (p.data.before) query = query.where('reportId', '<', p.data.before);
    const snap = await query.limit(31).get();
    const all = snap.docs.map(doc => doc.data());
    return { items: all.slice(0, 30).map(r => ({ reportId: r.reportId, dateRiyadh: r.dateRiyadh,
      sourceRole: r.sourceRole, sourceLabel: r.sourceLabel, period: r.period, kind: r.kind, round: r.round, status: r.status,
      archiveMode: r.archiveMode, title: r.title, revision: r.revision, cutAtRiyadh: r.cutAtRiyadh })),
    nextBefore: all.length > 30 ? all[29].reportId : null };
  }
  if (input?.action === 'read') {
    const p = z.object({ action: z.literal('read'), reportId: id, revision: z.number().int().min(1).max(999999).optional() }).strict().safeParse(input);
    if (!p.success) bad('طلب قراءة تقرير العمليات غير صالح.');
    const ref = db.collection(OPERATIONS_REPORTS).doc(p.data.reportId), head = await ref.get();
    if (!head.exists) return { report: null, history: [] };
    const current = head.data().revision;
    if (p.data.revision && p.data.revision > current) bad('النسخة غير موجودة.', 'not-found');
    const version = await ref.collection('revisions').doc(revisionId(p.data.revision || current)).get();
    if (!version.exists) bad('نسخة تقرير العمليات غير متاحة.', 'failed-precondition');
    const history = await ref.collection('revisions').orderBy('revision', 'desc').limit(30).get();
    return { report: parseOperationsReport(JSON.parse(version.data().reportJson)), currentRevision: current, savedAt: version.data().savedAt,
      history: history.docs.map(doc => ({ revision: doc.data().revision, savedAt: doc.data().savedAt,
        reason: doc.data().correctionReason || 'الإصدار الأول' })), historyLimited: history.size === 30 };
  }
  const p = z.object({ action: z.literal('save'), report: z.unknown(), expectedRevision: z.number().int().min(0).max(999998) }).strict().safeParse(input);
  if (!p.success) bad('طلب حفظ تقرير العمليات غير صالح.');
  let report;
  try { report = parseOperationsReport(p.data.report); } catch (error) { bad(error.message); }
  if ([report.cutAtRiyadh, report.issuedAtRiyadh, report.review.at].filter(Boolean).some(value => Date.parse(value) > now.getTime())
    || (report.historicalImported?.evidenceThroughDate || report.dateRiyadh) > new Date(now.getTime() + 10800000).toISOString().slice(0, 10)) bad('لا يحفظ تقرير أو مراجعة أو دليل بتاريخ مستقبلي.');
  if (p.data.expectedRevision !== report.revision - 1) bad('النسخة المتوقعة غير صحيحة.');
  const contentHash = hash(report), ref = db.collection(OPERATIONS_REPORTS).doc(report.reportId);
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
    tx.set(ref, { reportId: report.reportId, dateRiyadh: report.dateRiyadh, sourceRole: report.sourceRole, sourceLabel: report.sourceLabel,
      kind: report.kind, round: report.round, status: report.status, archiveMode: report.archiveMode, period: report.period,
      title: report.title, cutAtRiyadh: report.cutAtRiyadh, revision: report.revision, savedAt, contentHash });
    return { reportId: report.reportId, revision: report.revision, duplicate: false };
  });
}
