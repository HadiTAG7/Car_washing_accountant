import { createHash } from 'node:crypto';
import { z } from 'zod';
import { LedgerError } from './ledger.js';
import { hashBody } from './sweater/record.js';
import { callerRole } from './handlers.js';
import { sourceSchema, ticketDocumentId, TICKET_REVIEW_TYPE, TICKET_QUEUE_TYPE, REVIEW_OWNER_UID, REVIEW_OWNER_EMAIL } from '../../src/lib/compensationReview.js';
const COLLECTION = 'quality_objections', QUEUE = 'ssp-ticket-review-queue', CAP = 2000;
const fail = (message, code = 'failed-precondition') => { throw new LedgerError(message, { code }); };
const revision = z.number().int().min(0);
const request = z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/);
const ticket = z.string().regex(/^[A-Z0-9][A-Z0-9-]{0,79}$/);
const sourceRequest = z.object({ requestId: request, expectedRevision: revision, source: sourceSchema }).strict();
const ownerRequest = z.object({ requestId: request, ticketId: ticket, expectedRevision: revision, expectedQueueRevision: revision,
  action: z.enum(['leave','information','draft','request_submission','next','select','reopen']), text: z.string().max(8000), confirmed: z.literal(true) }).strict();
const executionRequest = z.object({ requestId: request, ticketId: ticket, expectedRevision: revision, submissionRequestId: request,
  action: z.enum(['observed','receipt']), objectionId: z.string().regex(/^OBJ[-A-Z0-9]+$/).nullable(),
}).strict();
const parse = (schema, input) => { const r = schema.safeParse(input); if (!r.success) fail(r.error.issues.map(i => i.message).join(' · '), 'invalid-argument'); return r.data; };
async function authorized(db, auth, owner = false, read = null) {
  // Membership reads participate in the transaction's conflict/revocation
  // checks, using the existing role resolver rather than a second role policy.
  const roleDb = read ? { collection: name => ({ doc: id => ({ get: () => read(db.collection(name).doc(id)) }) }) } : db;
  if (await callerRole(roleDb, read ? { ...auth } : auth) !== 'admin') fail('سجل مراجعة التكتات للمدير فقط.', 'permission-denied');
  if (owner && (auth.uid !== REVIEW_OWNER_UID || String(auth.token?.email || '').toLowerCase() !== REVIEW_OWNER_EMAIL))
    fail('قرار التكت من جلسة هادي المخولة فقط؛ دور المدير وحده لا يكفي.', 'permission-denied');
}
function assertSize(value) { if (Buffer.byteLength(JSON.stringify(value)) > 800000) fail('السجل بلغ حد الحفظ الآمن؛ لا تعِد الطلب بمفتاح جديد.'); }
async function allCases(read, db) {
  const snap = await read(db.collection(COLLECTION).where('metricKey', '==', 'ticket_review').limit(CAP + 1));
  if (snap.docs.length > CAP) fail('تغطية السجل تجاوزت حد القراءة؛ لا نعرض قائمة جزئية.');
  return snap.docs.map(d => ({ ...d.data(), id: d.id })).filter(r => r.recordType === TICKET_REVIEW_TYPE);
}
const queueDefault = () => ({ recordType: TICKET_QUEUE_TYPE, periodKey: '2000-01', metricKey: 'ticket_review_queue', revision: 0, activeTicketId: null, hasActivated: false });
const eligible = row => (row.source?.queueDisposition === 'eligible' || row.ownerReopenedAt) && row.reviewStatus === 'pending' && !row.objectionHistory?.length;
const materialHash = source => hashBody({ facts: source.facts, amounts: source.amounts, timeline: source.timeline,
  analysis: source.analysis, attachments: source.attachments.map(({url: _url,...attachment})=>attachment),
  objections: source.objections.map(({checkedAt: _checkedAt,url: _url,...obj})=>obj),
  queueDisposition: source.queueDisposition, historicalReference: source.historicalReference });
