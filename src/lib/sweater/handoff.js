import { recordProblems } from '../../../functions/src/sweater/recordContract.js';
import { normalizeBookingStatus, UNKNOWN_STATUS } from '../../../functions/src/sweater/vocab.js';
import { ownerConfirmationProblems } from './ownerConfirmation.js';

export const HANDOFF_MAX_BYTES = 2 * 1024 * 1024;
const FIELDS = new Set(['importRunId', 'mode', 'dryRun', 'agentStatus', 'coverage', 'records', 'ownerConfirmation', 'workerLinks']);
const SCOPED_COVERAGE_FIELDS = ['scope', 'scopeComplete', 'sourceRecordCount', 'excludedCancelled', 'imported'];
const COVERAGE_FIELDS = new Set(['rangeFrom', 'rangeTo', 'extractedAt', 'pageCount', 'pagesFetched', 'recordCount', 'isComplete', 'sourceUrl', ...SCOPED_COVERAGE_FIELDS]);
export const ACCOUNT_BOOKINGS_SCOPE_WARNING = 'التغطية مكتملة لنطاق accountBookings المقروء فقط؛ Company/B2B غير متحقق، ولا تؤكد اكتمال الشركة أو الشهر أو الإقفال.';
export const ownerHandoffCoverageComplete = coverage => coverage?.scope === 'accountBookings'
  ? coverage.scopeComplete === true && coverage.isComplete === false
  : coverage?.scope === undefined && coverage?.isComplete === true;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const day = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const safeUrl = value => {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash; }
  catch { return false; }
};

