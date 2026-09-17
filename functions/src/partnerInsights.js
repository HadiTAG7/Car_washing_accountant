// ═══════════════════════════════════════════════════════════════════════════
// مؤشرات الشريك من الخادم — عدّ الغسلات بحصّته، بلا اسمٍ يصل المتصفح
// ═══════════════════════════════════════════════════════════════════════════
// صفحة الشريك لا تقرأ `washes` من المتصفح عمداً: صفُّ الغسلة يحمل اسم
// العامل، وما لا يُطلب لا يُسرَّب. فالعدّ يقع هنا بـ Admin SDK و`select`
// يسمّي الحقول الثلاثة التي يحتاجها — الكمية والحالة والتاريخ — ويعود رقمان
// لكل شهر: عدد الشركة، وما يعادل حصّة الشريك.
//
// نفس الحساب تستعمله أداة المساعد الذكي، فالرقم في الصفحة هو رقم المساعد.
// ═══════════════════════════════════════════════════════════════════════════

export const MAX_MONTHS = 24;

/** `YYYY-MM` لآخر n شهراً حتى اليوم (شاملاً)، تصاعدياً. */
export function lastMonthKeys(n, today = new Date()) {
  const count = Math.min(MAX_MONTHS, Math.max(1, Math.floor(Number(n) || 1)));
  const out = [];
  const d = new Date(today.getFullYear(), today.getMonth(), 1);
  for (let i = count - 1; i >= 0; i -= 1) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

const lastDayOf = (key) => {
  const [y, m] = key.split('-').map(Number);
  return `${key}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};
const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

/** عدد الغسلات المكتملة لكل شهرٍ في المدى — بلا اسمٍ ولا سعر. */
export async function countCompletedWashesByMonth(db, keys) {
  const counts = new Map(keys.map((k) => [k, 0]));
  if (!keys.length) return counts;
  const snap = await db.collection('washes')
    .where('wash_date', '>=', `${keys[0]}-01`)
    .where('wash_date', '<=', lastDayOf(keys[keys.length - 1]))
    .select('quantity', 'status', 'wash_date')
    .get();
  for (const d of snap.docs) {
    if (d.get('status') !== 'مكتملة') continue;
    const key = String(d.get('wash_date') || '').slice(0, 7);
    if (!counts.has(key)) continue;
    counts.set(key, counts.get(key) + Math.max(0, Math.floor(Number(d.get('quantity')) || 0)));
  }
  return counts;
}

/**
 * حصّة الشريك من الغسلات شهراً بشهر.
 *
 * النسبة تُحسب هنا من `partners` لا تُؤخذ من المتصل: مديرٌ يحاكي شريكاً
 * وشريكٌ عن نفسه يحصلان على نفس الرقم لأن مصدره واحد.
 */
export async function partnerWashShare(db, { partnerId, months = 12, today = new Date() } = {}) {
  const keys = lastMonthKeys(months, today);
  const [partnersSnap, counts] = await Promise.all([
    db.collection('partners').select('workers_count').get(),
    countCompletedWashesByMonth(db, keys),
  ]);
  let totalWorkers = 0; let workersCount = 0;
  for (const d of partnersSnap.docs) {
    const w = Number(d.get('workers_count')) || 0;
    totalWorkers += w;
    if (d.id === String(partnerId)) workersCount = w;
  }
  const factor = totalWorkers > 0 ? workersCount / totalWorkers : 0;
  return {
    partnerId: String(partnerId),
    workersCount,
    totalWorkers,
    factor,
    sharePercent: round1(factor * 100),
    months: keys.map((month) => ({
      month,
      companyCount: counts.get(month) || 0,
      shareCount: round1((counts.get(month) || 0) * factor),
    })),
  };
}
