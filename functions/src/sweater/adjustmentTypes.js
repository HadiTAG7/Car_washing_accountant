// ═══════════════════════════════════════════════════════════════════════════
// أنواع الخصومات والحوافز — بياناتٌ مؤرخة، لا ثوابت مدفونة
// ═══════════════════════════════════════════════════════════════════════════
// «٥٠ ريال للتوثيق الخاطئ» و«أكثر من ١٠ دقائق تأخّر» و«ريال لكل طلب مكتمل»
// و«هدر يتجاوز ١٥٪» — كلها أرقامٌ من دليل سويتر **اليوم**. وسويتر تُعدّلها
// بإشعار. فرقمٌ مكتوبٌ في `if` يعني أن تغييراً تعاقدياً يصير إصدار برنامج،
// والأسوأ: يعيد حساب أشهرٍ مضت بقاعدةٍ لم تكن سارية فيها.
//
// فكل نوعٍ صفٌّ في `sweater_adjustment_types` بتاريخ سريان، وكل تسويةٍ فعلية
// تحمل **لقطة** من الصفّ الذي حكمها.
//
// ── ولا ترحيل بمجرد الاستيراد ──
// المواصفة صريحة: «لا ترحّل مخالفة أو ضررًا أو خصمًا لمجرد استيراده». فكل
// تسوية تولد `pending_review`، ولا تصل الدفاتر إلا باعتمادٍ صريح ومستندٍ أو
// سببٍ موثّق. استيرادُ رقمٍ ليس إقراراً به.
// ═══════════════════════════════════════════════════════════════════════════

import { datedRowProblems } from './datedConfig.js';
import { ADJUSTMENT_KIND } from './vocab.js';

/** كيف يُحدَّد المبلغ. `manual` تعني: المنصة تقوله ونحن نراجعه. */
export const AMOUNT_MODES = Object.freeze(['fixed', 'from_platform', 'per_unit', 'percentage']);

/**
 * الأنواع التسعة من الدليل، ومعها الحافز.
 *
 * `accountCode` على كل نوع — لأن المواصفة تمنع دفع كل خصمٍ إلى «مردودات
 * المبيعات» تلقائياً. الافتراض `4020` (خصومات سويتر التشغيلية، حسابٌ مقابل)،
 * والضرر والمخالفة قد يُصنَّفان مصروفاً حين يقرّر المحاسب ذلك — فالحقل بيان.
 *
 * `requiresDocument` يعني: لا اعتماد بلا مستند. الضرر والمخالفة والشكوى
 * أرقامٌ يُعترض عليها، ومن لا مستند له لا يُدافع عن اعتراضه.
 */
