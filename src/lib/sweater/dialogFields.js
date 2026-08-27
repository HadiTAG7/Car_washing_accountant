// ═══════════════════════════════════════════════════════════════════════════
// تحقق حقول نوافذ سويتر — دوالٌّ صافية، تُختبر بلا متصفح
// ═══════════════════════════════════════════════════════════════════════════
// مفصولةٌ عن `SweaterActionDialog.jsx` لسببين: قاعدة `react-refresh` تمنع
// تصدير غير المكوّنات من ملف مكوّن، **و**لأن التحقق منطقٌ يستحق اختباراً
// مباشراً لا عبر رسم نافذة.
//
// وهذا التحقق هو ما كان غائباً حين كانت الأسئلة بـ`prompt`:
// `Number(prompt('المبلغ'))` على فراغٍ يعطي **صفراً** فيُسجَّل تحصيلٌ بصفر،
// وعلى نصٍّ يعطي `NaN` فيذهب إلى الخادم. الاثنان كانا يمرّان بصمت.
// ═══════════════════════════════════════════════════════════════════════════

/** ما يمنع حقلاً من القبول — رسالةٌ عربية تُعرض تحته، أو `null`. */
export function fieldProblem(field, raw) {
  const value = String(raw ?? '').trim();

  if (field.required && !value) return `${field.label} مطلوب.`;
  if (!value) return null;

  if (field.type === 'number') {
    const n = Number(value);
    if (!Number.isFinite(n)) return `${field.label} يجب أن يكون رقماً.`;
    if (field.positive && n <= 0) return `${field.label} يجب أن يكون أكبر من صفر.`;
    if (field.min != null && n < field.min) {
      return field.min === 0
        ? `${field.label} لا يكون سالباً.`
        : `${field.label} يجب أن يكون ${field.min} فأكثر.`;
    }
  }

  if (field.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${field.label} يجب أن يكون تاريخاً بصيغة YYYY-MM-DD.`;
  }
  return null;
}

/** أول مشكلة في الحقول كلها — وبها يُجمَّد زر التأكيد. */
export function firstProblem(fields, values) {
  for (const f of fields) {
    const p = fieldProblem(f, values?.[f.name]);
    if (p) return p;
  }
  return null;
}

/**
 * الحمولة كما تُسلَّم للمستدعي.
 *
 * الأرقام أرقاماً والنصوص مُشذَّبة، والفراغ `null` لا `''` ولا `0`: «لم
 * يُذكر» و«صفر» حقيقتان مختلفتان، وخلطهما هو ما جعل `prompt` يسجّل تحصيلاً
 * بصفر ريال.
 */
export function dialogPayload(fields, values) {
  const out = {};
  for (const f of fields) {
    const raw = String(values?.[f.name] ?? '').trim();
    out[f.name] = f.type === 'number' ? (raw === '' ? null : Number(raw)) : (raw || null);
  }
  return out;
}

/** القيم الابتدائية — كل حقلٍ وافتراضه، فلا نافذة تُفتح بقيم مرةٍ سابقة. */
export function initialValues(fields) {
  return Object.fromEntries((fields || []).map((f) => [f.name, f.defaultValue ?? '']));
}
