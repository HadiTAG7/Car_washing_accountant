import { describe, expect, it, vi } from 'vitest';
import { dispatch } from '../src/handlers.js';
import { hashBody, hashRecord, normalizeRecord } from '../src/sweater/record.js';
import { reviewSweaterHandoff } from '../../src/lib/sweater/handoff.js';

const record = (id = 'B-1', extra = {}) => ({ sspBookingId: id, serviceType: 'interior_exterior_wash',
  serviceDate: '2026-10-04', rawStatus: 'Washing Started', ...extra });
const payload = (records = [record()], extra = {}) => ({ importRunId: 'review-2026-10-04', dryRun: true,
  coverage: { rangeFrom: '2026-10-04', rangeTo: '2026-10-04', extractedAt: '2026-10-04T10:00:00Z',
    pageCount: 1, pagesFetched: 1, recordCount: records.length, isComplete: true }, records, ...extra });
function readOnlyDb(role = 'accountant', collections = {}) {
  const rows = { users: { staff: { role } }, ...collections };
  const write = vi.fn(() => { throw new Error('No writes allowed'); });
  return { write, batch: write, runTransaction: write, collection: name => ({ doc: id => ({
    get: async () => ({ exists: Object.hasOwn(rows[name] || {}, id), data: () => rows[name]?.[id] }),
    set: write, update: write, delete: write, create: write,
  }) }) };
}
const preview = (db, body, auth = { uid: 'staff' }) => dispatch(db, null, 'sweaterPreviewImport', body, auth);

