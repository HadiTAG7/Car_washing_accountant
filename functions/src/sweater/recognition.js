// ═══════════════════════════════════════════════════════════════════════════
// أهلية الاعتراف بالإيراد — «معتمد» ليست «نُفِّذت وأُغلقت»
// ═══════════════════════════════════════════════════════════════════════════
// أخطر افتراضٍ ممكن هنا أن `approved` تكفي. في المنصة هي تعني «الحجز معتمد» —
// أي أن العمل **سيُنفَّذ**، لا أنه نُفِّذ. والاعتراف بإيرادها يُثبت إيراداً
// لخدمةٍ لم تُقدَّم بعد، ثم يظهر الخطأ حين تُلغى.
//
// فالأهلية قرارٌ مستقل عن الحالة، مصدره **إعدادٌ مؤرخ** يقول أي الحالات
// تكفي — لأن سويتر قد تضيف حالة أو تعيد تعريف واحدة، والقاعدة حينها تتغيّر
// بتاريخ سريان لا بتعديل شيفرة.
//
// ── وثلاثة أجوبة لا اثنان ──
//   eligible      — تُحتسب
//   not_eligible  — مستبعدة بقاعدةٍ **مكتوبة** (ملغاة إدارياً مثلاً)
//   needs_review  — لا نعرف: حالةٌ مجهولة، أو معروفةٌ لم تصنّفها القاعدة، أو
//                   تغطيةٌ ناقصة. ولا إيراد لها حتى يقرّر إنسان.
// الجواب الثالث هو ما يمنع «الاستبعاد الصامت» — حالةٌ جديدة تسقط من الحساب
// بلا أن يلاحظ أحد أن الإيراد نقص.
// ═══════════════════════════════════════════════════════════════════════════

import { resolveDatedRow } from './datedConfig.js';
import { UNKNOWN_STATUS, isKnownBookingStatus } from './vocab.js';

export const RECOGNITION_POLICY_KEY = 'default';

/**
 * السياسة الابتدائية — تُزرع مرة ثم تُدار بتاريخ سريان.
 *
 * `payment_collection` مؤهّلة لأنها آخر مراحل الخدمة في المنصة: الغسيل تمّ
 * والتحصيل جارٍ. و`washing_started` **ليست** مؤهلة — العمل بدأ ولم ينتهِ،
 * والاعتراف عنده يُثبت إيراد خدمةٍ قد تُلغى في منتصفها.
 *
 * والملغى إدارياً مستبعدٌ **صراحةً** لا بالصمت، ليُفرَّق عن حالةٍ لم تُصنَّف.
 */
export const RECOGNITION_POLICY_SEED = Object.freeze({
  key: RECOGNITION_POLICY_KEY,
  eligibleStatuses: ['payment_collection'],
  excludedStatuses: ['admin_cancelled'],
  // حالاتٌ في الطريق: معروفة، وليست نهائية، فتُعرض للمراجعة لا تُحتسب.
  pendingStatuses: ['approved', 'on_the_way', 'arrived', 'washing_started'],
  requirePaymentRecorded: false,
  note: 'المرحلة النهائية في المنصة هي تحصيل الدفع — عندها تكون الخدمة نُفِّذت.',
});

/**
 * أهلية حجزٍ واحد.
 *
 * `booking` يحمل `normalizedStatus` و`rawStatus` و`paymentStatus`. القرار
 * يُرجع معه **سببه** دائماً — رقمٌ مستبعَد بلا سبب هو رقمٌ لا يُدافَع عنه في
 * مراجعة.
 */
export function recognitionFor(booking, policyRows, serviceDate) {
  const status = String(booking?.normalizedStatus ?? UNKNOWN_STATUS);

  if (status === UNKNOWN_STATUS || !isKnownBookingStatus(status)) {
    return {
      eligibility: 'needs_review',
      reasonCode: 'unknown_status',
      reasonAr: `حالة تشغيل غير معروفة: «${booking?.rawStatus ?? '—'}» — لا يُعترف بإيرادها حتى تُصنَّف.`,
    };
  }

  const hit = resolveDatedRow(policyRows, RECOGNITION_POLICY_KEY, serviceDate);
  if (!hit.known) {
    return {
      eligibility: 'needs_review',
      reasonCode: 'no_recognition_policy',
      reasonAr: hit.reason === 'before-baseline'
        ? `لا سياسة اعتراف سارية قبل ${hit.baselineFrom} — لا يُعترف بإيراد تاريخٍ لا قاعدة له.`
        : 'لا سياسة اعتراف معرَّفة لهذا التاريخ.',
    };
  }

  const policy = hit.row;
  const eligible = new Set(policy.eligibleStatuses || []);
  const excluded = new Set(policy.excludedStatuses || []);

  if (excluded.has(status)) {
    return {
      eligibility: 'not_eligible',
      reasonCode: 'excluded_status',
      reasonAr: `الحالة «${status}» مستبعدة بالسياسة السارية من ${hit.effectiveFrom}.`,
      policyFrom: hit.effectiveFrom,
    };
  }

  if (!eligible.has(status)) {
    // معروفةٌ لكنها ليست نهائية — تُعرض ولا تُحتسب ولا تُسقَط بصمت.
    return {
      eligibility: 'needs_review',
      reasonCode: 'not_final_status',
      reasonAr: `الحالة «${status}» ليست نهائية بعد — الخدمة لم تُغلق، فلا إيراد لها الآن.`,
      policyFrom: hit.effectiveFrom,
    };
  }

  if (policy.requirePaymentRecorded && String(booking?.paymentStatus) !== 'recorded') {
    return {
      eligibility: 'needs_review',
      reasonCode: 'payment_not_recorded',
      reasonAr: 'السياسة تشترط تسجيل الدفع، وحالة الدفع ليست «مسجل».',
      policyFrom: hit.effectiveFrom,
    };
  }

  return {
    eligibility: 'eligible',
    reasonCode: 'final_status',
    reasonAr: `الحالة «${status}» نهائية بالسياسة السارية من ${hit.effectiveFrom}.`,
    policyFrom: hit.effectiveFrom,
  };
}

/**
 * تغطية دفعة الاستيراد — استيرادٌ ناقص ليس استيراداً.
 *
 * الوكيل يقول ما جلبه ومن أي نطاق. صفحةٌ فُقدت تعني حجوزاتٍ غائبة، وإيراداً
 * ناقصاً في التسوية لا يشي بنفسه — فالنقص يُوسم على الدفعة كلها، ولا تُعتمد
 * تسويةُ شهرٍ تغطيتُه ناقصة إلا بقرارٍ صريح.
 */
export function coverageProblems(coverage) {
  const problems = [];
  const c = coverage || {};
  if (!c.rangeFrom || !c.rangeTo) problems.push('نطاق الاستخراج غير مذكور.');
  if (c.rangeFrom && c.rangeTo && String(c.rangeTo) < String(c.rangeFrom)) {
    problems.push('نهاية النطاق قبل بدايته.');
  }
  if (c.isComplete === false) problems.push('الوكيل أبلغ أن الاستخراج غير مكتمل.');
  const pages = Number(c.pageCount);
  const fetched = Number(c.pagesFetched ?? c.pageCount);
  if (Number.isFinite(pages) && Number.isFinite(fetched) && fetched < pages) {
    problems.push(`فُقدت ${pages - fetched} صفحة من ${pages}.`);
  }
  return problems;
}
