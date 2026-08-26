// ═══════════════════════════════════════════════════════════════════════════
// مصدر الإيراد — نسخة العميل، للمعاينة والعرض
// ═══════════════════════════════════════════════════════════════════════════
// المنع الحقيقي في `functions/src/sweater/revenueOrigin.js`؛ هذه نسخةٌ للشاشة
// كي تقول المعاينةُ ما سيقوله الخادم بالضبط. ومعاينةٌ تَعِد بما يرفضه الخادم
// أسوأ من غياب المعاينة.
//
// ويقفلهما `functions/test/revenueOriginDrift.test.js`: أي فرقٍ في القرار
// بين النسختين يسقط هناك، لا في وجه المستخدم.
// ═══════════════════════════════════════════════════════════════════════════

export const REVENUE_ORIGIN = Object.freeze(['direct', 'sweater', 'other_b2b']);
export const DEFAULT_REVENUE_ORIGIN = 'direct';

export const REVENUE_ORIGIN_AR = Object.freeze({
  direct:    'مباشر',
  sweater:   'منصة سويتر',
  other_b2b: 'جهة أخرى',
});

export function clampRevenueOrigin(value) {
  const v = String(value ?? '').trim();
  return REVENUE_ORIGIN.includes(v) ? v : DEFAULT_REVENUE_ORIGIN;
}

export function washPostabilityProblem(row) {
  const origin = clampRevenueOrigin(row?.revenue_origin ?? row?.revenueOrigin);
  if (origin === 'direct') return null;
  if (origin === 'sweater') {
    return 'هذه الغسلة مصدرها منصة سويتر — إيرادها يُعترف به من تسوية سويتر '
      + 'الشهرية لا من هنا، وإلا ظهر الإيراد مرتين. افتح تبويب سويتر واعتمد الشهر.';
  }
  return `مصدر إيراد هذه الغسلة «${origin}» — لا يُرحَّل من وحدة الغسلات.`;
}
