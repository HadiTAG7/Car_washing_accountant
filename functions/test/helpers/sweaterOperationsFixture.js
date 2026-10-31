export const syncPayload = () => ({ contractVersion: 2, importRunId: 'synthetic-sync-1', agentStatus: 'ok',
  coverage: { rangeFrom: '2026-10-08', rangeTo: '2026-10-08', extractedAt: '2026-10-09T00:00:00+03:00',
    pageCount: 1, pagesFetched: 1, recordCount: 1, isComplete: false, sourceUrl: 'https://ssp-portal.sweater.sa/bookings',
    modules: { individual: 'complete', corporate: 'unavailable' }, gaps: ['Corporate module unavailable'] },
  workerLinks: { 'driver-1': 'worker-1' },
  records: [{ sspBookingId: 'C-990001', bookingKind: 'individual', serviceType: 'observed-service',
    serviceDate: '2026-10-08', rawStatus: 'Collecting Payment', driverExternalId: 'driver-1',
    sourceUrl: 'https://ssp-portal.sweater.sa/bookings' }] });

export function syncDb() {
  const rows = new Map([['bikers/worker-1', { name: 'Synthetic worker', driver_external_id: 'driver-1', salary: 900 }]]);
  const writes = []; const snapshot = path => ({ exists: rows.has(path), id: path.split('/').at(-1), data: () => structuredClone(rows.get(path)) });
  const ref = path => ({ path, get: async () => snapshot(path),
    set: async (value, options) => { rows.set(path, options?.merge ? { ...rows.get(path), ...structuredClone(value) } : structuredClone(value)); writes.push(path); } });
  let queue = Promise.resolve();
  let auto = 0;
  return { rows, writes, collection: name => ({ doc: id => ref(`${name}/${id ?? `auto-${++auto}`}`),
    select() { return this; },
    get: async () => ({ docs: [...rows.keys()].filter(p => p.startsWith(`${name}/`)).map(snapshot) }) }),
    runTransaction: fn => { const result = queue.then(async () => {
      const pending = []; const out = await fn({ get: ref => ref.get(), set: (ref, value, options) => pending.push([ref.path, value, options]),
        delete: ref => pending.push([ref.path, undefined, { delete: true }]) });
      for (const [path, value, options] of pending) {
        if (options?.delete) rows.delete(path);
        else rows.set(path, options?.merge ? { ...rows.get(path), ...structuredClone(value) } : structuredClone(value));
        writes.push(path);
      }
      return out;
    }); queue = result.catch(() => {}); return result; } };
}
export const syncFV = { serverTimestamp: () => 'synthetic-time' };
export const syncRequest = (payload, p) => ({ payload, reviewedPayloadHash: p.reviewedPayloadHash, previewStateHash: p.previewStateHash });

