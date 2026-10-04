// A calendar date is not an instant. Formatting it in UTC keeps its own day
// in every browser timezone, without rewriting the stored source value.
export function formatDateOnly(value, locale = 'ar-SA') {
  const s = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s || '—';
  const date = new Date(`${s}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== s) return s;
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric', numberingSystem: 'latn', calendar: 'gregory', timeZone: 'UTC' }).format(date);
}
