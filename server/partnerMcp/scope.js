// ═══════════════════════════════════════════════════════════════════════════
// الحدّ — حصّةُ الشريك وحدها، بلا أسماءٍ ولا شركاءٍ آخرين
// ═══════════════════════════════════════════════════════════════════════════
// دوالٌ نقيّة: لا Firestore ولا شبكة، فتُختبر بمصفوفات. وهي طبقتان:
//
//   • **القسمة** — `factor = عمالته ÷ مجموع العمالة`، نفس السطر الذي تحسبه
//     الواجهة في `PartnerViewContext`. مئة غسلة ونسبته ١٠٪ = عشر غسلات تعادل
//     حصّته؛ وهذا ما طُلب حرفياً.
//   • **المصفاة** — `assertScoped` تمشي على كل ما سيُرسَل وترمي عند أول مفتاح
//     ممنوع. ليست بديلاً عن عدم جلب الاسم أصلاً (`data.js` لا يقرأ
//     `biker_name` من الأساس) بل الحارس الأخير: أداةٌ جديدة تنسى تُسقِطها
//     المصفاة بدل أن تُسرِّب.
// ═══════════════════════════════════════════════════════════════════════════

import { round2 } from '../../src/lib/accounting/journal.js';
import { PER_WORKER_FEE } from '../../src/data/initialData.js';

export class PartnerMcpScopeError extends Error {
  constructor(key, path) {
    super(`حقلٌ خارج حدود الشريك تسرّب إلى الردّ: «${key}» في ${path || 'الجذر'}.`);
    this.name = 'PartnerMcpScopeError';
    this.key = key;
    this.path = path;
  }
}

/**
 * ما لا يجوز أن يظهر في ردٍّ للشريك مهما كانت الأداة.
 *
 * أسماء البايكرز وأرقامهم، ومعرّفات الحسابات، وأرقام التواصل، وكل ما يخصّ
 * شريكاً آخر أو المفتاح نفسه.
 */
export const FORBIDDEN_KEYS = new Set([
  'bikerName', 'biker_name', 'bikerId', 'biker_id',
  'userId', 'user_id', 'ownerUid', 'tokenHash', 'token',
  'contactNumber', 'contact_number', 'email', 'phone',
  'partners', 'paidAmount', 'paid_amount',
  'iqama_number', 'iqamaNumber', 'salary',
]);

export function assertScoped(payload, path = '') {
  if (Array.isArray(payload)) {
    payload.forEach((v, i) => assertScoped(v, `${path}[${i}]`));
    return payload;
  }
  if (payload && typeof payload === 'object') {
    for (const [k, v] of Object.entries(payload)) {
      if (FORBIDDEN_KEYS.has(k)) throw new PartnerMcpScopeError(k, path);
      assertScoped(v, path ? `${path}.${k}` : k);
    }
  }
  return payload;
}

// ─── القسمة ──────────────────────────────────────────────────────────────

/**
 * نسبة الشريك من مجموع العمالة — نفس حساب `PartnerViewContext.jsx`.
 *
 * `totalWorkers = 0` يعطي صفراً لا قسمةً على صفر، و`hasShare` يقول للأداة أن
 * تشرح «لم تُسجَّل لك عمالة» بدل أن تعرض أصفاراً بلا تفسير.
 */
export function shareOf(partners, partnerId) {
  const list = Array.isArray(partners) ? partners : [];
  const totalWorkers = list.reduce((s, p) => s + (Number(p.workersCount ?? p.workers_count) || 0), 0);
  const me = list.find((p) => String(p.id) === String(partnerId));
  const workersCount = Number(me?.workersCount ?? me?.workers_count) || 0;
  const factor = totalWorkers > 0 ? workersCount / totalWorkers : 0;
  return {
    workersCount,
    totalWorkers,
    factor,
    sharePercent: round2(factor * 100),
    hasShare: workersCount > 0 && totalWorkers > 0,
  };
}

export const scaleMoney = (n, factor) => round2((Number(n) || 0) * (Number(factor) || 0));

/** عدٌّ مقسوم — بمنزلةٍ عشرية واحدة: «١٢٫٥ غسلة» أصدق من تقريبها. */
export const scaleCount = (n, factor) => Math.round((Number(n) || 0) * (Number(factor) || 0) * 10) / 10;

const NUM = new Intl.NumberFormat('ar-SA', { numberingSystem: 'latn', maximumFractionDigits: 1 });
export const fmtNum = (n) => NUM.format(Number(n) || 0);

/** «10 من أصل 100 غسلة تعادل حصّتك». */
export function shareLine(shareCount, companyCount, unit = 'غسلة') {
  return `${fmtNum(shareCount)} من أصل ${fmtNum(companyCount)} ${unit} تعادل حصّتك`;
}

// ─── رأس المال ───────────────────────────────────────────────────────────

export const METHOD_LABEL = {
  bank_transfer: 'تحويل بنكي',
  cash:          'نقدي',
  mada_pos:      'مدى / شبكة',
};

/**
 * رأس ماله: المطلوب والمسدَّد والمتبقّي — من سنداته هو وحدها.
 *
 * المسدَّد يُجمع من السندات لا من `paid_amount` المخزَّن: رقمٌ وبنودُه في
 * ردٍّ واحد لا يجوز أن يختلفا، والمخزَّن قد ينحرف. نفس اختيار الواجهة.
 */
export function capitalOf(partner, receipts) {
  const workersCount = Number(partner?.workersCount ?? partner?.workers_count) || 0;
  const required = round2(workersCount * PER_WORKER_FEE);
  const paid = round2((receipts || []).reduce((s, r) => s + (Number(r.amount) || 0), 0));
  const remaining = Math.max(0, round2(required - paid));
  return {
    perWorkerFee: PER_WORKER_FEE,
    workersCount,
    required,
    paid,
    remaining,
    settled: required > 0 && remaining === 0,
    receiptsCount: (receipts || []).length,
  };
}

/** `YYYY-MM` لآخر n شهراً حتى `today` (شاملاً). */
export function lastMonths(n, today = new Date()) {
  const out = [];
  const d = new Date(today.getFullYear(), today.getMonth(), 1);
  for (let i = n - 1; i >= 0; i -= 1) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

export function receiptsByMonth(receipts, months) {
  const by = new Map(months.map((m) => [m, 0]));
  for (const r of receipts || []) {
    const key = String(r.paymentDate || '').slice(0, 7);
    if (by.has(key)) by.set(key, round2(by.get(key) + (Number(r.amount) || 0)));
  }
  return months.map((month) => ({ month, amount: by.get(month) }));
}

/** صفوف قائمة الدخل بالحساب — للعرض: رمزٌ واسمٌ ومبلغ، لا أكثر. */
export function rowsByAccount(rows) {
  return (rows || [])
    .filter((r) => Math.abs(Number(r.amount) || 0) >= 0.005)
    .map((r) => ({ code: String(r.code), name: r.nameArabic || String(r.code), amount: round2(r.amount) }));
}