// Local review and server preview share this check. Raw SSP labels stay raw;
// missing service types are rejected, never inferred from booking prefixes.
export function reviewSweaterHandoff(input) {
  const errors = []; const warnings = [];
  if (!object(input)) return { ready: false, errors: ['ملف التسليم يجب أن يكون كائن JSON.'], warnings, rows: [] };
  if (new TextEncoder().encode(JSON.stringify(input)).length > HANDOFF_MAX_BYTES) errors.push('حد الملف ٢ ميغابايت.');
  if (Object.keys(input).some(key => !FIELDS.has(key))) errors.push('حقول غير مسموحة في جسم التسليم؛ احذفها قبل الإرسال.');
  if (typeof input.importRunId !== 'string' || !/^[a-zA-Z0-9._:-]{1,128}$/.test(input.importRunId)) errors.push('importRunId مطلوب بمعرّف آمن لا يحتوي مسارات.');
  if (input.mode != null && input.mode !== 'import') errors.push('هذا المسار لمعاينة السجلات فقط.');
  if (input.dryRun != null && input.dryRun !== true) errors.push('هذا المسار يقبل dryRun: true فقط.');
  if (input.agentStatus != null && input.agentStatus !== 'ok') errors.push('توقف المصدر يحتاج مراجعة؛ لا ترسل دفعة من جلسة محجوبة أو منتهية.');
  const records = Array.isArray(input.records) ? input.records : [];
  if (!Array.isArray(input.records)) errors.push('records يجب أن تكون قائمة.');
  if (records.length > 500) errors.push('حد الدفعة ٥٠٠ سجل.');
  if (input.ownerConfirmation !== undefined) errors.push(...ownerConfirmationProblems(input.ownerConfirmation, records));
  if (input.ownerConfirmation !== undefined && (!object(input.workerLinks)
    || Object.values(input.workerLinks).some(value => typeof value !== 'string' || !value.trim() || value.length > 180 || value.includes('/'))
    || Object.keys(input.workerLinks).some(key => !records.some(row => row?.driverExternalId === key)))) errors.push('ربط معرّف العامل في SSP بمعرّفه في سجل العاملين مطلوب.');
  if (input.workerLinks !== undefined && input.ownerConfirmation === undefined) errors.push('حقول غير مسموحة في جسم التسليم؛ احذفها قبل الإرسال.');
  const coverage = input.coverage;
  if (!object(coverage)) errors.push('معلومات التغطية مطلوبة.');
  else {
    if (Object.keys(coverage).some(key => !COVERAGE_FIELDS.has(key))) errors.push('حقول تغطية غير مسموحة.');
    if (!day(coverage.rangeFrom) || !day(coverage.rangeTo) || coverage.rangeTo < coverage.rangeFrom) errors.push('نطاق التغطية يحتاج تاريخين صحيحين بترتيب صحيح.');
    if (typeof coverage.extractedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(coverage.extractedAt)
      || !day(coverage.extractedAt.slice(0, 10)) || !Number.isFinite(Date.parse(coverage.extractedAt))) errors.push('وقت القراءة الفعلي extractedAt مطلوب مع المنطقة الزمنية.');
    if (!Number.isInteger(coverage.pageCount) || coverage.pageCount < 0 || !Number.isInteger(coverage.pagesFetched)
      || coverage.pagesFetched < 0 || coverage.pagesFetched > coverage.pageCount) errors.push('عدد الصفحات المقروءة والكلي غير صالح.');
    if (coverage.recordCount !== records.length) errors.push('recordCount لا يطابق عدد صفوف التسليم، بما فيها التكرار.');
    if (typeof coverage.isComplete !== 'boolean') errors.push('isComplete يجب أن يعبّر عن التغطية الفعلية.');
    if (coverage.isComplete === true && coverage.pagesFetched !== coverage.pageCount) errors.push('لا يمكن تأكيد التغطية مع صفحات مفقودة.');
    if (coverage.isComplete === false) warnings.push('التغطية غير مكتملة؛ المعاينة لا تؤكد اكتمال الشهر.');
    if (SCOPED_COVERAGE_FIELDS.some(key => Object.hasOwn(coverage, key))) {
      if (coverage.scope !== 'accountBookings') errors.push('نطاق التغطية غير معروف؛ النطاق المحدد المسموح accountBookings فقط.');
      if (typeof coverage.scopeComplete !== 'boolean') errors.push('scopeComplete يجب أن يعبّر عن اكتمال النطاق المقروء فقط.');
      if (coverage.isComplete !== false) errors.push('نطاق accountBookings لا يثبت اكتمال الشركة؛ يجب إبقاء isComplete: false.');
      if (['sourceRecordCount', 'excludedCancelled', 'imported'].some(key => !Number.isSafeInteger(coverage[key]) || coverage[key] < 0)
        || coverage.imported !== records.length || coverage.sourceRecordCount !== coverage.excludedCancelled + coverage.imported) {
        errors.push('أعداد النطاق غير متطابقة: المصدر يساوي المستورد مع الملغى المستبعد، والمستورد يساوي صفوف التسليم.');
      }
      if (coverage.scopeComplete === true && (coverage.pagesFetched !== coverage.pageCount || coverage.pageCount < 1)) errors.push('لا يمكن تأكيد اكتمال النطاق مع صفحات مفقودة أو دون صفحة مقروءة.');
      if (coverage.scope === 'accountBookings' && coverage.scopeComplete === true) warnings.push(ACCOUNT_BOOKINGS_SCOPE_WARNING);
    }
    if (records.length && coverage.pageCount === 0) errors.push('هناك سجلات دون صفحة مصدر مقروءة.');
    if (coverage.sourceUrl != null && !safeUrl(coverage.sourceUrl)) errors.push('رابط المصدر يجب أن يكون HTTPS بلا معاملات دخول أو أجزاء سرية.');
  }
  const rows = records.map((record, index) => {
    const problems = recordProblems(record).map(p => ({ code: p.code, message: p.ar }));
    if (object(record)) {
      if (Object.values(record).some(value => value !== null && typeof value === 'object')) problems.push({ code: 'bad_type', message: 'حقول السجل يجب أن تكون قيماً بسيطة؛ لا ترسل كائنات جلسة أو بيانات متداخلة.' });
      for (const key of ['sspBookingId', 'serviceType', 'serviceDate', 'rawStatus']) {
        if (record[key] != null && typeof record[key] !== 'string') problems.push({ code: 'bad_type', message: `${key} يجب أن يكون نصاً.` });
      }
      if (!day(record.serviceDate)) problems.push({ code: 'bad_date', message: 'تاريخ الخدمة يجب أن يكون يوماً صحيحاً بصيغة YYYY-MM-DD.' });
      if (day(record.serviceDate) && day(coverage?.rangeFrom) && day(coverage?.rangeTo)
        && (record.serviceDate < coverage.rangeFrom || record.serviceDate > coverage.rangeTo)) problems.push({ code: 'outside_coverage', message: 'الخدمة خارج النطاق المعلن.' });
      if (record.sourceUrl != null && !safeUrl(record.sourceUrl)) problems.push({ code: 'unsafe_source_url', message: 'رابط السجل يجب أن يكون HTTPS بلا بيانات دخول.' });
    }
    const status = normalizeBookingStatus(record?.rawStatus);
    if (input.ownerConfirmation !== undefined) {
      if (status !== 'payment_collection') problems.push({ code: 'unconfirmed_completion', message: 'إقرار التحصيل يقبل غسلات Collecting Payment فقط؛ الملغاة وغير المكتملة مستبعدة.' });
      if (typeof record?.driverExternalId !== 'string' || !record.driverExternalId.trim()) problems.push({ code: 'missing_worker', message: 'معرّف العامل المنفذ من SSP مطلوب لحفظ الغسلة.' });
      if (!object(input.workerLinks) || !Object.hasOwn(input.workerLinks, record?.driverExternalId)) problems.push({ code: 'missing_worker_link', message: 'اربط العامل المنفذ بسجله الداخلي قبل حفظ الغسلة.' });
    }
    return { index: index + 1, sspBookingId: typeof record?.sspBookingId === 'string' ? record.sspBookingId : '—',
      problems, status, needsStatusReview: status === UNKNOWN_STATUS };
  });
  if (rows.some(row => row.needsStatusReview)) warnings.push('حالات غير معروفة محفوظة حرفياً؛ لا تتحول إلى اكتمال أو إيراد.');
  const ready = !errors.length && rows.every(row => !row.problems.length);
  return { ready, errors, warnings, rows,
    // Only a fully reviewed file can become a request. No filtering or repair.
    payload: ready ? { ...input, mode: 'import', dryRun: true, agentStatus: 'ok' } : null };
}