export const ADJUSTMENT_TYPE_SEED = Object.freeze([
  { key: 'booking_cancellation', kind: 'deduction', nameArabic: 'إلغاء الحجز',
    accountCode: '4020', amountMode: 'from_platform', requiresDocument: false,
    bearer: 'partner' },

  { key: 'lateness', kind: 'deduction', nameArabic: 'التأخر',
    accountCode: '4020', amountMode: 'from_platform', requiresDocument: false,
    bearer: 'partner',
    params: { graceMinutes: 10 },
    note: 'يبدأ بعد أكثر من ١٠ دقائق حسب الدليل الحالي.' },

  { key: 'wrong_vehicle_documentation', kind: 'deduction', nameArabic: 'التوثيق الخاطئ للمركبة',
    accountCode: '4020', amountMode: 'fixed', amount: 50, requiresDocument: true,
    bearer: 'partner' },

  { key: 'low_rating', kind: 'deduction', nameArabic: 'انخفاض التقييم',
    accountCode: '4020', amountMode: 'from_platform', requiresDocument: false,
    bearer: 'partner',
    params: { minRating: 4 },
    note: 'التقييم الأقل من ٤ نجوم قد يُنتج خصماً.' },

  { key: 'proven_complaint_no_compensation', kind: 'deduction', nameArabic: 'شكوى مثبتة بلا تعويض',
    accountCode: '4020', amountMode: 'from_platform', requiresDocument: true,
    bearer: 'partner' },

  { key: 'customer_compensation', kind: 'deduction', nameArabic: 'تعويض العميل',
    accountCode: '4020', amountMode: 'from_platform', requiresDocument: true,
    bearer: 'partner',
    note: 'قد يحمل قيمة التعويض مع رسوم إضافية.' },

  { key: 'operational_or_traffic_violation', kind: 'deduction', nameArabic: 'مخالفة تشغيلية أو مرورية',
    accountCode: '4020', amountMode: 'from_platform', requiresDocument: true,
    bearer: 'driver' },

  { key: 'proven_damage', kind: 'deduction', nameArabic: 'ضرر مثبت',
    accountCode: '4020', amountMode: 'from_platform', requiresDocument: true,
    bearer: 'partner' },

  { key: 'material_waste_over_allowance', kind: 'deduction', nameArabic: 'هدر مواد يتجاوز المسموح',
    accountCode: '4020', amountMode: 'percentage', requiresDocument: true,
    bearer: 'partner',
    params: { allowancePct: 0.15 },
    note: 'تُحمَّل المواد على الشريك عند تجاوز الهدر ١٥٪.' },

  { key: 'completed_order_incentive', kind: 'incentive', nameArabic: 'حافز الطلب المكتمل',
    accountCode: '4110', amountMode: 'per_unit', amount: 1, requiresDocument: false,
    bearer: 'platform',
    note: 'ريال واحد لكل طلب مكتمل عند استيفاء المؤشرات، حسب الدليل الحالي.' },

  { key: 'partner_compensation', kind: 'compensation', nameArabic: 'تعويض مستحق للشريك',
    accountCode: '4110', amountMode: 'from_platform', requiresDocument: true,
    bearer: 'platform' },
]);

/** الجهة المتحمّلة — من يقع عليه الخصم في النهاية. */
export const BEARERS = Object.freeze(['partner', 'driver', 'platform', 'customer']);

export function adjustmentTypeProblems(row) {
  const problems = datedRowProblems(row, { keyField: 'key', keyLabel: 'رمز النوع' });
  if (!ADJUSTMENT_KIND.includes(row?.kind)) {
    problems.push(`نوع التسوية غير صالح: ${row?.kind ?? '—'}`);
  }
  if (!String(row?.nameArabic ?? '').trim()) problems.push('الاسم العربي مطلوب.');
  if (!AMOUNT_MODES.includes(row?.amountMode)) {
    problems.push(`طريقة تحديد المبلغ غير صالحة: ${row?.amountMode ?? '—'}`);
  }
  if (!/^\d{4}(-.+)?$/.test(String(row?.accountCode ?? ''))) {
    problems.push('رقم الحساب مطلوب بصيغة صحيحة.');
  }
  if (row?.bearer && !BEARERS.includes(row.bearer)) {
    problems.push(`الجهة المتحمّلة غير صالحة: ${row.bearer}`);
  }
  if (['fixed', 'per_unit'].includes(row?.amountMode)) {
    const amt = Number(row?.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      problems.push('المبلغ مطلوب وموجب لهذه الطريقة.');
    }
  }
  return problems;
}

/**
 * أثر التسوية على المستحق: `-1` تنقص و`+1` تزيد.
 *
 * تُقرأ من `kind` لا من إشارة المبلغ. مبلغٌ سالب في خصم ومبلغٌ موجب في حافز
 * يعنيان الشيء نفسه لو تُرك الأمر للإشارة، ويصير جمعُ الشهر مسألةَ حظّ.
 * فالمبالغ كلها **موجبة**، والاتجاه من النوع.
 */
export function signOf(kind) {
  return kind === 'deduction' ? -1 : 1;
}
