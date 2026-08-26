// ═══════════════════════════════════════════════════════════════════════════
// التسوية الشهرية — تُحتسب آلياً، وتُعتمد مرة، وتُقفل بشرط
// ═══════════════════════════════════════════════════════════════════════════
// المعادلة كما في العقد:
//   الخدمات المكتملة والمعتمدة + الحوافز + التعويضات − الخصومات المعتمدة
//   = صافي المستحق المتوقع
// ثم يُقارَن بأربعة: كشف سويتر، والفاتورة الصادرة، والتحويل المستلم، وقيد
// دفتر الأستاذ. وأي فرقٍ يُسجَّل بسببه ومستنده لا يُبتلع في رقمٍ واحد.
//
// ── لماذا الاعتماد مرة شهرياً لا حجزاً حجزاً ──
// مراجعةُ ألف حجزٍ يدوياً ليست رقابة بل طقس: من يراجع الألف لا يراجع شيئاً.
// فالاستيراد والتطبيع والمطابقة والاحتساب آلية، ولا يُعرض على المدير إلا
// **الناقص والاستثنائي** — ثم قرارٌ واحد يعتمد الشهر كله.
//
// ── ولماذا ثلاثة قيود لا قيدٌ واحد ──
// الخدمات تُعتمد شهرياً، والخصومات تُعتمد كلٌّ بمستنده وقد يُعترض عليها بعد
// أسابيع، والتحصيل يصل في يومه. جمعُها في قيدٍ واحد يجعل عكسَ خصمٍ واحد
// عكساً للشهر كله. فلكلٍّ قفلُه ومصدرُه، ويُعكس وحده.
// ═══════════════════════════════════════════════════════════════════════════

import { round2 } from '../invariants.js';
import { ACC } from '../posting.js';
import { resolveServicePrice, sumSnapshots } from './pricing.js';
import { recognitionFor } from './recognition.js';
import { signOf } from './adjustmentTypes.js';
import { SETTLEMENT_STATUS } from './vocab.js';

export const SETTLEMENTS_COL = 'sweater_settlements';
export const ADJUSTMENTS_COL = 'sweater_adjustments';
export const VARIANCES_COL = 'sweater_variances';

export class SweaterSettlementError extends Error {
  constructor(message, { code = 'invalid-argument' } = {}) {
    super(message);
    this.name = 'SweaterSettlementError';
    this.code = code;
  }
}

/**
 * الانتقالات المسموحة.
 *
 * آلة حالاتٍ صريحة لأن «معتمدة ⇐ مسودة» أو «مقفلة ⇐ أي شيء» يجب أن تكون
 * مستحيلةً لا مستهجَنة. والرجوع إلى `under_review` مسموحٌ من الاعتماد وما
 * قبله — لأن اكتشاف خطأ بعد الاعتماد وارد، والطريق إليه يجب أن يكون معلوماً.
 */
export const SETTLEMENT_TRANSITIONS = Object.freeze({
  draft:               ['calculated'],
  calculated:          ['statement_received', 'under_review', 'calculated'],
  statement_received:  ['under_review', 'disputed', 'approved'],
  under_review:        ['disputed', 'approved', 'calculated'],
  disputed:            ['under_review', 'approved'],
  approved:            ['invoiced', 'under_review'],
  invoiced:            ['partially_collected', 'collected', 'under_review'],
  partially_collected: ['partially_collected', 'collected'],
  collected:           ['closed'],
  closed:              [],
});

export function transitionProblem(from, to) {
  if (!SETTLEMENT_STATUS.includes(to)) return `حالة غير معروفة: ${to}`;
  const allowed = SETTLEMENT_TRANSITIONS[from] ?? null;
  if (!allowed) return `حالة حالية غير معروفة: ${from}`;
  if (from === 'closed') return 'التسوية مقفلة — لا تتغيّر حالتها. التصحيح بقيدٍ في فترة مفتوحة.';
  if (!allowed.includes(to)) {
    return `لا يُنتقل من «${from}» إلى «${to}» مباشرةً. المسموح: ${allowed.join('، ') || 'لا شيء'}.`;
  }
  return null;
}

/**
 * احتساب الشهر — قراءةٌ محضة تُرجع الأرقام وأسبابها.
 *
 * لا تكتب شيئاً ولا تُنشئ قيداً. تُستدعى في المعاينة وفي الاحتساب المخزَّن،
 * فالرقمان لا يختلفان أبداً — وهو ما يجعل «لماذا تغيّر المبلغ بعد الاعتماد؟»
 * سؤالاً لا يُطرح.
 */
