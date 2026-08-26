// ═══════════════════════════════════════════════════════════════════════════
// عربية سويتر — للعرض وحده، ولا تُخزَّن ولا تُقارَن
// ═══════════════════════════════════════════════════════════════════════════
// الرموز في `functions/src/sweater/vocab.js` هي المخزَّنة والمقارَنة؛ هذه
// أسماؤها على الشاشة. والفصل مقصود: لو خُزِّن العربي لصار تحسينُ صياغةٍ في
// هذا الملف تعديلاً في الدفاتر، ولانكسرت كل مطابقةٍ بُنيت على النص.
//
// ويقفلهما اختبار `sweaterLabels.test.js`: **كل رمزٍ خادمي له اسمٌ هنا، ولا
// اسم هنا بلا رمز**. فرمزٌ جديد بلا ترجمة يسقط الاختبار بدل أن يظهر للمستخدم
// إنجليزياً في شاشةٍ عربية.
// ═══════════════════════════════════════════════════════════════════════════

export const BOOKING_STATUS_AR = Object.freeze({
  approved:           'معتمدة',
  on_the_way:         'في الطريق',
  arrived:            'وصل',
  washing_started:    'بدأ الغسيل',
  payment_collection: 'تحصيل الدفع',
  admin_cancelled:    'ألغيت من المسؤول',
  unknown:            'حالة غير معروفة',
});

export const PAYMENT_STATUS_AR = Object.freeze({
  pending:  'معلق',
  recorded: 'مسجل',
  unknown:  'غير معروفة',
});

export const BOOKING_KIND_AR = Object.freeze({
  individual: 'أفراد',
  corporate:  'شركات',
  unknown:    'غير محدد',
});

export const RECOGNITION_ELIGIBILITY_AR = Object.freeze({
  eligible:     'مؤهّلة للاحتساب',
  not_eligible: 'مستبعدة',
  needs_review: 'تحتاج مراجعة',
});

export const PROCESSING_STATUS_AR = Object.freeze({
  fetched:           'مُستلَمة',
  normalized:        'مُطبَّعة',
  validated:         'مُتحقَّق منها',
  duplicate_checked: 'فُحص تكرارها',
  matched:           'مُطابَقة',
  ready_for_posting: 'جاهزة للترحيل',
  posted:            'مُرحَّلة',
  needs_review:      'تحتاج مراجعة',
});

export const SETTLEMENT_STATUS_AR = Object.freeze({
  draft:               'مسودة',
  calculated:          'محتسبة',
  statement_received:  'وصل الكشف',
  under_review:        'قيد المراجعة',
  disputed:            'معترَض عليها',
  approved:            'معتمدة',
  invoiced:            'صدرت فاتورتها',
  partially_collected: 'محصَّلة جزئياً',
  collected:           'محصَّلة',
  closed:              'مقفلة',
});

export const AGENT_STATUS_AR = Object.freeze({
  ok:              'يعمل',
  session_expired: 'انتهت جلسة المنصة',
  otp_required:    'المنصة تطلب رمز تحقق',
  blocked:         'الوكيل متوقف',
  partial:         'استخراج ناقص',
});

export const ADJUSTMENT_KIND_AR = Object.freeze({
  deduction:    'خصم',
  incentive:    'حافز',
  compensation: 'تعويض',
});

export const ADJUSTMENT_APPROVAL_AR = Object.freeze({
  pending_review: 'بانتظار المراجعة',
  approved:       'معتمد',
  rejected:       'مرفوض',
  disputed:       'معترَض عليه',
});

export const BEARER_AR = Object.freeze({
  partner:  'الشريك',
  driver:   'السائق',
  platform: 'المنصة',
  customer: 'العميل',
});

export const REVIEW_REASON_AR = Object.freeze({
  unknown_status:         'حالة تشغيل غير معروفة',
  unknown_service_type:   'نوع خدمة غير معروف',
  no_price_for_date:      'لا سعر تعاقدي ساري لهذا التاريخ',
  no_tax_policy_for_date: 'لا سياسة ضريبية معروفة لهذا التاريخ',
  missing_service_date:   'تاريخ الخدمة ناقص',
  missing_booking_id:     'رقم الحجز ناقص',
  amount_mismatch:        'المبلغ لا يطابق العقد',
  incomplete_coverage:    'تغطية الاستخراج ناقصة',
  modified_after_posting: 'تعديل بعد الترحيل',
  duplicate_conflict:     'تعارض تكرار',
  forbidden_field:        'حقل ممنوع من الوكيل',
});

/** ترجمةٌ آمنة: رمزٌ بلا اسم يُعرض كما هو بدل أن يختفي السطر. */
export function labelOf(dict, code, fallback = null) {
  const key = String(code ?? '');
  return dict[key] ?? fallback ?? key ?? '—';
}
