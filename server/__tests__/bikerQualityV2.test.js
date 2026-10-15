import { expect, it } from 'vitest';
import { normalizeQualityReport, qualityReportId, saveQualityReports } from '../bikerQualityReports.js';

const proof = () => ({ reference: 'SSP verified dated review / isolated fixture', hash: 'b'.repeat(64), readDate: '2026-10-15' });
export const qualityV2Input = () => ({ bikerUID: 'test-worker', periodKey: '2026-10', from: '2026-10-01', to: '2026-10-14',
  rulesVersion: 'cqo-20261015-v2', sourceReadDate: '2026-10-15', snapshotAt: '2026-10-15T09:00:00Z',
  sourceIdentity: { externalId: '1984', sspId: '1320' }, samples: [], improvement: 'Review evidence; no employment or financial decision.',
  evidence: { ratings: [
    { from: '2026-10-10', to: '2026-10-10', wash: { mean: 5, n: 2 }, behavior: { mean: 5, n: 2 }, source: proof() },
    { from: '2026-10-11', to: '2026-10-11', wash: { mean: 1, n: 2 }, behavior: { mean: 1, n: 2 }, source: proof() },
  ] } });
it('saves separate weighted partial wash/behavior evidence, not a fabricated final or rescaled 100', () => {
  const r = normalizeQualityReport(qualityV2Input());
  expect(r.components.find(c => c.key === 'washQuality')).toMatchObject({ points: 18, n: 4, approximate: true });
  expect(r.components.find(c => c.key === 'behavior')).toMatchObject({ points: 12, n: 4, approximate: true });
  expect(r.availablePoints).toBe(30); expect(r.availableWeight).toBe(50); expect(r.finalScore).toBeNull();
  expect(r.components).toHaveLength(8);
});
it('weights source segments by their separate n and keeps rounded source precision explicit', () => {
  const input = qualityV2Input(); input.evidence.ratings[0].wash = { mean: 3.83, n: 12 };
  const r = normalizeQualityReport(input); const c = r.components.find(c => c.key === 'washQuality');
  expect(c.points).toBeCloseTo((3.83 * 12 + 1 * 2) / 14 / 5 * 30, 2); expect(c.approximate).toBe(true);
});
it('rejects overlapping aggregate/detail ranges, duplicate samples, fake final scores and unapproved rule inputs', () => {
  const input = qualityV2Input();
  for (const changed of [ { finalScore: 100 }, { penaltyCurve: 'invented' },
    { evidence: { ratings: [input.evidence.ratings[0], input.evidence.ratings[0]] } },
    { evidence: { ratings: [{ ...input.evidence.ratings[0], from: '2026-10-09', to: '2026-10-12' }, input.evidence.ratings[1]] } },
    { evidence: { ratings: [{ ...input.evidence.ratings[0], from: '2026-09-10' }] } },
    { evidence: { ratings: [{ ...input.evidence.ratings[0], wash: { mean: 5, n: 0 } }] } },
  ]) expect(() => normalizeQualityReport({ ...input, ...changed })).toThrow();
});
it('retains no-sample as missing, not zero or complete points', () => {
  const r = normalizeQualityReport({ ...qualityV2Input(), evidence: {} });
  expect(r.availablePoints).toBeNull(); expect(r.availableWeight).toBe(0); expect(r.finalScore).toBeNull();
  expect(r.components.every(c => c.points === null)).toBe(true);
});
it('requires verified working days, including zero-service days, not days inferred from washes', () => {
  const input = qualityV2Input(); input.evidence.productivity = { workDays: ['2026-10-10', '2026-10-11'], completed: [], source: proof() };
  const r = normalizeQualityReport(input);
  expect(r.components.find(c => c.key === 'productivity')).toMatchObject({ points: 0, n: 2 });
  expect(() => normalizeQualityReport({ ...input, evidence: { productivity: { ...input.evidence.productivity, washDays: 2 } } })).toThrow();
});
it('counts an explicitly reviewed appointment once even when several updates were forgotten', () => {
  const input = qualityV2Input(); input.evidence.updates = { reviews: Array.from({ length: 20 }, (_, i) => ({
    washId: `wash-${i}`, serviceDate: '2026-10-10', appointmentId: `appt-${i}`, forgotten: i === 0 ? ['arrival', 'start', 'end'] : [],
    evidenceType: 'explicit-status-review', source: proof(),
  })) };
  const r = normalizeQualityReport(input);
  expect(r.components.find(c => c.key === 'statusUpdates')).toMatchObject({ points: 5, n: 20, affected: 1 });
  input.evidence.updates.reviews[0].evidenceType = 'missing-timestamps';
  expect(() => normalizeQualityReport(input)).toThrow();
});
it('stores attributed rate evidence without applying an unapproved penalty curve', () => {
  const input = qualityV2Input(); input.evidence.complaints = { eligible: [{ id: 'wash-1', serviceDate: '2026-10-10' }], attributedIds: [], source: proof() };
  const r = normalizeQualityReport(input);
  expect(r.components.find(c => c.key === 'complaints')).toMatchObject({ points: null, n: 1, affected: 0, reason: 'awaiting-approved-rule' });
  expect(r.finalScore).toBeNull();
});
it('uses immutable dated v2 snapshot keys while retaining the old v1 key', () => {
  const r = normalizeQualityReport(qualityV2Input());
  expect(qualityReportId(r)).not.toBe(qualityReportId({ ...r, snapshotAt: '2026-10-15T10:00:00.000Z' }));
  expect(qualityReportId({ ...r, rulesVersion: 'cqo-20261014-v1' })).toBe('test-worker__2026-10-01__2026-10-14__cqo-20261014-v1');
});
it('rejects false precision, missing source identity, future proof and ineligible rate attribution', () => {
  const input = qualityV2Input();
  for (const changed of [
    { evidence: { ratings: [{ ...input.evidence.ratings[0], wash: { mean: 3.836, n: 2 } }] } },
    { sourceIdentity: { externalId: null, sspId: '1320' } },
    { sourceIdentity: { externalId: '1984', sspId: null } },
    { evidence: { productivity: { workDays: ['2026-10-14'], completed: [], source: { ...proof(), readDate: '2026-10-10' } } } },
    { evidence: { cancellations: { eligible: [], attributedIds: ['not-eligible'], source: proof() } } },
  ]) expect(() => normalizeQualityReport({ ...input, ...changed })).toThrow();
});
it('validates worker identity and canonical update appointment before any atomic creation', async () => {
  const input = qualityV2Input();
  input.evidence.updates = { reviews: [{ washId: 'wash-a', serviceDate: '2026-10-10', appointmentId: 'booking-a', forgotten: [],
    evidenceType: 'explicit-status-review', source: proof() }] };
  const rows = new Map([['users/admin', { role: 'admin' }], ['bikers/test-worker', { start_date: '2026-08-01', driver_external_id: '1984' }],
    ['washes/wash-a', { biker_id: 'test-worker', wash_date: '2026-10-10', quantity: 1, status: 'مكتملة', ssp_booking_id: 'wrong-booking' }]]);
  const db = { collection: name => ({ doc: id => ({ path: `${name}/${id}`, get: async () => ({ exists: rows.has(`${name}/${id}`), data: () => rows.get(`${name}/${id}`) }) }) }),
    runTransaction: callback => callback({ get: ref => ref.get(), create: (ref, data) => rows.set(ref.path, data) }) };
  const before = JSON.stringify([...rows]);
  await expect(saveQualityReports(db, { uid: 'admin' }, { reports: [input] })).rejects.toThrow(/موعد/);
  expect(JSON.stringify([...rows])).toBe(before);
  rows.get('washes/wash-a').ssp_booking_id = 'booking-a';
  await expect(saveQualityReports(db, { uid: 'admin' }, { reports: [{ ...input, sourceIdentity: { externalId: 'other', sspId: '1320' } }] })).rejects.toThrow(/هوية/);
  expect((await saveQualityReports(db, { uid: 'admin' }, { reports: [input] })).created).toBe(1);
  const saved = rows.get(`biker_quality_reports/${qualityReportId(input)}`);
  expect(saved.components.find(c => c.key === 'statusUpdates')).toMatchObject({ points: 10, n: 1, affected: 0 });
  expect(saved.finalScore).toBeNull();
});
