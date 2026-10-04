// Shared, browser-safe validation. No credentials, hashing or database access.
import { forbiddenFieldsIn } from './vocab.js';
import { isoDay } from './datedConfig.js';

/** الحقول المسموح بها. ما عداها يُرفض — قائمةٌ بيضاء لا سوداء. */
export const ALLOWED_RECORD_FIELDS = Object.freeze([
  'sspBookingId', 'bookingKind', 'serviceType', 'serviceTypeLabel',
  'serviceDate', 'serviceTime',
  'driverName', 'driverExternalId', 'companyNumber',
  'region', 'branch', 'companyName',
  'vehiclePlate', 'vehicleMake', 'vehicleModel',
  'rawStatus', 'rawPaymentStatus',
  'platformAmount', 'customerDiscount', 'partnerOperationalDeduction',
  'arrivedAt', 'startedAt', 'completedAt',
  'rating', 'ticketRef', 'compensationAmount', 'violationRef', 'damageRef',
  'sourceUrl', 'notes',
]);

const ALLOWED = new Set(ALLOWED_RECORD_FIELDS);

const num = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};
const str = (v) => String(v ?? '').trim();

/**
 * ما يمنع سجلاً من القبول — رسائل عربية تُعرض للمراجع.
 *
 * الترتيب مقصود: الحقول الممنوعة أولاً. سجلٌ يحمل `password` أو `netAmount`
 * يُرفض قبل أن يُنظر في صحة تاريخه — لأن المشكلة ليست في بياناته بل في أن
 * الوكيل أرسل ما ليس له.
 */
export function recordProblems(rec) {
  const problems = [];
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) {
    return [{ code: 'bad_shape', ar: 'السجل ليس كائناً.' }];
  }

  const forbidden = forbiddenFieldsIn(rec);
  if (forbidden.length) {
    problems.push({
      code: 'forbidden_field',
      ar: `حقول لا يجوز للوكيل إرسالها: ${forbidden.join('، ')}. `
        + 'المبالغ والحسابات وحالات الاعتماد يقرّرها الخادم، والأسرار والبيانات '
        + 'الشخصية لا تُخزَّن أصلاً.',
    });
    return problems; // لا يُكمَل الفحص — السجل مرفوض من أصله
  }

  const unknown = Object.keys(rec).filter((k) => !ALLOWED.has(k));
  if (unknown.length) {
    problems.push({
      code: 'unknown_field',
      ar: `حقول غير معروفة: ${unknown.join('، ')}. القائمة بيضاء — ما لا يُذكر في العقد يُرفض.`,
    });
  }

  if (!str(rec.sspBookingId)) {
    problems.push({ code: 'missing_booking_id', ar: 'رقم الحجز مطلوب — وهو مفتاح التفرّد.' });
  }
  if (!str(rec.serviceType)) {
    problems.push({ code: 'unknown_service_type', ar: 'نوع الخدمة مطلوب — وبه يُقرأ السعر التعاقدي.' });
  }
  if (!isoDay(rec.serviceDate)) {
    problems.push({
      code: 'missing_service_date',
      ar: 'تاريخ الخدمة مطلوب بصيغة YYYY-MM-DD — وبه تُقرأ القاعدة السارية يومها.',
    });
  }
  if (!str(rec.rawStatus)) {
    problems.push({ code: 'unknown_status', ar: 'حالة التشغيل مطلوبة كما تعرضها المنصة.' });
  }

  for (const [field, label] of [
    ['platformAmount', 'مبلغ المنصة'],
    ['customerDiscount', 'خصم العميل'],
    ['partnerOperationalDeduction', 'الخصم التشغيلي'],
    ['compensationAmount', 'التعويض'],
  ]) {
    const n = num(rec[field]);
    if (Number.isNaN(n)) problems.push({ code: 'bad_number', ar: `${label} ليس رقماً.` });
    else if (n != null && n < 0) problems.push({ code: 'bad_number', ar: `${label} سالب.` });
  }

  const rating = num(rec.rating);
  if (Number.isNaN(rating) || (rating != null && (rating < 0 || rating > 5))) {
    problems.push({ code: 'bad_number', ar: 'التقييم يجب أن يكون بين ٠ و٥.' });
  }

  for (const [field, label] of [['arrivedAt', 'وقت الوصول'], ['startedAt', 'وقت البدء'], ['completedAt', 'وقت الإكمال']]) {
    if (rec[field] && !isoDay(rec[field])) {
      problems.push({ code: 'bad_timestamp', ar: `${label} ليس تاريخاً صالحاً.` });
    }
  }
  return problems;
}

export { num as recordNumber, str as recordString };