const nextCase = (rows, current) => rows.filter(r => r.ticketId !== current && eligible(r))
  .sort((a,b) => a.firstSavedAt.localeCompare(b.firstSavedAt) || a.ticketId.localeCompare(b.ticketId))[0]?.ticketId || null;
function identity(doc, ticketId) {
  if (doc && (doc.recordType !== TICKET_REVIEW_TYPE || doc.ticketId !== ticketId)) fail('هوية السجل محجوزة لمسار آخر.');
}
async function transaction(db, auth, input, mode, now) {
  const ref = db.collection(COLLECTION).doc(ticketDocumentId(input.source?.ticketId || input.ticketId));
  const qref = db.collection(COLLECTION).doc(QUEUE), requestHash = hashBody({ mode, input });
  return db.runTransaction(async tx => {
    await authorized(db, auth, mode === 'owner', ref => tx.get(ref));
    const [snap, qsnap, cases] = await Promise.all([tx.get(ref), tx.get(qref), allCases(q => tx.get(q), db)]);
    const old = snap.exists ? snap.data() : null, queue = qsnap.exists ? qsnap.data() : queueDefault();
    const ticketId = input.source?.ticketId || input.ticketId;
    identity(old, ticketId);
    if (queue.recordType !== TICKET_QUEUE_TYPE) fail('سجل الطابور غير متوافق.');
    const receipt = old?.requestReceipts?.find(r => r.requestId === input.requestId);
    if (receipt) {
      if (receipt.hash !== requestHash || receipt.actor !== auth.uid) fail('مفتاح الطلب مستخدم لمحتوى آخر.', 'already-exists');
      return { replay: true, saved: false, record: { ...old, id: ref.id }, queue };
    }
    if ((old?.revision || 0) !== input.expectedRevision) fail('تغيّر السجل؛ أعد قراءته قبل الحفظ.', 'aborted');
    const at = now.toISOString();
    let row = old ? structuredClone(old) : { recordType: TICKET_REVIEW_TYPE, ticketId, periodKey: (input.source.facts.serviceDate || input.source.source.readAt).slice(0,7),
      metricKey: 'ticket_review', firstSavedAt: at, revision: 0, decisions: [], sourceHistory: [], requestReceipts: [],
      draft: { text: '', revision: 0 }, submission: { status: 'none' }, reviewStatus: 'pending' };
    let q = { ...queue };
    if (mode === 'source') {
      const source = input.source, sourceHash = hashBody(source);
      if (Date.parse(source.source.readAt) > now.getTime() + 300000
        || (source.source.coverage.to && Date.parse(source.source.coverage.to) > Date.parse(source.source.readAt))
        || (!source.source.coverage.complete && source.source.coverage.lastCompleteThrough !== (old?.source?.source.coverage.lastCompleteThrough ?? null)))
        fail('وقت المصدر أو آخر نطاق مكتمل لا يطابق تغطية القراءة.');
      if (old && Date.parse(source.source.readAt) < Date.parse(old.source.source.readAt)) fail('قراءة المصدر أقدم من المحفوظة.', 'aborted');
      if (old?.sourceHash === sourceHash) return { unchanged: true, saved: false, record: { ...old, id: ref.id }, queue };
      // Historical source facts can archive a case, never mint a current owner decision.
      if (['historical_excluded','historical_deferred'].includes(old?.source?.queueDisposition) && source.queueDisposition !== old.source.queueDisposition)
        fail('لا يعيد تحديث المصدر حالة أكتوبر المستثناة للطابور.');
      const changed = !old || materialHash(source) !== (old.materialHash || materialHash(old.source));
      if (old && changed) row.sourceHistory.push({ sourceHash: row.sourceHash, source: row.source, replacedAt: at, actor: auth.uid });
      row.sourceChecks = [...(old?.sourceChecks || []), { at, readAt: source.source.readAt, actor: auth.uid,
        sourceHash, coverage: source.source.coverage, materiallyChanged: changed }];
      row.materialHash = materialHash(source);
      row.source = source; row.sourceHash = sourceHash;
      row.lastSourceSavedAt = at;
      if (!old) {
        row.reviewStatus = source.queueDisposition === 'eligible' ? 'pending' : source.queueDisposition;
        row.draft = { text: source.analysis.proposedDraft, revision: source.analysis.proposedDraft ? 1 : 0 };
        row.submission = { status: row.draft.text ? 'draft' : 'none' };
      }
      // Preserve every OBJ observed before; an incomplete refresh cannot erase it.
      const objs = new Map((old?.objectionHistory || []).map(o => [o.id, o]));
      for (const o of source.objections) {
        if (objs.has(o.id) && Date.parse(o.checkedAt) < Date.parse(objs.get(o.id).checkedAt)) fail('قراءة الاعتراض أقدم من المحفوظة.');
        objs.set(o.id, o);
      }
      row.objectionHistory = [...objs.values()];
      const oldObj = (old?.objectionHistory || []).map(({checkedAt: _checkedAt,url: _url,...o})=>o);
      const newObj = row.objectionHistory.map(({checkedAt: _checkedAt,url: _url,...o})=>o);
      row.objectionObservations = [...(old?.objectionObservations || [])];
      if (hashBody(oldObj) !== hashBody(newObj)) row.objectionObservations.push({ at, actor: auth.uid, objections: source.objections });
      if (!row.ownerReopenedAt && ['pending','historical_excluded','historical_deferred','prior_decision_unverified','previously_objected'].includes(row.reviewStatus)) {
        row.reviewStatus = source.queueDisposition !== 'eligible' ? source.queueDisposition
          : row.objectionHistory.length ? 'previously_objected' : 'pending';
      }
      if (q.activeTicketId === row.ticketId && !eligible(row) && !['queued','in_progress_uncertain'].includes(row.submission.status))
        q.activeTicketId = null;
      if (!q.hasActivated && !q.activeTicketId && eligible(row)) { q.activeTicketId = row.ticketId; q.hasActivated = true; }
    } else if (mode === 'owner') {
      if (!old) fail('التكت غير موجود.', 'not-found');
      if (queue.revision !== input.expectedQueueRevision) fail('تغيّر الطابور؛ أعد قراءته.', 'aborted');
      if (!['select','reopen'].includes(input.action) && queue.activeTicketId !== ticketId) fail('القرار للحالة النشطة فقط.');
      if (input.action === 'select') {
        if (!eligible(row) && row.reviewStatus !== 'deferred') fail('فتح الأرشيف لا يعيد مراجعته؛ استخدم قرار إعادة مراجعة مستقلًا.');
        q.activeTicketId = ticketId; q.hasActivated = true;
      }
      if (input.action === 'reopen') {
        if (!input.text.trim()) fail('اكتب سبب توجيه إعادة المراجعة.');
        row.ownerReopenedAt = at; row.reviewStatus = 'pending'; q.activeTicketId = ticketId; q.hasActivated = true;
      }
      if (input.action === 'draft') {
        const value = input.text.trim();
        if (row.draft.text !== value) {
          row.draft = { text: value, revision: row.draft.revision + 1 };
          if (row.submission.status === 'in_progress_uncertain') fail('الإرسال غير محسوم؛ افحص OBJ قبل تغيير النص.');
          row.submission = { status: value ? 'draft' : 'none', invalidatedRequestId: row.submission.requestId || null };
        }
      }
      if (input.action === 'request_submission') {
        if (!input.text.trim() || input.text !== row.draft.text || row.submission.status === 'sent'
          || row.objectionHistory?.length || (row.source.queueDisposition !== 'eligible' && !row.ownerReopenedAt)
          || ['queued','in_progress_uncertain'].includes(row.submission.status)) fail('النص تغير أو يوجد اعتراض/طلب قائم؛ لا يمكن إنشاء طلب رفع مكرر.');
        row.submission = { status: 'queued', requestId: input.requestId, ticketId, text: input.text, textHash: hashBody(input.text),
          draftRevision: row.draft.revision, requestedAt: at, requestedBy: auth.uid, caseRevision: old.revision };
      }
      if (['leave','information'].includes(input.action)) {
        if (row.submission.status === 'in_progress_uncertain') fail('الإرسال غير محسوم؛ افحص OBJ أولًا.');
        if (input.action === 'information' && !input.text.trim()) fail('اكتب المعلومات المطلوبة.');
        row.reviewStatus = input.action === 'leave' ? 'left' : 'information_requested';
        if (row.submission.status !== 'sent') row.submission = { status: row.draft.text ? 'draft' : 'none', invalidatedRequestId: row.submission.requestId || null };
      }
      if (input.action === 'next') {
        if (row.reviewStatus === 'pending') row.reviewStatus = 'deferred';
        q.activeTicketId = nextCase(cases, ticketId);
      }
      row.decisions.push({ action: input.action, ticketId, actor: auth.uid, at, caseRevision: old.revision,
        draftRevision: row.draft.revision, text: input.text, requestId: input.requestId });
    } else {
      if (!old || row.submission.requestId !== input.submissionRequestId
        || !['queued','in_progress_uncertain'].includes(row.submission.status)
        || row.submission.textHash !== hashBody(row.draft.text) || row.submission.draftRevision !== row.draft.revision)
        fail('لا يوجد طلب هادي مطابق للنص الحالي.');
      row.lastWorkerReadAt = at; row.lastWorkerId = auth.uid;
      if (input.action === 'observed') {
        if (input.objectionId !== null) fail('قراءة الطلب لا تُنشئ إيصال اعتراض.');
        row.submission = { ...row.submission, status: 'in_progress_uncertain', observedAt: at, observedBy: auth.uid };
      } else {
        const obj = row.objectionHistory?.find(o => o.id === input.objectionId && o.ticketId === ticketId
          && Date.parse(o.checkedAt) >= Date.parse(row.submission.requestedAt));
        if (!obj) fail('يلزم OBJ مطابق مقروء بعد طلب هادي.');
        row.submission = { ...row.submission, status: 'sent', objectionId: obj.id, receiptAt: at, receiptBy: auth.uid };
      }
    }
    row.revision = (old?.revision || 0) + 1; row.updatedAtIso = at; row.updatedBy = auth.uid;
    row.status = 'ticket_review'; // Never an internal Accepted or financial status.
    row.requestReceipts.push({ requestId: input.requestId, hash: requestHash, actor: auth.uid, mode, at, revision: row.revision });
    q.revision++; q.updatedAtIso = at;
    assertSize(row);
    tx.set(ref, row); tx.set(qref, q);
    tx.set(db.collection('audit_logs').doc('ticket-review-' + createHash('sha256').update(ref.id + ':' + row.revision).digest('hex')), {
      action: 'ticket-review-' + mode, collectionName: COLLECTION, documentId: ref.id, userId: auth.uid, atIso: at,
      before: { revision: old?.revision || 0 }, after: { revision: row.revision },
    });
    return { saved: true, record: { ...row, id: ref.id }, queue: q };
  });
}
export async function compensationReview(db, input, auth, now = new Date()) {
  await authorized(db, auth);
  if (input?.op === 'read') {
    parse(z.object({ op: z.literal('read') }).strict(), input);
    const [cases, queue] = await Promise.all([allCases(q => q.get(), db), db.collection(COLLECTION).doc(QUEUE).get()]);
    return { cases, queue: queue.exists ? queue.data() : queueDefault(),
      canDecide: auth.uid === REVIEW_OWNER_UID && auth.token?.email === REVIEW_OWNER_EMAIL, immediateWakeup: false };
  }
  if (input?.op === 'source') return transaction(db, auth, parse(sourceRequest, input.data), 'source', now);
  if (input?.op === 'owner') return transaction(db, auth, parse(ownerRequest, input.data), 'owner', now);
  if (input?.op === 'execution') return transaction(db, auth, parse(executionRequest, input.data), 'execution', now);
  fail('عملية مراجعة غير معروفة.', 'invalid-argument');
}


