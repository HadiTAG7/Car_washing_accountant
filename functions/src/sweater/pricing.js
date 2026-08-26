// ═══════════════════════════════════════════════════════════════════════════
// تسعير خدمات سويتر — من جدولٍ تعاقدي مؤرخ، ولقطةٌ تُثبَّت على كل عملية
// ═══════════════════════════════════════════════════════════════════════════
// «٢٠ ريال قبل الضريبة و٢٣ شاملاً» و«١٩١ و٢٢٠» أرقامٌ من دليل سويتر اليوم،
// وستتغيّر. فهي **صفوفٌ في `sweater_price_list`** لا ثوابت في الشيفرة، ولا
// تُكتب مرةً واحدة في مكانٍ واحد بل تُقرأ بتاريخ الخدمة.
//
// ── ولماذا تُثبَّت لقطة ──
// تعديل سعرٍ في مارس يجب ألّا يحرّك ريالاً في يناير. القراءة بالتاريخ تكفي
// **ما دامت الصفوف لم تُحرَّر**؛ واللقطة على العملية هي ما يبقى صادقاً حتى لو
// عُدِّل صفّ الجدول نفسه أو حُذف. الرقم في الدفاتر يجب أن يشرح نفسه بلا
// الرجوع إلى جدولٍ قد يكون تغيّر.
//
// ── ومبلغ العميل ليس مستحق الشريك ──
// المنصة تعرض ما دفعه العميل، وقد يكون صفراً (باقة أو غسلة مجانية) أو أقلّ
// (كود خصم). المستحق يُحسب من **العقد**، والفرق يُخزَّن في
// `customerDiscount` للتقارير — ولا يُطرح من المستحق إلا بقاعدةٍ تعاقدية
// مؤرخة تقول ذلك صراحةً.
// ═══════════════════════════════════════════════════════════════════════════

import { round2 } from '../invariants.js';
import { resolveDatedRow, isoDay, datedRowProblems } from './datedConfig.js';

/** طريقتا التسعير: الصافي معلوم، أو الإجمالي معلوم والضريبة بداخله. */
export const PRICE_MODES = Object.freeze(['exclusive', 'inclusive']);

/**
 * يشتقّ الثلاثية من أيّ اثنين — والمصدر هو `priceMode`.
 *
 * جدولٌ يحمل الثلاثة مكتوبةً بيد إنسان يمكن أن يحمل ٢٠ و٢٣ و١٥٪ معاً وهي
 * متسقة، أو ٢٠ و٢٥ و١٥٪ وهي ليست كذلك. فالمحفوظ يُعاد اشتقاقه ويُقارَن.
 */
export function derivePrice({ netRate, grossRate, vatRate, priceMode = 'exclusive' }) {
  const rate = Number(vatRate);
  const r = Number.isFinite(rate) && rate >= 0 ? rate : 0;
  if (priceMode === 'inclusive') {
    const gross = round2(Number(grossRate) || 0);
    const net = round2(gross / (1 + r));
    return { net, vat: round2(gross - net), gross, vatRate: r, priceMode };
  }
  const net = round2(Number(netRate) || 0);
  const vat = round2(net * r);
  return { net, vat, gross: round2(net + vat), vatRate: r, priceMode };
}

/**
 * سعر خدمةٍ في يومها — أو سببُ عدم المعرفة.
 *
 * لا يرجع سعراً افتراضياً أبداً. `known:false` تعني: ضع العملية في
 * `needs_review` ولا تعترف بإيرادها.
 */
export function resolveServicePrice(priceRows, serviceType, serviceDate) {
  const hit = resolveDatedRow(priceRows, serviceType, serviceDate, { keyField: 'serviceType' });
  if (!hit.known) return hit;

  const row = hit.row;
  const derived = derivePrice(row);
  return {
    known: true,
    snapshot: {
      serviceType: String(row.serviceType),
      priceListId: row.id ?? null,
      effectiveFrom: hit.effectiveFrom,
      priceMode: derived.priceMode,
      vatRate: derived.vatRate,
      netRate: derived.net,
      vatAmount: derived.vat,
      grossRate: derived.gross,
      // من أين جاء الرقم — يُقرأ بعد سنة بلا فتح جدول.
      source: 'sweater_price_list',
      capturedFor: isoDay(serviceDate),
    },
  };
}

