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
import { normalizeBookingStatus, UNKNOWN_STATUS } from './vocab.js';
import { isoDay } from './datedConfig.js';

/** يُرفع حين يتغيّر شكل السجل بما يكسر القديم — ويُخزَّن على كل صفٍّ خام. */
export const SCHEMA_VERSION = 1;

export { ALLOWED_RECORD_FIELDS, recordProblems } from './recordContract.js';
import { recordNumber as num, recordString as str } from './recordContract.js';

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
