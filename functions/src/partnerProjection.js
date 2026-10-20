// ═══════════════════════════════════════════════════════════════════════════
// ما يصل متصفح الشريك — قوائم سماح لا قوائم منع
// ═══════════════════════════════════════════════════════════════════════════
// نسبة الشريك وعمالة الشركة قرارٌ للمالك أن تبقيا مخفيتين. الواجهة كانت
// تخفيهما، والخادم يرسلهما في الردّ نفسه: `factor` و`totalWorkers` و
// `sharePercent` و`companyCount` كلها في Network لمن فتح أدوات المطوّر.
//
// فالإسقاط هنا: كل ردٍّ لغير المدير يمرّ بقائمة سماح صريحة، ثم يُفحص كاملاً
// بـ `assertNoRatio` — حقلٌ جديد يحمل النسبة يوماً ما يصير خطأً يُرى، لا
// رقماً يتسرّب بصمت. المدير المحاكي يأخذ الردّ كاملاً للتدقيق.
//
// `rawAmount` من القائمة نفسها: رقم الشركة قبل القسمة بجوار المقسوم يكشف
// النسبة بقسمةٍ واحدة (انظر تعليق `partnerOperatingStatement`).
// ═══════════════════════════════════════════════════════════════════════════

export const RATIO_KEYS = Object.freeze([
  'factor', 'scalingFactor', 'sharePercent', 'totalWorkers', 'companyCount',
  'totalEligibleWorkers', 'rawAmount',
]);
const RATIO_SET = new Set(RATIO_KEYS);

/** نسخةٌ بلا أيّ مفتاحٍ من `RATIO_KEYS` على أيّ عمق. */
function stripRatio(value) {
  if (Array.isArray(value)) return value.map(stripRatio);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, inner] of Object.entries(value)) {
    if (!RATIO_SET.has(key)) out[key] = stripRatio(inner);
  }
  return out;
}

/** يرمي إن بقي في الردّ مفتاحٌ يكشف النسبة — الفشل هنا أرخص من التسريب. */
export function assertNoRatio(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((inner, i) => assertNoRatio(inner, `${path}[${i}]`));
    return value;
  }
  if (!value || typeof value !== 'object') return value;
  for (const [key, inner] of Object.entries(value)) {
    if (RATIO_SET.has(key)) throw new Error(`partner projection leaked ${path}.${key}`);
    assertNoRatio(inner, `${path}.${key}`);
  }
  return value;
}

const pick = (row, keys) => Object.fromEntries(keys.filter(k => row?.[k] !== undefined).map(k => [k, row[k]]));

const ELIGIBILITY_KEYS = ['originalWorkers', 'eligibleWorkers', 'suspendedWorkers', 'effectiveFrom'];
const CAPITAL_KEYS = ['paid', 'receiptsCount', 'ledgerBalance', 'ledgerAvailable', 'unposted'];
const REPORT_KEYS = ['partnerId', 'workersCount', 'asOf', 'fundingAsOf', 'fundingBasis', 'from', 'through', 'basis'];

const projectEligibility = eligibility => (eligibility ? pick(eligibility, ELIGIBILITY_KEYS) : eligibility);

/**
 * تقرير التوزيع كما يراه الشريك. القائمة العليا صريحة؛ داخل كل قائمة دخل
 * الأرقام كلها مقسومة أصلاً، فيُنزع منها ما يكشف النسبة على أيّ عمق.
 */
export function projectAllocationReport(report) {
  const out = pick(report, REPORT_KEYS);
  if (report?.capital) out.capital = pick(report.capital, CAPITAL_KEYS);
  if (report?.capitalJourney) out.capitalJourney = stripRatio(report.capitalJourney);
  out.statements = (report?.statements || []).map(statement => ({
    ...stripRatio(statement),
    eligibility: projectEligibility(statement.eligibility),
  }));
  return assertNoRatio(out);
}

/** حصّة الغسلات: ما يعادل حصّته شهراً بشهر، بلا عدد الشركة ولا النسبة. */
export function projectWashShare(share) {
  return assertNoRatio({
    partnerId: share?.partnerId,
    workersCount: share?.workersCount,
    eligibility: projectEligibility(share?.eligibility),
    months: (share?.months || []).map(m => ({ month: m.month, shareCount: m.shareCount })),
  });
}

/**
 * صفّ الشريك المربوط بالحساب. لا `user_id` (المتصل يعرف هويته)، ولا الجوال،
 * ولا `paid_amount` (مخزَّنٌ قد ينحرف؛ المدفوع يأتي من `capital`)، ولا أي
 * نسبة قديمة محفوظة.
 */
export function projectPartnerProfile(partner) {
  return assertNoRatio({
    id: String(partner?.id ?? ''),
    partnerName: partner?.partner_name || '',
    workersCount: Math.max(0, Number(partner?.workers_count) || 0),
    status: partner?.status || 'active',
  });
}
