import { growthDay } from './growthMetrics';

// Presentation of the already loaded wash register, not ledger revenue or collection.
// Keep the same completion/quantity/price and partner scaling as the existing cards.
export function washDailySummary(items, scalingFactor = 1) {
  const buckets = new Map();
  let completed = 0, revenue = 0;
  for (const wash of items) {
    if (wash.status !== 'مكتملة') continue;
    const quantity = wash.quantity || 0;
    const amount = quantity * wash.price;
    completed += quantity;
    revenue += amount;
    const date = growthDay(wash.washDate);
    const day = buckets.get(date) || { date, quantity: 0, revenue: 0 };
    day.quantity += quantity;
    day.revenue += amount;
    buckets.set(date, day);
  }
  const days = [...buckets.values()].sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .map(day => ({ ...day, quantity: Math.round(day.quantity * scalingFactor), revenue: day.revenue * scalingFactor }));
  return { completed: Math.round(completed * scalingFactor), revenue: revenue * scalingFactor,
    days, latest: days.find(day => day.date) || null };
}
