import { formatCurrencyPrecise } from '../../data/initialData';

export const money = value => formatCurrencyPrecise(Number(value) || 0);
// Gregorian ISO days, exactly as bank statements print them, so a line and its
// document can be compared at a glance (the locale default may be Hijri).
export const day = value => (value ? String(value).slice(0, 10) : '—');

/** «المشروع مدين لهادي بـX» أو «عند هادي للمشروع X». */
export function meaningText(meaning) {
  if (!meaning || meaning.kind === 'zero') return 'لا رصيد بين هادي والمشروع.';
  return meaning.kind === 'owed_to_hadi' ? `المشروع مدين لهادي بـ ${money(meaning.amount)}` : `عند هادي للمشروع ${money(meaning.amount)}`;
}

/** A balance in words, short: «لهادي X» (the project owes him) or «عند هادي X». */
export function balanceShort(balance) {
  const value = Number(balance) || 0;
  if (Math.round(value * 100) === 0) return money(0);
  return value > 0 ? `لهادي ${money(value)}` : `عند هادي ${money(-value)}`;
}
