import { describe, expect, it } from 'vitest';
import { previewOperations, saveOperations } from '../src/sweater/operationsSync.js';
import { followUpFor, syncWindow, openBookingsStatus, previewStoredReadings, applyStoredReadings } from '../src/sweater/openBookings.js';
import { syncPlan, coverageGaps } from '../../scripts/lib/sweater-operations-client.mjs';
import { HANDLERS } from '../src/handlers.js';
import { syncDb, syncFV, syncPayload, syncRequest } from './helpers/sweaterOperationsFixture.js';

const save = async (db, payload) => saveOperations(db, syncFV, syncRequest(payload, await previewOperations(db, payload)), 'synthetic-agent');
function reading(id, status, cut, fields = {}) {
  const p = syncPayload(); p.importRunId = id; p.coverage.extractedAt = `2026-10-08T${cut}:00+03:00`;
  p.records[0] = { ...p.records[0], sspBookingId: 'B-990801', rawStatus: status, serviceType: 'interior_exterior_wash', ...fields };
  return p;
}
const done = () => reading('synthetic-done', 'Collecting Payment', '22:00',
  { sspBookingId: 'S-990801', startedAt: '2026-10-08T21:08:00+03:00', completedAt: '2026-10-08T21:50:00+03:00' });
const open = (n, date, status = 'On the Way') => ({ bookingNumber: n, serviceDate: date, rawStatus: status, observedAtIso: '2026-10-31T10:00:00Z' });

describe('every sync: the last 3 days and every booking still open in Sweater', () => {
  it('the window is today in Riyadh and the two days before', () => {
    expect(syncWindow(new Date('2026-10-31T21:04:00Z'))).toEqual({ rangeFrom: '2026-10-30', rangeTo: '2026-11-01', days: 3 });
    expect(syncWindow(new Date('2026-10-31T20:59:00Z'))).toEqual({ rangeFrom: '2026-10-29', rangeTo: '2026-10-31', days: 3 });
  });

  it('tells the next run what to read: older open bookings by number, and what this run left out', () => {
    const now = new Date('2026-10-31T21:04:00Z');
    const plan = followUpFor([open('5676193', '2026-10-30'), open('5650001', '2026-10-20', 'Initiated'), open('5690001', '2026-11-01')], {
      now, payload: { records: [{ sspBookingId: 'B-5690001' }] } });
    expect(plan).toMatchObject({ contract: 'sweater-followup-v1', window: { rangeFrom: '2026-10-30', rangeTo: '2026-11-01' },
      rechecks: ['5650001'], openInWindow: ['5676193', '5690001'] });
    expect(plan.openNotInThisRun.map(b => b.bookingNumber)).toEqual(['5676193', '5650001']);
    // The agent's command says it before saving a run that reads one day and skips open bookings.
    const gaps = coverageGaps({ coverage: { rangeFrom: '2026-11-01', rangeTo: '2026-11-01' }, records: [{ sspBookingId: 'B-5690001' }] }, plan);
    expect(gaps[0]).toContain('every run must read 2026-10-30..2026-11-01');
    expect(gaps[1]).toContain('2 booking(s) still open in Sweater are not in this run: 5650001, 5676193');
    expect(coverageGaps({ coverage: { rangeFrom: '2026-10-30', rangeTo: '2026-11-01' },
      records: ['B-5690001', 'B-5676193', 'B-5650001'].map(sspBookingId => ({ sspBookingId })) }, plan)).toEqual([]);
  });

  it('the plan comes from the signed, read-only open-bookings list', async () => {
    const calls = [];
    const request = async body => { calls.push(body); return { bookings: [open('5650001', '2026-10-20', 'Initiated')] }; };
    const plan = await syncPlan({ request, now: new Date('2026-10-31T21:04:00Z') });
    expect(calls).toEqual([{ action: 'pending', payload: { contract: 'sweater-pending-v1', importRunId: 'pending-20261031210400' } }]);
    expect(plan.rechecks).toEqual(['5650001']);
  });

  it('shows the owner the last sync window and the open bookings it did not re-read', async () => {
    const db = syncDb(); await save(db, reading('synthetic-way', 'On the Way', '21:00'));
    const status = await openBookingsStatus(db, new Date('2026-10-08T23:00:00+03:00'));
    expect(status).toMatchObject({ required: { rangeFrom: '2026-10-06', rangeTo: '2026-10-08', days: 3 },
      lastSync: { runId: 'synthetic-way', rangeFrom: '2026-10-08', rangeTo: '2026-10-08', days: 1 } });
    expect(status.open).toEqual([expect.objectContaining({ bookingNumber: '990801', rawStatus: 'On the Way', rereadInLastSync: true, hoursSinceRead: 2 })]);
    expect(status.notReread).toEqual([]);
    // A later run that reads other bookings only: this one was not re-read.
    const other = syncPayload(); other.importRunId = 'synthetic-other'; other.coverage.extractedAt = '2026-10-08T22:30:00+03:00';
    other.records[0] = { ...other.records[0], sspBookingId: 'B-990802', rawStatus: 'Initiated' };
    await save(db, other);
    expect((await openBookingsStatus(db, new Date('2026-10-08T23:00:00+03:00'))).notReread.map(b => b.bookingNumber)).toEqual(['990801']);
  });
});