/**
 * مستحق الشريك عن مجموعة خدمات — بالصافي والضريبة والإجمالي.
 *
 * الجمع على **الصافي** ثم اشتقاق الضريبة مرة واحدة يُراكم كسوراً؛ والجمع على
 * ضريبة كل سطر يطابق ما تراه المنصة سطراً سطراً. فالمجموع هنا مجموع اللقطات
 * كما ثُبِّتت، لا إعادة حساب.
 */
export function sumSnapshots(snapshots = []) {
  let net = 0, vat = 0, gross = 0;
  for (const s of snapshots) {
    net += Number(s?.netRate) || 0;
    vat += Number(s?.vatAmount) || 0;
    gross += Number(s?.grossRate) || 0;
  }
  return { net: round2(net), vat: round2(vat), gross: round2(gross), count: snapshots.length };
}

/** ما يمنع صفّ سعرٍ من الحفظ. */
export function priceRowProblems(row) {
  const problems = datedRowProblems(row, { keyField: 'serviceType', keyLabel: 'نوع الخدمة' });
  const mode = row?.priceMode ?? 'exclusive';
  if (!PRICE_MODES.includes(mode)) problems.push(`طريقة التسعير غير صالحة: ${mode}`);

  const rate = Number(row?.vatRate);
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    problems.push('نسبة الضريبة يجب أن تكون كسراً بين ٠ و١ (مثال: 0.15).');
  }
  const primary = mode === 'inclusive' ? Number(row?.grossRate) : Number(row?.netRate);
  if (!Number.isFinite(primary) || primary <= 0) {
    problems.push(mode === 'inclusive'
      ? 'السعر شامل الضريبة مطلوب وموجب.'
      : 'السعر قبل الضريبة مطلوب وموجب.');
  }

  // الثلاثية المكتوبة تُفحَص ضد المشتقّة — تناقضٌ يُقال قبل أن يُحفظ.
  if (!problems.length && row?.netRate != null && row?.grossRate != null) {
    const d = derivePrice(row);
    const stated = mode === 'inclusive' ? round2(Number(row.netRate)) : round2(Number(row.grossRate));
    const computed = mode === 'inclusive' ? d.net : d.gross;
    if (Math.abs(stated - computed) > 0.01) {
      problems.push(
        `الصافي والإجمالي لا يتفقان مع نسبة ${(d.vatRate * 100).toFixed(0)}٪ — `
        + `المتوقع ${computed} والمكتوب ${stated}.`,
      );
    }
  }
  return problems;
}

/**
 * القيم الابتدائية من دليل سويتر — تُزرع مرة، ثم تُدار من الشاشة.
 *
 * ── تناقضٌ في المصدر يُحسم ولا يُبتلع ──
 * الدليل يقول للتلميع «١٩١ قبل الضريبة و٢٢٠ شاملاً»، والرقمان لا يتفقان عند
 * ١٥٪: ‎191 × 1.15 = 219.65‎، و‎220 ÷ 1.15 = 191.30‎. فأحدهما مُقرَّب.
 *
 * والأرجح أن ٢٢٠ هو الرقم التعاقدي (رقمٌ مستدير يُتفق عليه) و١٩١ عرضٌ مُقرَّب
 * له. فيُزرع التلميع **شاملاً** بـ٢٢٠، ويشتقّ الصافي ١٩١٫٣٠ — بدل أن نكتب
 * ١٩١ فتنقص المطالبة ٠٫٣٥ ريال عن كل تلميعة، وهو فرقٌ يظهر في التسوية شهرياً
 * ولا يُعرف سببه.
 *
 * والغسيل لا إشكال فيه: ‎20 × 1.15 = 23.00‎ بالضبط.
 *
 * `statedInGuide` تحفظ ما كُتب في الدليل حرفياً — فالمراجعة تقارن بما رأته
 * العين، لا بما اشتققناه.
 */
export const SWEATER_PRICE_SEED = Object.freeze([
  {
    serviceType: 'interior_exterior_wash',
    nameArabic: 'غسيل داخلي وخارجي',
    priceMode: 'exclusive', netRate: 20, vatRate: 0.15, grossRate: 23,
    statedInGuide: { netRate: 20, grossRate: 23 },
  },
  {
    serviceType: 'polish',
    nameArabic: 'تلميع',
    priceMode: 'inclusive', grossRate: 220, vatRate: 0.15, netRate: 191.3,
    statedInGuide: { netRate: 191, grossRate: 220 },
  },
]);
