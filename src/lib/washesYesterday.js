// Reporting cutoff follows the business day in Riyadh, not the viewer's timezone.
export function riyadhTodayISO(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Riyadh', calendar: 'gregory', numberingSystem: 'latn',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const value = type => parts.find(part => part.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function completedWashesYesterday(items, today) {
  if (typeof today !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return 0;
  const previousDay = new Date(`${today}T12:00:00Z`);
  if (!Number.isFinite(previousDay.getTime()) || previousDay.toISOString().slice(0, 10) !== today) return 0;
  previousDay.setUTCDate(previousDay.getUTCDate() - 1);
  const yesterday = previousDay.toISOString().slice(0, 10);
  return items.reduce((total, wash) => {
    if (wash.status !== 'مكتملة' || wash.washDate !== yesterday) return total;
    const quantity = Number(wash.quantity);
    return Number.isFinite(quantity) && quantity > 0 ? total + quantity : total;
  }, 0);
}