describe('مراجعة التسليم ومعاينة SSP بلا كتابة', () => {
  it.each(['admin', 'accountant'])('هوية %s الحالية تعاين دون مفتاح تكامل أو أي كتابة', async role => {
    const db = readOnlyDb(role);
    const result = await preview(db, payload());
    expect(result).toMatchObject({ dryRun: true, replay: false, counts: { new: 1 }, previousRun: null });
    expect(result.reviewedPayloadHash).toBe(hashBody(reviewSweaterHandoff(payload()).payload));
    expect(db.write).not.toHaveBeenCalled();
  });
  it.each(['operator', 'partner', 'integration_ingest'])('لا يوسع صلاحيات %s', async role => {
    await expect(preview(readOnlyDb(role), payload())).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it('الجلسة الغائبة مرفوضة ولا يتيح طلب dryRun:false استيراداً', async () => {
    await expect(preview(readOnlyDb(), payload(), null)).rejects.toMatchObject({ code: 'unauthenticated' });
    const db = readOnlyDb();
    await expect(preview(db, payload(undefined, { dryRun: false }))).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(db.write).not.toHaveBeenCalled();
  });
  it('العينة المرئية بلا نوع خدمة تُحجب كلها ولا تخمّن من S/B أو الحالة', async () => {
    const records = ['S-SYNTHETIC-1', 'S-SYNTHETIC-2', 'B-SYNTHETIC-3', 'B-SYNTHETIC-4', 'B-SYNTHETIC-5'].map((id, i) => {
      const row = record(id, { rawStatus: ['Collecting Payment', 'Collecting Payment', 'Washing Started', 'Initiated', 'Initiated'][i] });
      delete row.serviceType; return row;
    });
    const review = reviewSweaterHandoff(payload(records));
    expect(review.ready).toBe(false); expect(review.payload).toBeNull();
    expect(review.rows.every(row => row.problems.some(p => p.code === 'unknown_service_type'))).toBe(true);
    const db = readOnlyDb();
    await expect(preview(db, payload(records))).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(db.write).not.toHaveBeenCalled();
  });
  it('يحفظ الحالات الحية حرفياً ويكشف غير المعروف دون إقرار إيراد', async () => {
    const records = [record('S-1', { rawStatus: 'Collecting Payment' }), record('B-2', { rawStatus: 'Initiated' }), record('B-3')];
    const before = structuredClone(records);
    const review = reviewSweaterHandoff(payload(records));
    expect(review.rows.map(row => row.status)).toEqual(['payment_collection', 'unknown', 'washing_started']);
    const result = await preview(readOnlyDb(), payload(records));
    expect(result.statusReviewRows).toEqual([2]);
    expect(records).toEqual(before);
    expect(result).not.toHaveProperty('revenue'); expect(result).not.toHaveProperty('journalEntry');
  });
  it('يعاين التكرار والتعديل بعد الترحيل والتكرار المتعارض دون تغيير الموجود', async () => {
    const original = record(); const hash = hashRecord(normalizeRecord(original));
    const db = readOnlyDb('accountant', { sweater_bookings: { 'B-1': { sourceHash: hash }, 'B-2': {
      sourceHash: hash, processingStatus: 'posted', postedEntryId: 'JE-1',
    } } });
    const result = await preview(db, payload([original, original, record('B-2'), record('B-3'), record('B-3', { rawStatus: 'Initiated' })]));
    expect(result.counts).toEqual({ new: 1, modified: 0, duplicate: 2, rejected: 0, needsReview: 2 });
    expect(result.rows.map(row => row.reasonCode)).toContain('duplicate_conflict');
    expect(result.rows.map(row => row.reasonCode)).toContain('modified_after_posting');
    expect(db.write).not.toHaveBeenCalled();
  });
  it('إعادة المعاينة ثابتة، ومعرّف موجود بسجلات مختلفة يرفض 409', async () => {
    const body = payload(); const db = readOnlyDb('accountant', { sweater_import_runs: {
      [body.importRunId]: { bodyHash: hashBody(body.records), status: 'completed' },
    } });
    const first = await preview(db, body); const second = await preview(db, body);
    expect(second).toEqual(first); expect(first.previousRun).toEqual({ sameRecords: true, status: 'completed' });
    await expect(preview(db, payload([record('other')]))).rejects.toMatchObject({ code: 'already-exists' });
    expect(db.write).not.toHaveBeenCalled();
  });
  it.each([
    record('bad', { cookie: 'never-transfer' }), record('bad', { customerPhone: 'forbidden' }),
    record('bad', { netAmount: 10 }), record('bad', { serviceDate: '2026-02-30' }),
    record('bad', { serviceDate: '2026-10-05' }), record('bad', { sourceUrl: 'https://example.test/?token=forbidden' }),
  ])('يحجب الحقول الممنوعة والتواريخ غير الصحيحة قبل أي إرسال', async row => {
    const body = payload([row]); expect(reviewSweaterHandoff(body).ready).toBe(false);
    const db = readOnlyDb(); await expect(preview(db, body)).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(db.write).not.toHaveBeenCalled();
  });
  it('لا يسقط صفحة ناقصة أو يخفي تناقض عدد الصفوف أو سرّ الجسم', () => {
    const body = payload();
    expect(reviewSweaterHandoff({ ...body, cookie: 'forbidden' }).ready).toBe(false);
    expect(reviewSweaterHandoff({ ...body, coverage: { ...body.coverage, recordCount: 2 } }).ready).toBe(false);
    expect(reviewSweaterHandoff({ ...body, coverage: { ...body.coverage, pageCount: 2 } }).ready).toBe(false);
    const incomplete = reviewSweaterHandoff({ ...body, coverage: { ...body.coverage, pageCount: 2, isComplete: false } });
    expect(incomplete.ready).toBe(true); expect(incomplete.warnings.length).toBeGreaterThan(0);
  });
  it('يدعم الملف الفارغ بصدق ويحجب أكثر من 500 صف أو دفعة heartbeat', () => {
    expect(reviewSweaterHandoff(payload([])).ready).toBe(true);
    expect(reviewSweaterHandoff(payload(Array.from({ length: 501 }, () => record()))).ready).toBe(false);
    expect(reviewSweaterHandoff(payload(undefined, { mode: 'heartbeat' })).ready).toBe(false);
  });
});
