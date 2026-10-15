import { beforeEach, expect, it } from 'vitest';
import { manualReviewProjection, saveManualReview, manualReviewId } from '../bikerQualityManual.js';

const scope = { bikerUID: 'worker', periodKey: '2026-10', from: '2026-10-01', to: '2026-10-14' };
let rows, db, serial;
const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const snap = (path, data) => ({ id: path.split('/').at(-1), exists: data !== undefined, data: () => copy(data) });
beforeEach(() => {
  serial = 0;
  rows = new Map([['users/admin', { role: 'admin' }], ['users/partner', { role: 'partner' }], ['bikers/worker', { start_date: '2026-08-01' }],
    ...Array.from({ length: 20 }, (_, i) => [`washes/w-${i}`, { biker_id: 'worker', wash_date: '2026-10-12', status: 'completed', quantity: 1, ssp_booking_id: `S-${i}` }])]);
  db = { collection: collection => ({ doc: id => ({ path: `${collection}/${id}`, get: async () => snap(`${collection}/${id}`, rows.get(`${collection}/${id}`)) }),
    where: (key, comparison, value) => ({ limit: () => ({ get: async () => {
      const docs = [...rows].filter(([p, d]) => p.startsWith(`${collection}/`) && comparison === '==' && d[key] === value).map(([p, d]) => snap(p, d));
      return { docs, size: docs.length };
    } }) }) }), runTransaction: async cb => {
    const pending = [];
    const result = await cb({ get: ref => ref.get(), set: (ref, value) => pending.push([ref.path, copy(value)]) });
    for (const [path, value] of pending) rows.set(path, value);
    return result;
  } };
});
const record = () => rows.get(`biker_quality_reports/${manualReviewId('worker', '2026-10')}`);
const source = () => ({ available: true, eligible: [...rows].filter(([p, d]) => p.startsWith('washes/') && d.biker_id === 'worker')
  .map(([p, d]) => ({ washId: p.split('/')[1], serviceDate: d.wash_date, sspBookingId: d.ssp_booking_id }))
  .sort((a, b) => a.serviceDate.localeCompare(b.serviceDate) || a.washId.localeCompare(b.washId)), excluded: [] });
const input = fields => ({ ...scope, revision: record()?.revision || 0, requestId: `request-${++serial}`, ...fields });
const save = (fields, operation = 'manual-note', uid = 'admin') => saveManualReview(db, { uid }, input(fields), operation);
const confirm = noCases => save({ cohortHash: manualReviewProjection(source(), record(), scope).cohortHash, acknowledged: true, noCases }, 'manual-confirm');

