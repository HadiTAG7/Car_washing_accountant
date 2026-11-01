import { recordProblems, ALLOWED_RECORD_FIELDS } from '../../../functions/src/sweater/recordContract.js';
import { ownerBookingIdentity } from './bookingIdentity.js';

export const ADMIN_COMPLETION_KIND = 'owner_administrative_completion_v1';
export const ADMIN_COMPLETION_WARNING = 'اكتمال إداري بقرار المالك، لا اكتمال من SSP ولا إثبات تحصيل. التغطية للحجوزات المحددة فقط.';
// Hadi's 25 Oct approval is for this observation only, not a new CP policy.
export const MISSING_START_OWNER_APPROVAL = Object.freeze({
  sspBookingId: 'S-5655042', serviceDate: '2026-10-24', driverExternalId: '1988',
  workerId: '5MMg7pj0wjYM06NLuzS7', rawStatus: 'Collecting Payment',
  completedAt: '2026-10-24T14:48:00+03:00',
  conversationId: '01a04f9f-cdbe-7213-bf1b-eee76eb35b38',
  messageId: '01a16fb9-0e70-7203-b117-6f8c2fe44a8c',
});
export function isApprovedMissingStartCompletion(input, record) {
  const a = MISSING_START_OWNER_APPROVAL;
  return input.records?.length === 1 && input.decision?.bookingIds?.length === 1
    && input.decision.bookingIds[0] === a.sspBookingId
    && input.decision.conversationId === a.conversationId && input.decision.messageId === a.messageId
    && input.decision.serviceDate === a.serviceDate
    && ['sspBookingId', 'serviceDate', 'driverExternalId', 'rawStatus', 'completedAt'].every(k => record?.[k] === a[k])
    && record.startedAt === null && record.serviceType === 'interior_exterior_wash'
    && input.workerLinks?.[a.driverExternalId] === a.workerId;
}
const object = x => x && typeof x === 'object' && !Array.isArray(x);
const exact = (x, keys) => object(x) && Object.keys(x).every(k => keys.includes(k));
const text = (x, max = 1000) => typeof x === 'string' && x.trim().length > 0 && x.length <= max;
const id = x => typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(x);
const day = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0, 10) === x;
const stamp = x => typeof x === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(x) && Number.isFinite(Date.parse(x));
const url = x => { try { const u = new URL(x); return u.protocol === 'https:' && u.hostname === 'ssp-portal.sweater.sa' && !u.username && !u.password && !u.hash && ![...u.searchParams.keys()].some(k => /token|session|auth|secret|cookie/i.test(k)); } catch { return false; } };

// Client-side shape review only. The server separately binds this decision to
// the seventeen reviewed records and their actual workers/source observations.
// It is not a new automatic Collecting Payment or minute-precision policy.
export function isRecentOwnerRecoveryDecision(input) {
  const d = input?.decision;
  return d?.conversationId === '01a04f9f-cdbe-7213-bf1b-eee76eb35b38'
    && d.messageId === '01a19941-eb8d-71b1-8a54-eb04ff63bf26'
    && d.decidedAt === '2026-11-01T22:36:41Z' && d.decidedAtBasis === 'request_received_at'
    && ['2026-10-30', '2026-10-31', '2026-11-01'].includes(d.serviceDate)
    && d.approved === true && d.source === 'owner_statement' && d.decision === 'record_as_completed_wash';
}
function recentOwnerRecoveryShape(input, record) {
  return isRecentOwnerRecoveryDecision(input) && record?.rawStatus === 'Collecting Payment'
    && record.serviceType === 'interior_exterior_wash' && stamp(record.startedAt) && stamp(record.completedAt);
}

// Standing owner instruction of 18 Oct, reaffirmed on 25/26 Oct. This changes
// the administrative decision route only; automatic source completion still
// requires real Start and End, and cancellation approvals remain independent.
export const ONGOING_OWNER_APPROVAL = Object.freeze({
  effectiveFrom: '2026-10-18', conversationId: '01a04f9f-cdbe-7213-bf1b-eee76eb35b38',
  messageIds: Object.freeze(['01a15086-97de-7292-8767-b755ee029923', '01a16f81-d999-7e20-b83d-8ece75c37e15', '01a179ab-1b3f-7373-bf4c-f35d4f623bb1']),
});
export function isApprovedOngoingCompletion(input, record, now = Date.now()) {
  const d = input.decision, c = input.coverage, a = ONGOING_OWNER_APPROVAL;
  if (!d || !c || d.conversationId !== a.conversationId || !a.messageIds.includes(d.messageId)
    || d.approved !== true || d.source !== 'owner_statement' || !day(record?.serviceDate) || record.serviceDate < a.effectiveFrom
    || record.rawStatus !== 'Washing Started' || record.serviceType !== 'interior_exterior_wash'
    || record.completedAt !== null || !stamp(record.startedAt) || !stamp(c.extractedAt) || !stamp(d.decidedAt)) return false;
  const started = Date.parse(record.startedAt), observed = Date.parse(c.extractedAt), decided = Date.parse(d.decidedAt);
  return started <= observed && observed <= now && decided <= observed
    && new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Riyadh' }).format(new Date(started)) === record.serviceDate;
}