export function computeSettlement({
  bookings = [], priceRows = [], policyRows = [], adjustments = [], linkedBookingIds = new Set(),
}) {
  const eligible = [];
  const excluded = [];
  const review = [];
  const cancelled = [];
  const unknown = [];

  for (const b of bookings) {
    const rec = b.record ?? b;
    const serviceDate = rec.serviceDate;

    // حجزٌ سبق أن رُحِّل عبر غسلته القديمة لا يُرحَّل ثانيةً — الطبقة الرابعة
    // من منع الازدواج، وهي التي تلتقط ما قبل تاريخ التشغيل.
    if (linkedBookingIds.has(rec.sspBookingId)) {
      excluded.push({ sspBookingId: rec.sspBookingId, reasonCode: 'already_posted_via_wash',
        reasonAr: 'رُحِّل إيراده سابقاً عبر غسلته المحلية — لا يُحتسب مرة ثانية.' });
      continue;
    }

    const verdict = recognitionFor(rec, policyRows, serviceDate);
    if (verdict.eligibility === 'not_eligible') {
      (rec.normalizedStatus === 'admin_cancelled' ? cancelled : excluded)
        .push({ sspBookingId: rec.sspBookingId, ...verdict });
      continue;
    }
    if (verdict.eligibility === 'needs_review') {
      (verdict.reasonCode === 'unknown_status' ? unknown : review)
        .push({ sspBookingId: rec.sspBookingId, ...verdict });
      continue;
    }

    const price = resolveServicePrice(priceRows, rec.serviceType, serviceDate);
    if (!price.known) {
      review.push({
        sspBookingId: rec.sspBookingId,
        eligibility: 'needs_review',
        reasonCode: price.reason === 'no-rows' ? 'unknown_service_type' : 'no_price_for_date',
        reasonAr: price.reason === 'before-baseline'
          ? `لا سعر تعاقدي ساري قبل ${price.baselineFrom} لخدمة «${rec.serviceType}».`
          : `لا سعر تعاقدي لخدمة «${rec.serviceType}» في ${serviceDate}.`,
      });
      continue;
    }

    eligible.push({
      sspBookingId: rec.sspBookingId,
      serviceType: rec.serviceType,
      serviceDate,
      driverName: rec.driverName ?? null,
      region: rec.region ?? null,
      // مبلغ المنصة وخصم العميل يُحفظان للتقرير — ولا يدخلان الحساب.
      platformAmount: rec.platformAmount ?? null,
      customerDiscount: rec.customerDiscount ?? null,
      priceSnapshot: price.snapshot,
    });
  }

  const services = sumSnapshots(eligible.map((e) => e.priceSnapshot));

  // التسويات: المعتمدة وحدها تدخل الحساب. المستوردة تُعرض ولا تُطرح.
  const approved = adjustments.filter((a) => a.approvalStatus === 'approved');
  const pending = adjustments.filter((a) => a.approvalStatus !== 'approved');

  const bucket = (kind) => approved.filter((a) => a.kind === kind)
    .reduce((s, a) => s + (Number(a.amount) || 0), 0);
  const deductions = round2(bucket('deduction'));
  const incentives = round2(bucket('incentive'));
  const compensations = round2(bucket('compensation'));

  const netDue = round2(services.gross + incentives + compensations - deductions);

  return {
    counts: {
      imported: bookings.length,
      eligible: eligible.length,
      excluded: excluded.length,
      cancelled: cancelled.length,
      needsReview: review.length,
      unknownStatus: unknown.length,
    },
    services: { net: services.net, vat: services.vat, gross: services.gross, count: services.count },
    deductions, incentives, compensations,
    netDue,
    pendingAdjustments: pending.length,
    pendingAdjustmentsTotal: round2(pending.reduce(
      (s, a) => s + signOf(a.kind) * (Number(a.amount) || 0), 0,
    )),
    lines: { eligible, excluded, cancelled, review, unknown },
  };
}

/**
 * قيد اعتماد خدمات الشهر.
 *
 * مدين ذمم سويتر بالإجمالي، دائن إيراد سويتر بالصافي، دائن ضريبة المخرجات.
 * والضريبة سطرٌ مستقل يُدفع فقط حين تكون موجبة — فخدمةٌ غير خاضعة تُنتج
 * قيداً من سطرين بلا صفٍّ ضريبي كاذب.
 */
export function buildRecognitionEntry(periodKey, figures, { entryDate }) {
  const { net, vat, gross } = figures.services;
  if (gross <= 0) {
    throw new SweaterSettlementError('لا خدمات مؤهّلة في هذا الشهر — لا شيء يُرحَّل.');
  }
  const lines = [
    { accountId: ACC.SWEATER_RECEIVABLE, debit: gross, credit: 0, description: 'ذمم منصة سويتر' },
    { accountId: ACC.SWEATER_REVENUE, debit: 0, credit: net, description: `إيراد خدمات سويتر — ${periodKey}` },
  ];
  if (vat > 0) {
    lines.push({ accountId: ACC.OUTPUT_VAT, debit: 0, credit: vat, description: 'ضريبة مخرجات' });
  }
  return {
    entry: {
      entryDate,
      sourceType: 'sweater_settlement',
      sourceId: periodKey,
      description: `اعتماد خدمات سويتر — ${periodKey} (${figures.services.count} خدمة)`,
    },
    lines,
  };
}

