// ═══════════════════════════════════════════════════════════════════════════
// ترتيب سجل البايكر — بعمودٍ يختاره المالك، والفارغ آخراً دائماً
// ═══════════════════════════════════════════════════════════════════════════
// «ابغى ترتيبهم أنا أحدده — على الكفيل، أو الجنسية، أو السكن». والجدول كان
// يعرضهم بترتيب المصدر وحده (الاسم)، فسؤالٌ مثل «كم واحداً على كفيل فلان؟»
// كان مسحاً بالعين لصفٍّ صف.
//
// ── والفارغ آخراً في الاتجاهين، وهو القرار الذي يستحق الشرح ──
// ترتيبٌ تصاعدي على «الكفيل» يضع الفراغ أولاً بالمقارنة الساذجة، فتتصدّر
// القائمةَ صفوفٌ لا كفيل لها — وهي بالضبط ما لا يريد الناظر رؤيته حين يرتّب
// بالكفيل. فالفراغ يُدفع إلى الذيل **مهما كان الاتجاه**: هو غياب قيمة، لا
// قيمةٌ صغرى.
//
// ── والعربية تُقارَن بمقابلٍ عربي ──
// `'أحمد' < 'باسم'` بالمقارنة الثنائية تعطي ترتيب UTF-16 لا الترتيب الأبجدي.
// `localeCompare(…, 'ar')` هو ما يجعل القائمة تُقرأ كما يتوقّعها قارئٌ عربي.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * الأعمدة القابلة للترتيب ونوع كلٍّ منها.
 *
 * `key` دالةٌ لا اسم حقل، لأن بعض القيم مشتقّة (`stats.washCount`) وبعضها
 * مجموعٌ (`advancesTotal`). ودالةٌ واحدة لكل عمود تعني أن ما يُعرض وما
 * يُرتَّب به شيءٌ واحد — لا عمودٌ يُظهر رقماً ويُرتَّب بغيره.
 *
 * والقائمة مطابقةٌ لرؤوس الجدول تماماً، لا أوسع: عمودٌ مُعرَّفٌ هنا بلا رأسٍ
 * يُنقر شيفرةٌ ميتة، ورأسٌ بلا تعريفٍ ينهار عند أول نقرة. يحرس الطرفين
 * `bikerSortColumns.test.js` بمسح الصفحة نصّاً.
 */
export const BIKER_SORT_COLUMNS = Object.freeze({
  name:        { label: 'الاسم',        type: 'text',   key: (r) => r.name },
  contact:     { label: 'الجوال',       type: 'text',   key: (r) => r.contactNumber },
  residence:   { label: 'السكن',        type: 'text',   key: (r) => r.residence },
  sponsor:     { label: 'الكفيل',       type: 'text',   key: (r) => r.sponsor },
  nationality: { label: 'الجنسية',      type: 'text',   key: (r) => r.nationality },
  salary:      { label: 'الراتب',       type: 'number', key: (r) => r.salary },
  advances:    { label: 'سلف قائمة',    type: 'number', key: (r) => r.advancesTotal },
  washCount:   { label: 'غسلات الشهر',  type: 'number', key: (r) => r.stats?.washCount },
  commission:  { label: 'عمولة الشهر',  type: 'number', key: (r) => r.stats?.commission },
  iqamaExpiry: { label: 'الإقامة',      type: 'date',   key: (r) => r.iqamaExpiry },
});

export const DEFAULT_SORT = Object.freeze({ column: 'name', direction: 'asc' });

/** فارغ؟ — `null`، `undefined`، ونصٌّ لا يحمل إلا فراغات. الصفر ليس فارغاً. */
export function isBlank(v) {
  if (v == null) return true;
  if (typeof v === 'number') return !Number.isFinite(v);
  return String(v).trim() === '';
}

/**
 * مقارنة صفّين على عمودٍ واتجاه.
 *
 * الترتيب داخلها مقصود: الفراغ يُحسم **قبل** الاتجاه، فلا يقلبه عكسُ الترتيب.
 */
function compareRows(a, b, columnId, direction = 'asc') {
  const col = BIKER_SORT_COLUMNS[columnId];
  if (!col) return 0;

  const va = col.key(a);
  const vb = col.key(b);
  const ba = isBlank(va);
  const bb = isBlank(vb);

  // الفراغ آخراً في الاتجاهين — غيابُ قيمة لا قيمةٌ صغرى.
  if (ba && bb) return 0;
  if (ba) return 1;
  if (bb) return -1;

  let cmp;
  if (col.type === 'number') {
    cmp = (Number(va) || 0) - (Number(vb) || 0);
  } else if (col.type === 'date') {
    // ISO يقارَن نصّاً بأمان، وتاريخٌ فاسد عُدّ فارغاً قبل هنا.
    cmp = String(va).localeCompare(String(vb));
  } else {
    cmp = String(va).localeCompare(String(vb), 'ar', { numeric: true, sensitivity: 'base' });
  }

  if (cmp !== 0) return direction === 'desc' ? -cmp : cmp;

  // فاصلٌ ثابت عند التساوي: بلا هذا يتأرجح ترتيب المتساويين بين رسمتين،
  // فيبدو الجدول وكأنه يتحرّك بلا سبب.
  return String(a.name ?? '').localeCompare(String(b.name ?? ''), 'ar');
}

/** نسخةٌ مرتّبة — لا يُمَسّ المصفوف الأصلي. */
export function sortBikers(rows, { column, direction } = DEFAULT_SORT) {
  if (!BIKER_SORT_COLUMNS[column]) return [...(rows || [])];
  return [...(rows || [])].sort((a, b) => compareRows(a, b, column, direction));
}

/**
 * النقرة التالية على رأس عمود.
 *
 * نفس العمود يقلب الاتجاه؛ وعمودٌ آخر يبدأ تصاعدياً — إلا الأرقام والتواريخ،
 * فأول ما يُراد منها عادةً **الأكبر أو الأحدث**: «من أكثرهم غسلات؟» لا
 * «من أقلّهم؟»، و«أيّ إقامة تنتهي أولاً؟» تُقرأ من التصاعدي فتبقى كذلك.
 */
export function nextSort(current, columnId) {
  if (!BIKER_SORT_COLUMNS[columnId]) return current;
  if (current?.column === columnId) {
    return { column: columnId, direction: current.direction === 'asc' ? 'desc' : 'asc' };
  }
  const type = BIKER_SORT_COLUMNS[columnId].type;
  return { column: columnId, direction: type === 'number' ? 'desc' : 'asc' };
}

const STORAGE_KEY = 'mw:bikerSort';

/** يُقرأ التفضيل، ويُتجاهَل الفاسد — تخزينٌ معطَّل لا يُسقط الصفحة. */
export function loadSort() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
    if (raw && BIKER_SORT_COLUMNS[raw.column] && ['asc', 'desc'].includes(raw.direction)) {
      return { column: raw.column, direction: raw.direction };
    }
  } catch { /* الوضع الخاص وبعض الـwebviews ترمي */ }
  return { ...DEFAULT_SORT };
}

export function saveSort(sort) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sort));
  } catch { /* تفضيلٌ لا يُحفَظ أهون من صفحةٍ تنهار */ }
}
