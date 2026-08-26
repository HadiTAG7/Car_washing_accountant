// ═══════════════════════════════════════════════════════════════════════════
// عقد السجل الواحد — الحدّ الفاصل بين الوكيل والمحاسبة
// ═══════════════════════════════════════════════════════════════════════════
// كل ما بعد هذا الملف لا يعرف من أين جاء السجل: وكيل متصفح اليوم، أو API
// رسمي غداً، أو ملفٌ يدوي في الطوارئ. الثلاثة تُنتج **هذا الشكل**، فاستبدال
// المصدر لا يمسّ خط المعالجة المحاسبي بسطر. هذا هو معنى «جاهزٌ للمستقبل».
//
// ── والتحقق مكتوبٌ باليد عمداً ──
// `zod` في اعتماديات الجذر لا في `functions/`، والخادم يُنشر وحده. ثم إن
// رسائل هذا الملف تُعرض للمستخدم بالعربية وتُخزَّن في نتيجة الاستيراد —
// و«Expected string, received number» ليست جملةً يقرؤها صاحب دفاتر.
//
// ── تقليل البيانات ليس تفضيلاً ──
// الوكيل يمرّ على شاشةٍ فيها أسماء عملاء وأرقامهم ومواقعهم. ولا شيء من ذلك
// يلزم لإثبات إيراد أو خصم. فما لا يُذكر هنا **يُرفض** ورودُه — والرفض صريح
// لا صامت، لأن ورودها أصلاً علامةُ وكيلٍ يجمع أكثر مما ينبغي.
// ═══════════════════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto';
import { round2 } from '../invariants.js';
import { forbiddenFieldsIn, normalizeBookingStatus, UNKNOWN_STATUS } from './vocab.js';
import { isoDay } from './datedConfig.js';

/** يُرفع حين يتغيّر شكل السجل بما يكسر القديم — ويُخزَّن على كل صفٍّ خام. */
export const SCHEMA_VERSION = 1;

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

/**
 * الشكل المطبَّع — رموزٌ ثابتة ومبالغ مدوَّرة وفراغاتٌ `null` لا `undefined`.
 *
 * `undefined` لا يُكتب في Firestore وقد يُحذف الحقل بصمت، فيختلف مستندٌ عن
 * آخر بلا سبب ظاهر، وتختلف بصمتاهما. `null` تُكتب وتُقارَن.
 */
export function normalizeRecord(rec) {
  const n = (v) => { const x = num(v); return x == null || Number.isNaN(x) ? null : round2(x); };
  const s = (v) => str(v) || null;

  return {
    sspBookingId: str(rec.sspBookingId),
    bookingKind: ['individual', 'corporate'].includes(str(rec.bookingKind))
      ? str(rec.bookingKind) : UNKNOWN_STATUS,
    serviceType: str(rec.serviceType),
    serviceTypeLabel: s(rec.serviceTypeLabel),
    serviceDate: isoDay(rec.serviceDate) || null,
    serviceTime: s(rec.serviceTime),

    driverName: s(rec.driverName),
    driverExternalId: s(rec.driverExternalId),
    companyNumber: s(rec.companyNumber),
    region: s(rec.region),
    branch: s(rec.branch),
    companyName: s(rec.companyName),

    vehiclePlate: s(rec.vehiclePlate),
    vehicleMake: s(rec.vehicleMake),
    vehicleModel: s(rec.vehicleModel),

    // الخام يُحفظ كما ورد، والمطبَّع بجواره. أحدهما للمطابقة والآخر للعرض
    // حين يقول المراجع «ما هذه الحالة؟» — فيرى ما رأته المنصة حرفياً.
    rawStatus: str(rec.rawStatus),
    normalizedStatus: normalizeBookingStatus(rec.rawStatus),
    rawPaymentStatus: s(rec.rawPaymentStatus),
    paymentStatus: ['pending', 'recorded'].includes(str(rec.rawPaymentStatus).toLowerCase())
      ? str(rec.rawPaymentStatus).toLowerCase() : UNKNOWN_STATUS,

    platformAmount: n(rec.platformAmount),
    customerDiscount: n(rec.customerDiscount),
    partnerOperationalDeduction: n(rec.partnerOperationalDeduction),
    compensationAmount: n(rec.compensationAmount),

    arrivedAt: s(rec.arrivedAt),
    startedAt: s(rec.startedAt),
    completedAt: s(rec.completedAt),

    rating: n(rec.rating),
    ticketRef: s(rec.ticketRef),
    violationRef: s(rec.violationRef),
    damageRef: s(rec.damageRef),
    sourceUrl: s(rec.sourceUrl),
    notes: s(rec.notes),
  };
}

/**
 * JSON مستقرّ الترتيب — البصمة يجب أن تعتمد على القيم لا على ترتيب المفاتيح.
 *
 * وكيلٌ يرسل نفس السجل بترتيب مفاتيح مختلف يجب أن يعطي البصمة نفسها، وإلا
 * صار كل استيرادٍ «تعديلاً» وأغرق المراجعة بفروقٍ وهمية.
 */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

/** بصمة السجل المطبَّع — تكشف التعديل المتأخر وتمنع إعادة المعالجة. */
export function hashRecord(normalized) {
  return createHash('sha256').update(canonicalJson(normalized)).digest('hex');
}

export function hashBody(body) {
  return createHash('sha256').update(canonicalJson(body)).digest('hex');
}
