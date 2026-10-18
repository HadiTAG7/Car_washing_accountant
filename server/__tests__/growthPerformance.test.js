import { describe, expect, it, vi } from 'vitest';
import { projectGrowth, readGrowthPerformance, validateGrowthRequest } from '../growthPerformance.js';
import { createGrowthHandler } from '../../api/growth-performance.js';

const roster = { at: '2026-10-18T18:12:10Z', rows: [{ code: '1984', region: 'Muroj', status: 'Active' }] };
const worker = { id: 'uid-a', driver_external_id: '1984', name: 'Worker', name_ar: 'عامل', contact_number: 'PRIVATE', salary: 900 };
const booking = (id, date = '2026-10-17') => ({ id, sspBookingId: id, operationalWorkerId: 'uid-a', serviceDate: date,
  record: { bookingKind: 'individual', driverExternalId: '1984', normalizedStatus: 'payment_collection',
    startedAt: `${date}T12:00:00+03:00`, completedAt: `${date}T13:00:00+03:00` } });
const wash = (id, date = '2026-10-17') => ({ id: `ssp__${id}`, ssp_booking_id: id, biker_id: 'uid-a', wash_date: date, quantity: 1, status: 'مكتملة' });
const run = { status: 'completed_with_gaps', coverage: { rangeFrom: '2026-10-10', rangeTo: '2026-10-20',
  pageCount: 2, pagesFetched: 2, modules: { individual: 'complete', corporate: 'partial' } } };
const project = overrides => projectGrowth({ workers: [worker], washes: [wash('S-1')], bookings: [booking('S-1')],
  runs: [run], from: '2026-10-17', to: '2026-10-17', lookback: '2026-10-16', roster, ...overrides });