it('does not infer zero cases or ten points from an empty manual review or SSP timestamps', () => {
  const p = manualReviewProjection(source(), null, scope);
  expect(p.component).toMatchObject({ points: null, n: null, affected: null });
  expect(p.pendingWashes).toBe(20);
  expect(manualReviewProjection({ available: false }, null, scope).component.points).toBeNull();
});
it('saves multiple stages on one actual wash, reads them and counts one appointment once', async () => {
  await save({ washId: 'w-1', stages: ['arrival', 'start', 'end'], note: 'Explicit administrative review' });
  expect(record().notes).toHaveLength(1);
  expect(manualReviewProjection(source(), record(), scope).component.points).toBeNull();
  await confirm(false);
  expect(manualReviewProjection(source(), record(), scope).component).toMatchObject({ points: 5, n: 20, affected: 1 });
  expect(record().history).toHaveLength(2);
});
it('requires explicit zero confirmation before granting 10/10', async () => {
  await expect(confirm(false)).rejects.toThrow(/لا يطابق/);
  await confirm(true);
  expect(manualReviewProjection(source(), record(), scope).component).toMatchObject({ points: 10, n: 20, affected: 0 });
});
it('prevents duplicate washes and booking aliases without changing history', async () => {
  await save({ washId: 'w-1', stages: ['start'] });
  await expect(save({ washId: 'w-1', stages: ['end'] })).rejects.toMatchObject({ code: 'already-exists' });
  rows.set('washes/alias', { ...rows.get('washes/w-1') });
  await expect(save({ washId: 'alias', stages: ['end'] })).rejects.toMatchObject({ code: 'already-exists' });
  expect(record().history).toHaveLength(1);
});
it('makes exact retries idempotent and rejects reuse of a request ID with changed data', async () => {
  const data = input({ washId: 'w-1', stages: ['start'] });
  await saveManualReview(db, { uid: 'admin' }, data, 'manual-note');
  expect(await saveManualReview(db, { uid: 'admin' }, data, 'manual-note')).toMatchObject({ unchanged: true });
  await expect(saveManualReview(db, { uid: 'admin' }, { ...data, stages: ['end'] }, 'manual-note')).rejects.toMatchObject({ code: 'already-exists' });
  expect(record().history).toHaveLength(1);
});
it.each(['partner', 'unknown'])('rejects %s before learning worker existence', async uid => {
  await expect(save({ bikerUID: 'other', washId: 'w-1', stages: ['start'] }, 'manual-note', uid)).rejects.toBeTruthy();
  expect(record()).toBeUndefined();
});
it('rejects foreign workers, period/date mismatches, missing appointments and repeated stages', async () => {
  rows.set('washes/foreign', { ...rows.get('washes/w-1'), biker_id: 'other' });
  rows.set('washes/old', { ...rows.get('washes/w-1'), wash_date: '2026-09-12' });
  rows.set('washes/unlinked', { ...rows.get('washes/w-1'), ssp_booking_id: null });
  for (const washId of ['foreign', 'old', 'unlinked']) await expect(save({ washId, stages: ['start'] })).rejects.toBeTruthy();
  await expect(save({ washId: 'w-1', stages: ['start', 'start'] })).rejects.toBeTruthy();
  await expect(save({ washId: 'w-1', from: '2026-09-01', stages: ['start'] })).rejects.toBeTruthy();
  expect(record()).toBeUndefined();
});
it('invalidates confirmation on new washes, changed review ranges, or revised notes', async () => {
  await confirm(true);
  rows.set('washes/new', { ...rows.get('washes/w-1'), ssp_booking_id: 'S-new' });
  let p = manualReviewProjection(source(), record(), scope);
  expect(p.confirmed).toBe(false); expect(p.pendingWashes).toBe(1); expect(p.component.points).toBeNull();
  expect(manualReviewProjection(source(), record(), { ...scope, to: '2026-10-13' }).confirmed).toBe(false);
  await save({ washId: 'new', stages: ['start'] });
  expect(manualReviewProjection(source(), record(), scope).component.points).toBeNull();
});
it('records corrections and withdrawals as audited events, never hidden deletion', async () => {
  await save({ washId: 'w-1', stages: ['start'] }); await confirm(false);
  await expect(save({ washId: 'w-1', stages: [] }, 'manual-correct')).rejects.toThrow(/سبب التصحيح/);
  await save({ washId: 'w-1', stages: [], correctionReason: 'Verified review correction' }, 'manual-correct');
  expect(record().notes).toHaveLength(1); expect(record().notes[0].stages).toEqual([]);
  expect(record().history.at(-1).before.stages).toEqual(['start']);
  expect(manualReviewProjection(source(), record(), scope).component.points).toBeNull();
  await confirm(true);
  expect(manualReviewProjection(source(), record(), scope).component.points).toBe(10);
});
it('refuses a stale confirmation cohort and never changes business records', async () => {
  const before = JSON.stringify([...rows]);
  await expect(save({ cohortHash: 'a'.repeat(64), acknowledged: true, noCases: true }, 'manual-confirm')).rejects.toThrow(/تغيّر نطاق/);
  expect(JSON.stringify([...rows])).toBe(before);
});
