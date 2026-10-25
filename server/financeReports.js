import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AuthError, callerRole } from '../functions/src/handlers.js';
import { financeDay, parseFinanceReport } from '../src/lib/financeReportContract.js';
import { financeSearchText, financeSentence } from '../src/lib/financeReportPresentation.js';

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
const metadata = r => ({reportId:r.reportId,dateRiyadh:r.dateRiyadh,sourceRole:r.sourceRole,period:r.period,
  title:r.title,revision:r.revision,cutAtRiyadh:r.cutAtRiyadh});
async function savedReport(db, head) {
  const version=await db.collection(FINANCE_REPORTS).doc(head.reportId).collection('revisions').doc(revisionId(head.revision)).get();
  if(!version.exists)bad('نسخة تقرير المالية غير متاحة.','failed-precondition');
  return parseFinanceReport(JSON.parse(version.data().reportJson));
}

/** Administrative snapshots, not financial transactions. Source-role labels
 * are attribution only: authorization is the actual caller's current membership. */
export async function financeReports(db, auth, input, now = new Date()) {
  await adminOnly(db, auth);
  if (input?.action === 'list') {
    const p = z.object({ action:z.literal('list'),before:id.optional(),page:z.number().int().min(1).max(1000000).optional(),
      pageSize:z.number().int().min(1).max(30).optional(),query:z.string().trim().max(200).optional(),
      sourceRole:z.union([z.literal(1),z.literal(2),z.literal(3)]).optional(),from:financeDay.optional(),to:financeDay.optional() }).strict().safeParse(input);
    if (!p.success) bad('طلب أرشيف المالية غير صالح.');
    if(['page','pageSize','query','sourceRole','from','to'].some(k=>p.data[k]!==undefined)){
      if(p.data.before||(p.data.from&&p.data.to&&p.data.from>p.data.to))bad('نطاق الأرشيف غير صالح.');
      // Filter the complete archive before slicing; no limited page is treated as the corpus.
      const heads=(await db.collection(FINANCE_REPORTS).get()).docs.map(d=>d.data());
      let found=heads.filter(r=>(!p.data.sourceRole||r.sourceRole===p.data.sourceRole)
        &&(!p.data.from||r.dateRiyadh>=p.data.from)&&(!p.data.to||r.dateRiyadh<=p.data.to));
      const needle=financeSearchText(p.data.query||'');
      if(needle){
        const matched=[];
        // Bound concurrent reads; search even archived details, not just the visible titles.
        for(let i=0;i<found.length;i+=12){
          const batch=await Promise.all(found.slice(i,i+12).map(async head=>({head,report:await savedReport(db,head)})));
          matched.push(...batch.filter(r=>financeSearchText(JSON.stringify(r.report)).includes(needle)).map(r=>r.head));
        }
        found=matched;
      }
      found.sort((a,b)=>b.cutAtRiyadh.localeCompare(a.cutAtRiyadh)||b.reportId.localeCompare(a.reportId));
      const pageSize=p.data.pageSize||8,pageCount=Math.max(1,Math.ceil(found.length/pageSize)),page=Math.min(p.data.page||1,pageCount);
      return {items:found.slice((page-1)*pageSize,page*pageSize).map(r=>({...metadata(r),title:financeSentence(r.title)})),
        total:found.length,page,pageSize,pageCount};
    }
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
    const report=parseFinanceReport(JSON.parse(version.data().reportJson));
    const priorHeads=(await db.collection(FINANCE_REPORTS).where('sourceRole','==',report.sourceRole).get()).docs.map(d=>d.data())
      .filter(r=>r.reportId!==report.reportId&&Date.parse(r.cutAtRiyadh)<Date.parse(report.cutAtRiyadh))
      .sort((a,b)=>b.cutAtRiyadh.localeCompare(a.cutAtRiyadh)||b.reportId.localeCompare(a.reportId));
    let previousMetrics=null,comparisonError=false;
    if(priorHeads.length){
      try{const previous=await savedReport(db,priorHeads[0]);previousMetrics={...metadata(previous),metrics:previous.metrics};}
      catch{comparisonError=true;}
    }
    return { report,previousMetrics,comparisonError,currentRevision: current,
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
