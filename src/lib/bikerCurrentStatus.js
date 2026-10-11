// Descriptive only: never used to calculate payroll, commissions or eligibility.
export const BIKER_CURRENT_STATUSES = Object.freeze([
  { ar: 'يشتغل', en: 'Working' },
  { ar: 'هرب', en: 'Reported runaway' },
  { ar: 'تدريب', en: 'Training' },
  { ar: 'رسب', en: 'Failed assessment' },
  { ar: 'إجازة', en: 'On leave' },
  { ar: 'بانتظار الوصول', en: 'Awaiting arrival' },
]);

export function bikerCurrentStatusLabel(value, language = 'ar') {
  const text = String(value || '').trim();
  if (!text) return language === 'en' ? 'Not specified' : 'غير محددة';
  const known = BIKER_CURRENT_STATUSES.find(item => item.ar === text || item.en === text);
  return known ? known[language === 'en' ? 'en' : 'ar'] : text;
}