describe('read-only administrative growth adapter', () => {
  it('uses linked completed services, source coverage, and a dated roster; strips private fields', () => {
    const result = project();
    expect(result.workers[0].days).toEqual([
      expect.objectContaining({ date: '2026-10-16', count: 0, coverage: 'complete', workEligible: null }),
      expect.objectContaining({ date: '2026-10-17', count: 1, coverage: 'complete', workEligible: true }),
    ]);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|salary|900/);
    expect(result.roster.at).toBe(roster.at);
  });
  it('does not promote payment collection alone, or a zero count without coverage, to completion', () => {
    const result = project({ washes: [], runs: [] });
    expect(result.workers[0].days.at(-1)).toMatchObject({ count: null, coverage: 'partial', workEligible: null });
    expect(result.gaps).toHaveLength(1);
  });
  it('keeps known corporate services separate without invalidating complete individual coverage', () => {
    const corporate = booking('C-other'); corporate.record.bookingKind = 'corporate';
    const result = project({ washes: [wash('S-1'), wash('C-other')], bookings: [booking('S-1'), corporate] });
    expect(result.workers[0].days.at(-1)).toMatchObject({ count: 1, coverage: 'complete', assigned: 1 });
  });
  it('never joins conflicting worker identities through an OR match', () => {
    const result = project({ bookings: [{ ...booking('S-1'), operationalWorkerId: 'other-worker' }] });
    expect(result.workers[0].days.at(-1)).toMatchObject({ count: null, coverage: 'partial', workEligible: null });
    expect(project({ washes: [{ ...wash('S-1'), driver_external_id: '1986' }] }).workers[0].days.at(-1))
      .toMatchObject({ count: null, coverage: 'partial', workEligible: null });
  });
  it('does not infer attendance on a zero day and retains a partial recorded positive', () => {
    expect(project({ runs: [] }).workers[0].days.at(-1)).toMatchObject({ count: 1, coverage: 'partial', workEligible: null });
  });
  it('excludes the known conflict analytically without modifying the original', () => {
    const washes = [wash('C-5584720')];
    const before = JSON.stringify(washes);
    const result = project({ washes, bookings: [booking('C-5584720')] });
    expect(result.exclusions[0].reference).toBe('C-5584720');
    expect(result.workers[0].days.at(-1)).toMatchObject({ registered: 1, coverage: 'partial', workEligible: null });
    expect(JSON.stringify(washes)).toBe(before);
  });
  it('fails closed on ambiguous identities; preserves missing Active workers', () => {
    expect(() => project({ workers: [worker, { ...worker, id: 'uid-b' }] })).toThrow(/ملتبس/);
    expect(project({ workers: [] }).workers[0]).toMatchObject({ code: '1984', status: 'Active' });
    expect(project({ workers: [] }).workers[0].days.every(d => d.count == null)).toBe(true);
  });
  it('de-duplicates exact execution IDs and marks ambiguous duplicates partial', () => {
    expect(project({ washes: [wash('S-1'), { ...wash('S-1'), id: 'duplicate' }] }).workers[0].days.at(-1))
      .toMatchObject({ count: 1, coverage: 'partial', workEligible: null });
  });
  it('resolves only the evidenced legacy singleton, including its assignment denominator', () => {
    const current = booking('S-5596423', '2026-10-10'); current.record.driverExternalId = '1986';
    const legacy = { ...current, sspBookingId:'B-5596423', record:{...current.record,normalizedStatus:'unknown',startedAt:null,completedAt:null} };
    const input = { from:'2026-10-10',to:'2026-10-10',lookback:'2026-10-09',
      roster:{...roster,rows:[{code:'1986',region:'Wurood',status:'Active'}]},
      workers:[{...worker,driver_external_id:'1986'}], bookings:[current,legacy], washes:[wash('B-5596423','2026-10-10')] };
    expect(project(input).workers[0].days.at(-1)).toMatchObject({count:1,assigned:1,coverage:'complete',workEligible:true});
    expect(project({...input,washes:[{...input.washes[0],id:'unproven-alias'}]}).workers[0].days.at(-1))
      .toMatchObject({count:null,coverage:'partial'});
  });
  it.each(['partner', 'accountant', 'operator', 'supervisor', null])('rejects %s before performance reads', async role => {
    const names = [];
    const db = { collection: name => { names.push(name); if (!['users', 'app_admins'].includes(name)) throw new Error('data read');
      return { doc: () => ({ get: async () => ({ exists: name === 'users', data: () => ({ role }) }) }) }; } };
    await expect(readGrowthPerformance(db, { uid: 'caller' }, {})).rejects.toMatchObject({ code: 'permission-denied' });
    expect(names).not.toContain('washes');
  });
  it('rejects future/invalid/oversized periods and unknown request keys', () => {
    const now = new Date('2026-10-18T12:00:00Z');
    for (const input of [{ from: '2026-02-30', to: '2026-10-17' }, { from: '2026-01-01', to: '2026-10-17' },
      { from: '2026-10-18', to: '2026-10-18' }, { from: '2026-10-17', to: '2026-10-17', role: 'admin' }]) {
      expect(() => validateGrowthRequest(input, now)).toThrow();
    }
    expect(validateGrowthRequest({ from: '2026-10-17', to: '2026-10-17' }, now).lookback).toBe('2026-09-17');
  });
  it('does not filter a covering run out just because it ends after to, and bounds every query', async () => {
    const whereCalls = [], limits = [];
    const rows = { bikers: [worker], washes: [wash('S-1')], sweater_bookings: [booking('S-1')], sweater_import_runs: [run] };
    const db = { collection: name => {
      if (['users', 'app_admins'].includes(name)) return { doc: () => ({ get: async () => ({ exists: name === 'users', data: () => ({ role: 'admin' }) }) }) };
      const query = { where: (...args) => { whereCalls.push([name, ...args]); return query; }, select: () => query,
        limit: n => { limits.push(n); return query; }, get: async () => ({ size: rows[name].length, docs: rows[name].map((r, i) => ({ id: r.id || `${i}`, data: () => r })) }) };
      return query;
    } };
    const result = await readGrowthPerformance(db, { uid: 'admin' }, { from: '2026-10-17', to: '2026-10-17' });
    expect(whereCalls.some(([name, field, op]) => name === 'sweater_import_runs' && field === 'coverage.rangeTo' && op === '<')).toBe(false);
    expect(limits).toEqual([31, 3001, 3001, 201]);
    expect(result.workers.find(w => w.code === '1984').days.at(-1).coverage).toBe('complete');
  });
  it('transport requires a token, checks revocation and never exposes runtime failures', async () => {
    const runtime = vi.fn(() => { throw new Error('secret'); });
    const response = () => ({ setHeader: vi.fn(), status: vi.fn(function (code) { this.code = code; return this; }), json: vi.fn(function (body) { this.body = body; return this; }) });
    const a = response(); await createGrowthHandler(runtime)({ method: 'POST', headers: {} }, a);
    expect(a.code).toBe(401); expect(runtime).not.toHaveBeenCalled();
    const b = response(); await createGrowthHandler(runtime)({ method: 'POST', headers: { authorization: 'Bearer token' } }, b);
    expect(b.code).toBe(503); expect(JSON.stringify(b.body)).not.toContain('secret');
    const verifyIdToken = vi.fn().mockRejectedValue(new Error('bad token'));
    const c = response(); await createGrowthHandler(() => ({ auth: { verifyIdToken } }))({ method: 'POST', headers: { authorization: 'Bearer token' } }, c);
    expect(c.code).toBe(401); expect(verifyIdToken).toHaveBeenCalledWith('token', true);
  });
});
