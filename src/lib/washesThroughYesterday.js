// Reporting cutoff follows the business day in Riyadh, not the viewer's timezone.
export function riyadhTodayISO(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Riyadh', calendar: 'gregory', numberingSystem: 'latn',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const value = type => parts.find(part => part.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function completedWashesBeforeToday(items, today) {
  return items.reduce((total, wash) => {
    const date = wash.washDate;
    if (wash.status !== 'مكتملة' || typeof date !== 'string'
      || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date >= today) return total;
    const parsed = new Date(`${date}T12:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return total;
    const quantity = Number(wash.quantity);
    return Number.isFinite(quantity) && quantity > 0 ? total + quantity : total;
  }, 0);
}