// An explicit, bounded owner decision. No daily booking exceptions, prices,
// collection assertion, source status conversion, credentials or write access.
export function reviewAdministrativeCompletion(input) {
  const errors = [], rows = [], warnings = [ADMIN_COMPLETION_WARNING];
  if (!exact(input, ['kind', 'importRunId', 'coverage', 'decision', 'workerLinks', 'records'])
    || input.kind !== ADMIN_COMPLETION_KIND || !id(input.importRunId)
    || new TextEncoder().encode(JSON.stringify(input)).length > 2 * 1024 * 1024) {
    return { ready: false, errors: ['عقد قرار الاكتمال الإداري أو حجم الملف غير صالح.'], rows, warnings, payload: null };
  }
  const d = input.decision, c = input.coverage, records = Array.isArray(input.records) ? input.records : [];
  if (!exact(d, ['source', 'ownerName', 'statement', 'conversationId', 'messageId', 'decidedAt', 'decidedAtBasis', 'approved', 'decision', 'serviceDate', 'bookingIds', 'excludedBookingIds'])
    || d.source !== 'owner_statement' || d.approved !== true || d.decision !== 'record_as_completed_wash'
    || !text(d.ownerName, 150) || !text(d.statement, 2000) || !id(d.conversationId) || !id(d.messageId)
    || !stamp(d.decidedAt) || !['message_timestamp', 'request_received_at'].includes(d.decidedAtBasis) || !day(d.serviceDate) || !Array.isArray(d.bookingIds) || !d.bookingIds.length || d.bookingIds.length > 50
    || d.bookingIds.some(x => typeof x !== 'string' || !/^(?:[A-Za-z]+-)?\d+$/.test(x)) || new Set(d.bookingIds.map(ownerBookingIdentity)).size !== d.bookingIds.length
    || !Array.isArray(d.excludedBookingIds) || d.excludedBookingIds.length > 100 || d.excludedBookingIds.some(x => typeof x !== 'string' || !/^(?:[A-Za-z]+-)?\d+$/.test(x))) {
    errors.push('قرار هادي يحتاج نصًا ومرجع رسالة وتاريخًا وقائمة حجوزات صريحة ومستثنيات منفصلة.');
  }
  if (!exact(c, ['rangeFrom', 'rangeTo', 'extractedAt', 'pageCount', 'pagesFetched', 'recordCount', 'isComplete', 'sourceUrl', 'scope', 'scopeComplete'])
    || !day(c.rangeFrom) || c.rangeFrom !== c.rangeTo || c.rangeFrom !== d?.serviceDate
    || !stamp(c.extractedAt) || !Number.isSafeInteger(c.pageCount) || c.pageCount < 1 || c.pagesFetched !== c.pageCount
    || c.recordCount !== records.length || c.isComplete !== false || c.scope !== 'explicit_owner_bookings' || c.scopeComplete !== true || !url(c.sourceUrl)) {
    errors.push('التغطية للحجوزات المعتمدة فقط، بوقت قراءة ومصدر وصفحات كاملة، دون ادعاء اكتمال اليوم أو الشركة.');
  }
  if (!Array.isArray(input.records) || !records.length || records.length > 50 || records.length !== d?.bookingIds?.length
    || new Set(records.map(r => ownerBookingIdentity(r?.sspBookingId))).size !== records.length
    || !object(input.workerLinks) || Object.entries(input.workerLinks).some(([k,v]) => !id(k) || !id(v) || !records.some(r => r?.driverExternalId === k))) errors.push('الحجوزات وروابط العمال يجب أن تطابق نطاق القرار دون تكرار.');
  const approvedIds = Array.isArray(d?.bookingIds) ? d.bookingIds : [];
  const excluded = new Set((Array.isArray(d?.excludedBookingIds) ? d.excludedBookingIds : []).map(ownerBookingIdentity));
  for (const [index, r] of records.entries()) {
    const problems = recordProblems(r).filter(p => p.code !== 'unknown_service_type').map(p => ({ code: p.code, message: p.ar }));
    if (!object(r) || !approvedIds.includes(r.sspBookingId) || excluded.has(ownerBookingIdentity(r?.sspBookingId))
      || r?.serviceDate !== d?.serviceDate || (r?.rawStatus !== 'Cancelled by Admin' && !isApprovedMissingStartCompletion(input, r) && !isApprovedOngoingCompletion(input, r) && !recentOwnerRecoveryShape(input, r)) || r?.bookingKind !== 'individual'
      || !id(r?.driverExternalId) || !input.workerLinks?.[r?.driverExternalId] || !url(r?.sourceUrl)) problems.push({ code: 'outside_decision', message: 'الحجز خارج قرار المالك أو مستثنى أو حالته/عامله غير موثقين.' });
    if (object(r) && ALLOWED_RECORD_FIELDS.some(k => r[k] != null && (typeof r[k] === 'object' || typeof r[k] === 'boolean' || String(r[k]).length > 2000))) problems.push({ code: 'bad_shape', message: 'حقول المصدر يجب أن تبقى قيمًا بسيطة دون بيانات جلسة.' });
    rows.push({ index: index + 1, sspBookingId: r?.sspBookingId || '—', problems });
  }
  const ready = !errors.length && rows.every(r => !r.problems.length);
  return { ready, errors, rows, warnings, payload: ready ? input : null };
}