/**
 * قيد تسويةٍ واحدة — خصم أو حافز أو تعويض.
 *
 * الاتجاه من `kind` لا من إشارة المبلغ (المبالغ كلها موجبة)، والحساب من
 * **إعداد النوع** لا من ثابتٍ هنا — فالمواصفة تمنع دفع كل خصمٍ إلى مردودات
 * المبيعات تلقائياً، والتصنيف قرارٌ محاسبي يُكتب في الإعداد ويُدافَع عنه.
 */
export function buildAdjustmentEntry(adjustment, { entryDate, accountCode }) {
  const amount = round2(Math.abs(Number(adjustment?.amount) || 0));
  if (amount <= 0) throw new SweaterSettlementError('مبلغ التسوية يجب أن يكون موجباً.');
  if (!accountCode) throw new SweaterSettlementError('حساب نوع التسوية غير محدَّد في إعداده.');

  const isDeduction = adjustment.kind === 'deduction';
  const label = `${adjustment.nameArabic ?? adjustment.typeKey} — سويتر`
    + (adjustment.sspBookingId ? ` (حجز ${adjustment.sspBookingId})` : '');

  const lines = isDeduction
    ? [
      { accountId: accountCode, debit: amount, credit: 0, description: label },
      { accountId: ACC.SWEATER_RECEIVABLE, debit: 0, credit: amount, description: 'تخفيض ذمم سويتر' },
    ]
    : [
      { accountId: ACC.SWEATER_RECEIVABLE, debit: amount, credit: 0, description: 'ذمم منصة سويتر' },
      { accountId: accountCode, debit: 0, credit: amount, description: label },
    ];

  return {
    entry: {
      entryDate,
      sourceType: 'sweater_adjustment',
      sourceId: String(adjustment.id),
      description: label,
    },
    lines,
  };
}

/**
 * قيد التحصيل — بنكٌ مدين وذمم سويتر دائنة.
 *
 * ولا صندوق افتراضاً: تحويلٌ من منصةٍ يصل حساباً بنكياً، ووضعُه في الصندوق
 * يجعل الجرد النقدي يكذب. فالحساب يُذكر صراحةً ويُتحقَّق أنه بنكيّ.
 */
export function buildCollectionEntry(collection, { entryDate }) {
  const amount = round2(Number(collection?.amount) || 0);
  if (amount <= 0) throw new SweaterSettlementError('مبلغ التحصيل يجب أن يكون موجباً.');
  const bank = String(collection?.bankAccountId || ACC.BANK);
  if (bank === ACC.CASH) {
    throw new SweaterSettlementError('تحصيل سويتر تحويلٌ بنكي — لا يُسجَّل في الصندوق.');
  }
  return {
    entry: {
      entryDate,
      sourceType: 'sweater_collection',
      sourceId: String(collection.id),
      description: `تحصيل من سويتر — ${collection.periodKey ?? ''}`.trim(),
    },
    lines: [
      { accountId: bank, debit: amount, credit: 0, description: 'تحويل وارد من سويتر' },
      { accountId: ACC.SWEATER_RECEIVABLE, debit: 0, credit: amount, description: 'سداد ذمم سويتر' },
    ],
  };
}

/**
 * هل تُقفل التسوية؟
 *
 * فرقٌ غير محلول يمنع الإقفال — إلا للمدير بسببٍ إلزامي. والسبب ليس شكلياً:
 * تسويةٌ أُقفلت على فرقٍ لم يُفسَّر تصير رقماً لا يُدافَع عنه بعد سنة، ومن
 * أقفلها يجب أن يكون قد كتب لماذا.
 */
export function closeProblems(settlement, variances = [], { role = 'accountant', reason = null } = {}) {
  const problems = [];
  const t = transitionProblem(settlement?.status, 'closed');
  if (t) problems.push(t);

  const unresolved = variances.filter((v) => v.resolution === 'unresolved');
  if (unresolved.length) {
    if (role !== 'admin') {
      problems.push(
        `${unresolved.length} فرقٌ غير محلول — لا تُقفل التسوية إلا بقرار المدير مع سبب.`,
      );
    } else if (!String(reason ?? '').trim()) {
      problems.push('إقفال تسويةٍ بفروقٍ غير محلولة يتطلّب سبباً مكتوباً يبقى في التدقيق.');
    }
  }
  return problems;
}

/** الفرق بين المتوقع وكشف سويتر — يُسجَّل ولا يُبتلع. */
export function varianceOf(expected, stated) {
  const e = round2(Number(expected) || 0);
  const s = round2(Number(stated) || 0);
  return { expected: e, stated: s, difference: round2(s - e), matches: Math.abs(s - e) < 0.01 };
}
