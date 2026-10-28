// A request-local, read-only snapshot. This is not an authorisation or write
// adapter: only the authenticated admin browse path uses it, and approval
// still re-reads the real database in the original transaction.
export async function financeReadSnapshot(db, names) {
  const tables = new Map(await Promise.all([...new Set(names)].map(async name => {
    const result = await db.collection(name).get();
    return [name, new Map(result.docs.map(doc => [doc.id, doc.data()]))];
  })));
  const snapshot = (id, value) => ({ id, exists: value !== undefined, data: () => value });
  const fieldValue = (row, field) => field.split('.').reduce((value, segment) => value?.[segment], row);
  const query = (name, filters = [], max = Infinity) => ({
    where(field, operator, value) {
      if (operator !== '==') throw new Error('Unsupported read-only snapshot filter');
      return query(name, [...filters, [field, value]], max);
    },
    limit(count) { return query(name, filters, count); },
    doc(id) {
      if (id === undefined) throw new Error('Snapshot cannot allocate documents');
      return { get: async () => snapshot(String(id), tables.get(name).get(String(id))) };
    },
    async get() {
      const docs = [...tables.get(name)].filter(([, value]) => filters.every(([field, expected]) => fieldValue(value, field) === expected))
        .slice(0, max).map(([id, value]) => snapshot(id, value));
      return { docs, size: docs.length, empty: docs.length === 0 };
    },
  });
  return { collection(name) {
    if (!tables.has(name)) throw new Error('Collection outside finance read snapshot');
    return query(name);
  } };
}
