// Server-scoped, already rounded partner amounts. Plan identity and kind,
// not similar names or a decorated reversal label, define each group.
export function groupInitialJourneyItems(items) {
  const groups = new Map();
  for (const [index, item] of items.entries()) {
    const confirmed = ['startup', 'annual'].includes(item.kind)
      && typeof item.groupKey === 'string'
      && item.groupKey.startsWith(`${item.kind}:`)
      && item.groupKey.length > item.kind.length + 1;
    const key = confirmed ? item.groupKey : `unclassified:${index}`;
    if (!groups.has(key)) groups.set(key, {
      id: key, description: item.description, kind: item.kind,
      classified: confirmed, reversal: false, cents: 0,
    });
    const group = groups.get(key);
    // Every document cent contributes, including refunds, zero and duplicates.
    group.cents += Math.round(item.amount * 100);
    group.reversal ||= Boolean(item.reversal);
  }
  return [...groups.values()].map(({ cents, ...group }) => ({ ...group, amount: cents / 100 }));
}
