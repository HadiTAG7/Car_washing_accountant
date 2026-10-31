// ═══════════════════════════════════════════════════════════════════════════
// صفّ «أسعار الخدمات» — فحصٌ خالص يشترك فيه الخادم والنموذج
// ═══════════════════════════════════════════════════════════════════════════
// الصافي والضريبة والإجمالي تُشتقّ من المُدخل (`derivePrice`)، فلا يُحفظ
// ثلاثيٌّ غير متسق، ويرى المدير قبل الحفظ نفس الأرقام التي ستُحفظ.

import { derivePrice, PRICE_MODES } from './pricing.js';
import { datedRowProblems, isoDay } from './datedConfig.js';

export const PRICES_COL = 'sweater_price_list';
const SERVICE = /^[\p{L}\p{N}_.: -]{1,80}$/u;
// بتسامح: `0.07 * 100` في الفاصلة العائمة 7.000000000000001.
const whole = (value, scale) => Math.abs(value * scale - Math.round(value * scale)) < 1e-6;
const money = value => Number.isFinite(value) && value > 0 && value <= 1e6 && whole(value, 100);

/** The row a price entry saves, or what stops it. */
export function servicePriceRow(input) {
  const serviceType = String(input?.serviceType ?? '').trim(), price = Number(input?.price), vatRate = Number(input?.vatRate);
  const problems = [];
  if (!SERVICE.test(serviceType)) problems.push('الخدمة مطلوبة: حروف وأرقام وشرطة سفلية، حتى 80 حرفًا.');
  if (!money(price)) problems.push('السعر موجب بالهللة.');
  if (!PRICE_MODES.includes(input?.priceMode)) problems.push('حدّد هل السعر شامل الضريبة أو قبلها.');
  if (!(input?.vatRate !== '' && input?.vatRate != null && Number.isFinite(vatRate) && vatRate >= 0 && vatRate <= 1
    && whole(vatRate, 10000))) problems.push('نسبة الضريبة بين 0 و1، مثل 0.15.');
  const name = input?.nameArabic == null ? null : String(input.nameArabic).trim().slice(0, 80) || null;
  const row = { key: serviceType, serviceType, nameArabic: name, effectiveFrom: isoDay(input?.effectiveFrom), effectiveTo: null, status: 'active' };
  problems.push(...datedRowProblems(row, { keyField: 'serviceType', keyLabel: 'الخدمة' }).filter(p => p !== 'الخدمة مطلوب.'));
  if (problems.length) return { problems };
  const d = derivePrice({ netRate: price, grossRate: price, vatRate, priceMode: input.priceMode });
  return { problems: [], row: { ...row, priceMode: d.priceMode, vatRate: d.vatRate, netRate: d.net, vatAmount: d.vat, grossRate: d.gross } };
}
