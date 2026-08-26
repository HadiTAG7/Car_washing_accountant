// ═══════════════════════════════════════════════════════════════════════════
// مفردات سويتر — رموزٌ إنجليزية ثابتة، والعربية للعرض وحده
// ═══════════════════════════════════════════════════════════════════════════
// الاسم العربي لا يُخزَّن ولا يُقارَن: المنصة قد تعيد صياغته («ألغيت من
// المسؤول» ⇐ «ملغى إدارياً») فتنكسر كل مطابقةٍ بُنيت عليه، ويصير تغييرُ نصٍّ
// في شاشةٍ بعيدة تغييراً في الدفاتر. فالمخزَّن رمزٌ، والعربية في
// `src/lib/sweater/labels.js` يقفلها اختبار انجراف.
//
// ── والقائمة مفتوحة عمداً ──
// المواصفة تقول «لا تفترض أن هذه القائمة نهائية». فحالةٌ لا نعرفها **لا
// تُسقَط ولا تُخمَّن**: تُحفظ كما وردت في `rawStatus`، ويصير
// `normalizedStatus = 'unknown'`، ويذهب الصف إلى المراجعة برمز سبب. حجزٌ
// مجهول الحالة أفضل من حجزٍ صُنِّف بالحدس.
// ═══════════════════════════════════════════════════════════════════════════

/** حالات التشغيل التي شوهدت في المنصة. `unknown` ليس منها — هو ما نضعه نحن. */
export const BOOKING_STATUS = Object.freeze([
  'approved',
  'on_the_way',
  'arrived',
  'washing_started',
  'payment_collection',
  'admin_cancelled',
]);

export const UNKNOWN_STATUS = 'unknown';

/** حالات الدفع الظاهرة في المنصة. */
export const PAYMENT_STATUS = Object.freeze(['pending', 'recorded', UNKNOWN_STATUS]);

export const BOOKING_KIND = Object.freeze(['individual', 'corporate', UNKNOWN_STATUS]);

/**
 * أهلية الاعتراف بالإيراد — **ليست** حالة التشغيل.
 *
 * `approved` في المنصة تعني «الحجز معتمد»، لا «الخدمة نُفّذت وأُغلقت». فالخلط
 * بينهما يُثبت إيراداً لخدمةٍ لم تُقدَّم. لذلك الأهلية حقلٌ مستقل، مصدره
 * إعدادٌ مؤرخ (`sweater_recognition_policy`) لا ثابتٌ هنا.
 */
export const RECOGNITION_ELIGIBILITY = Object.freeze([
  'eligible',      // مؤهّلة للاعتراف بالإيراد
  'not_eligible',  // مستبعدة بقاعدة معروفة (ملغاة مثلاً)
  'needs_review',  // لا نعرف — لا إيراد، ويُعرض للمراجعة
]);

/** مراحل معالجة الصف الخام. */
export const PROCESSING_STATUS = Object.freeze([
  'fetched', 'normalized', 'validated', 'duplicate_checked',
  'matched', 'ready_for_posting', 'posted', 'needs_review',
]);

/** حالات التسوية الشهرية. */
export const SETTLEMENT_STATUS = Object.freeze([
  'draft', 'calculated', 'statement_received', 'under_review', 'disputed',
  'approved', 'invoiced', 'partially_collected', 'collected', 'closed',
]);

/** حال وكيل المتصفح. `otp_required` توقّفٌ آمن لا محاولة تجاوز. */
export const AGENT_STATUS = Object.freeze([
  'ok', 'session_expired', 'otp_required', 'blocked', 'partial',
]);

/** أنواع التسويات على المستحق. */
export const ADJUSTMENT_KIND = Object.freeze(['deduction', 'incentive', 'compensation']);

/** مسار اعتماد كل تسوية — لا ترحيل قبل `approved`. */
export const ADJUSTMENT_APPROVAL = Object.freeze([
  'pending_review', 'approved', 'rejected', 'disputed',
]);

/** رموز أسباب المراجعة — تُترجَم في الواجهة، وتُبحَث في السجلّات. */
export const REVIEW_REASON = Object.freeze([
  'unknown_status',
  'unknown_service_type',
  'no_price_for_date',
  'no_tax_policy_for_date',
  'missing_service_date',
  'missing_booking_id',
  'amount_mismatch',
  'incomplete_coverage',
  'modified_after_posting',
  'duplicate_conflict',
  'forbidden_field',
]);

const asSet = (arr) => new Set(arr);
const STATUS_SET = asSet(BOOKING_STATUS);

/** رمزٌ معروف؟ — وإلا `unknown`، ولا تخمين. */
export function normalizeBookingStatus(raw) {
  const code = String(raw ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return STATUS_SET.has(code) ? code : UNKNOWN_STATUS;
}

export function isKnownBookingStatus(code) {
  return STATUS_SET.has(String(code ?? ''));
}

/**
 * الحقول التي **يُرفض** ورودها من الوكيل.
 *
 * رفضٌ صريح لا تجاهل: وكيلٌ أرسل `netAmount` وتلقّى «تمّ» يظن أن رقمه اعتُمد،
 * والحقيقة أن الخادم حسب غيره. والأخطر أن ورودها أصلاً علامةُ وكيلٍ يحاول
 * أن يقرّر ما ليس له — فيُقال له ذلك بصوتٍ مسموع.
 */
export const FORBIDDEN_AGENT_FIELDS = Object.freeze([
  // قرارات مالية ليست للوكيل
  'netAmount', 'vatAmount', 'grossAmount', 'vatRate', 'netRate', 'grossRate',
  'accountId', 'accountCode', 'journalEntry', 'lines', 'entry',
  'recognitionEligibility', 'approvalStatus', 'settlementId', 'postedAt',
  // أسرارٌ لا تُخزَّن أبداً
  'password', 'otp', 'cookie', 'cookies', 'authorization', 'session',
  'sessionId', 'token', 'accessToken', 'refreshToken', 'setCookie',
  // بيانات شخصية لا حاجة محاسبية لها
  'customerName', 'customerPhone', 'customerEmail', 'customerAddress',
  'latitude', 'longitude', 'gpsLat', 'gpsLng',
]);

const FORBIDDEN_LOWER = asSet(FORBIDDEN_AGENT_FIELDS.map((f) => f.toLowerCase()));

/** يُرجع أسماء الحقول الممنوعة الموجودة فعلاً — فارغةٌ تعني نظيفاً. */
export function forbiddenFieldsIn(obj) {
  if (!obj || typeof obj !== 'object') return [];
  return Object.keys(obj).filter((k) => FORBIDDEN_LOWER.has(k.toLowerCase()));
}