describe('«قراءات سويتر المحفوظة»: a newer reading Sweater sent that never reached its booking', () => {
  // The booking keeps its open reading; the final reading arrived in an earlier run and is stored raw only.
  async function stuck() {
    const db = syncDb(); await save(db, reading('synthetic-initiated', 'Initiated', '20:00'));
    await save(db, reading('synthetic-way', 'On the Way', '21:00'));
    const elsewhere = syncDb(); await save(elsewhere, done());
    for (const [path, value] of elsewhere.rows) if (/^sweater_(raw_payloads|import_runs)\//.test(path)) db.rows.set(path, value);
    return db;
  }

  it('is admin-only; staff see the open bookings status', () => {
    expect(HANDLERS.sweaterStoredReadingsPreview.guard).toBe('admin');
    expect(HANDLERS.sweaterStoredReadingsApply.guard).toBe('admin');
    expect(HANDLERS.sweaterOpenBookingsStatus.guard).toBe('accountant');
  });

  it('previews without writing, then records the wash through the normal sync path with a reason, and only once', async () => {
    const db = await stuck(), writes = db.writes.length;
    const p = await previewStoredReadings(db);
    expect(db.writes.length).toBe(writes);
    expect(p.rows).toEqual([expect.objectContaining({ number: '990801', recordsWash: true,
      current: expect.objectContaining({ rawStatus: 'On the Way' }), stored: expect.objectContaining({ sspBookingId: 'S-990801', rawStatus: 'Collecting Payment',
        runId: 'synthetic-done' }) })]);
    await expect(applyStoredReadings(db, syncFV, { reason: '', previewHash: p.previewHash }, 'owner-1')).rejects.toThrow('اكتب سبب التطبيق');
    await expect(applyStoredReadings(db, syncFV, { reason: 'x', previewHash: 'stale' }, 'owner-1')).rejects.toThrow('أعد المعاينة');
    const stateBefore = structuredClone(db.rows.get('sweater_integration_state/current'));
    const r = await applyStoredReadings(db, syncFV, { reason: 'غسلة أنهاها سويتر بعد قراءتها الأولى', previewHash: p.previewHash }, 'owner-1');
    expect(r).toMatchObject({ applied: 1, washesCreated: 1, stillDeciding: [], ledgerPosted: false });
    expect(db.rows.get('washes/ssp__B-990801')).toMatchObject({ ssp_booking_id: 'S-990801', biker_id: 'worker-1', worker_commission_per_wash: 4.5 });
    expect(db.rows.get('sweater_bookings/990801')).toMatchObject({ processingStatus: 'validated', record: { rawStatus: 'Collecting Payment' } });
    // A replay run, marked as such; «آخر مزامنة» stays the agent's.
    expect(db.rows.get('sweater_import_runs/replay-990801-synthetic-done')).toMatchObject({ replayOf: { runId: 'synthetic-done', requestedBy: 'owner-1' } });
    expect(db.rows.get('sweater_integration_state/current')).toEqual(stateBefore);
    const audit = [...db.rows].filter(([k]) => k.startsWith('audit_logs/')).map(([, v]) => v);
    expect(audit).toEqual([expect.objectContaining({ action: 'sweater.storedReadingReplay', documentId: '990801', userId: 'owner-1',
      reason: 'غسلة أنهاها سويتر بعد قراءتها الأولى', after: expect.objectContaining({ washCreated: true, washId: 'ssp__B-990801' }) })]);
    expect((await previewStoredReadings(db)).rows).toEqual([]);
    expect([...db.rows.keys()].filter(k => k.startsWith('washes/'))).toHaveLength(1);
  });

  it('ignores a stored reading older than the booking\'s, and bookings already final', async () => {
    const db = syncDb(); await save(db, done());
    await save(db, reading('synthetic-old', 'On the Way', '21:00'));
    expect((await previewStoredReadings(db)).rows).toEqual([]);
  });
});
