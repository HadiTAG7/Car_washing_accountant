export function financeFixture(overrides = {}) {
  return { schemaVersion: 1, reportId: 'finance-2026-10-19-1-daily-2026-10-19-2026-10-19', revision: 1,
    dateRiyadh: '2026-10-19', cutAtRiyadh: '2026-10-19T10:00:00+03:00', sourceRole: 1,
    period: { kind: 'daily', from: '2026-10-19', to: '2026-10-19' }, title: 'تقرير اختبار معزول', summary: 'بيانات اصطناعية لا تمثل العمل الحقيقي.',
    review: { completed: true, reviewerRole: 1, sourceRef: 'TEST-REVIEW', at: '2026-10-19T09:55:00+03:00' },
    metrics: [{ id: 'metric', label: 'مؤشر تجريبي', value: null, unit: 'ر.س', basis: 'unavailable', coverage: 'غير متاح في بيانات الاختبار', asOf: '2026-10-19T09:55:00+03:00' }],
    visibleWarnings: [{ id: 'scope', severity: 'limitation', text: 'بيانات اختبار معزولة فقط' }],
    sources: [{ id: 'source', label: 'مصدر اختباري', sourceRef: 'TEST-SOURCE', checkedAt: '2026-10-19T09:55:00+03:00', coverage: 'اختبار لا إنتاج', status: 'partial' }],
    cases: [{ caseId: 'TEST-CASE', title: 'حالة اختبار', ownerRole: 1, status: 'open', evidence: 'دليل اختبار فقط', next: 'فحص معزول' }],
    sections: [{ id: 'detail', title: 'تفصيل اختباري', text: 'النص لا ينفذ إجراءات مالية.', columns: ['اسم', 'قيمة'], rows: [['اختبار', null]] }],
    historicalIntegrity: 'لقطة اختبار لا تتغير تلقائيًا', ...overrides };
}
export function expensePatch(overrides = {}) {
  return { description: 'مستند اصطناعي معزول', amount: 100, date: '2026-10-18', quantity: 2, categoryId: 'test-category',
    supplier: 'مورد اختبار', invoiceNumber: 'TEST-001', invoiceDate: '2026-10-18', invoiceUrl: 'https://example.org/synthetic-invoice',
    isTaxInvoice: false, vatDeductible: false, vatAmount: null, vatRate: null, priceMode: 'inclusive',
    paymentMethod: 'credit', paymentStatus: 'unpaid', paidDate: null,
    fundingType: 'vendor_liability', fundingReference: 'TEST-SUPPLIER-DEBT', purpose: 'اختبار في محاكي فقط', evidenceRefs: ['TEST-ORIGINAL'], ...overrides };
}
// Unit-only storage double. Real transactional/query behavior has separate
// emulator tests; this must never be described as production verification.
export function memoryFinanceDb(seed = {}) {
  const rows = new Map(Object.entries(seed)), db = {}, snapshot = ref => ({ id: ref.id, ref, exists: rows.has(ref.path), data: () => rows.get(ref.path) });
  let auto = 0, queue = Promise.resolve();
  db.collection = name => {
    const query = (filters = [], ordering = null, count = Infinity, after = null) => ({
      doc(key = `auto-${++auto}`) {
        const ref = { path: `${name}/${key}`, id: key, collection: child => db.collection(`${name}/${key}/${child}`),
          get: async () => snapshot(ref), set: async value => rows.set(ref.path, value), update: async value => rows.set(ref.path, { ...rows.get(ref.path), ...value }) };
        return ref;
      },
      where: (key, op, value) => query([...filters, [key, op, value]], ordering, count, after),
      orderBy: (key, direction = 'asc') => query(filters, [key, direction], count, after),
      limit: value => query(filters, ordering, value, after), startAfter: key => query(filters, ordering, count, key),
      async get() {
        let all = [...rows].filter(([path]) => path.startsWith(`${name}/`) && !path.slice(name.length + 1).includes('/'));
        const value = ([path, row], key) => key === '__name__' ? path.slice(name.length + 1) : row[key];
        all = all.filter(entry => filters.every(([key, op, expected]) => op === '==' ? value(entry, key) === expected : value(entry, key) < expected));
        if (ordering) all.sort((a, b) => (value(a, ordering[0]) < value(b, ordering[0]) ? -1 : value(a, ordering[0]) > value(b, ordering[0]) ? 1 : 0) * (ordering[1] === 'desc' ? -1 : 1));
        if (after) all = all.filter(([path]) => path.slice(name.length + 1) > after);
        const docs = all.slice(0, count).map(([path]) => snapshot(db.collection(name).doc(path.slice(name.length + 1))));
        return { docs, size: docs.length, empty: docs.length === 0 };
      },
    });
    return query();
  };
  db.runTransaction = fn => {
    const result = queue.then(async () => {
      const writes = [];
      const tx = { get: ref => ref.get(), set: (ref, value) => writes.push(() => rows.set(ref.path, value)),
        create: (ref, value) => writes.push(() => rows.set(ref.path, value)), update: (ref, value) => writes.push(() => rows.set(ref.path, { ...rows.get(ref.path), ...value })) };
      const answer = await fn(tx); writes.forEach(write => write()); return answer;
    });
    queue = result.catch(() => {}); return result;
  };
  db.rows = rows;
  return db;
}
