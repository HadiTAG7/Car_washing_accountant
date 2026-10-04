import { describe, it, expect } from 'vitest';
import { supervisorOverview, supervisorRecords } from '../src/supervisorRead.js';
import { supervisorFixture } from './fixtures/supervisor.js';
import { SUPERVISOR_COLLECTIONS, projectSupervisorRecord, SUPERVISOR_JOURNAL_LINE_FIELDS } from '../../src/lib/supervisorAccess.js';
function fakeDb(data) {
  return { collection: name => {
    let fields = [], count = Infinity, cursor = null;
    const q = { select(...f) { fields = f; return q; }, orderBy() { return q; }, limit(n) { count = n; return q; }, startAfter(id) { cursor = id; return q; },
      async get() { const rows = (data[name] || []).filter(r => !cursor || r.id > cursor).slice(0, count);
        return { size: rows.length, docs: rows.map(r => ({ id: r.id, data: () => Object.fromEntries(fields.filter(f => Object.hasOwn(r, f)).map(f => [f, r[f]])) })) }; },
    }; return q;
  } };
}
describe('supervisor server projections and pagination', () => {
  it.each(Object.keys(SUPERVISOR_COLLECTIONS))('deep projects %s without retaining unknown or compound scalar fields', collection => {
    const data = { secret: 'private-secret', id: 'injected' };
    for (const field of SUPERVISOR_COLLECTIONS[collection].fields) data[field] = { secret: 'private-nested-secret' };
    data.lines = [{ accountId: '4000', debit: 0, credit: 10, description: 'sale', secret: 'private-line', taxSnapshot: { token: 'private-token' } }];
    data.totals = { salary: 500, secret: 'private-total' };
    const projected = projectSupervisorRecord(collection, data, 'real');
    expect(projected.id).toBe('real');
    expect(JSON.stringify(projected)).not.toMatch(/private|secret|salary|taxSnapshot|injected/);
    expect(Object.keys(projected).every(k => k === 'id' || SUPERVISOR_COLLECTIONS[collection].fields.includes(k))).toBe(true);
    if (collection === 'journal_entries') {
      expect(Object.keys(projected.lines[0])).toEqual(SUPERVISOR_JOURNAL_LINE_FIELDS);
      expect(projected.lines[0]).toEqual({ accountId: '4000', debit: 0, credit: 10 });
    } else expect(projected.lines).toBeUndefined();
    expect(projected.totals).toBeUndefined();
  });
  it.each([NaN, Infinity, -Infinity])('nulls non-finite scalar and nested financial values %s', value => {
    expect(projectSupervisorRecord('washes', { price: value }, 'x').price).toBeNull();
    expect(projectSupervisorRecord('journal_entries', { lines: [{ debit: value }] }, 'x').lines[0].debit).toBeNull();
  });
  it.each(Object.keys(SUPERVISOR_COLLECTIONS))('excludes sensitive free text from %s regardless of string type', collection => {
    const data = { notes: 'private-medical-note', note: 'private-note', description: 'private-phone', reason: 'private-investigation', title: 'private-advance-reason', lines: [{ accountId: '4000', debit: 0, credit: 10, description: 'private-line-note' }] };
    const projected = projectSupervisorRecord(collection, data, 'real');
    expect(JSON.stringify(projected)).not.toMatch(/private|description|notes|reason|title/);
  });
  it('projects away identity and credentials before returning data', async () => {
    const r = await supervisorRecords(fakeDb(supervisorFixture()), { collection: 'bikers' });
    expect(r.rows[0]).toMatchObject({ id: 'b1', name: 'عامل تجريبي' }); expect(JSON.stringify(r)).not.toMatch(/private|salary|contact_number|iqama/);
  });
  it('has bounded pages and declares uncovered next pages', async () => {
    const db = fakeDb({ bikers: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
    const first = await supervisorRecords(db, { collection: 'bikers', limit: 2 });
    expect(first.nextCursor).toBe('b'); expect(first.hasMore).toBe(true); expect(first.rows).toHaveLength(2);
    const next = await supervisorRecords(db, { collection: 'bikers', limit: 2, cursor: first.nextCursor });
    expect(next.rows.map(r => r.id)).toEqual(['c']); expect(next.hasMore).toBe(false);
  });
  it.each(['users', 'auth_users_backup', 'app_admins', 'partner_mcp_keys', 'sweater_integration_keys', 'constructor', '__proto__', 'bikers/b1'])('denies arbitrary/private path %s', async collection => { await expect(supervisorRecords(fakeDb({}), { collection })).rejects.toMatchObject({ code: 'invalid-argument' }); });
  it.each([0, 101, -1, 1.5, '50'])('rejects invalid limit %s', async limit => { await expect(supervisorRecords(fakeDb({}), { collection: 'bikers', limit })).rejects.toMatchObject({ code: 'invalid-argument' }); });
  it('uses document identity rather than an injected id field', async () => {
    expect((await supervisorRecords(fakeDb({ bikers: [{ id: 'real' }] }), { collection: 'bikers' })).rows[0].id).toBe('real');
  });
  it('declares source coverage and returns only curated report data', async () => {
    const r = await supervisorOverview(fakeDb(supervisorFixture()), { periodKey: '2026-08' });
    expect(r.share.referenceAmount).toBe(40); expect(r.sources.every(s => s.complete)).toBe(true); expect(JSON.stringify(r)).not.toMatch(/private-phone|private-id/);
  });
  it('rejects future/unbounded overview requests', async () => { await expect(supervisorOverview(fakeDb({}), { periodKey: '2999-12' })).rejects.toMatchObject({ code: 'invalid-argument' }); });
  it('propagates a failed source instead of computing zero', async () => { await expect(supervisorOverview({ collection: () => ({ select: () => ({ get: async () => { throw new Error('unavailable'); } }) }) }, { periodKey: '2026-08' })).rejects.toThrow('unavailable'); });
  it('has no identity or auth collections in the allowlist', () => { expect(Object.keys(SUPERVISOR_COLLECTIONS)).not.toContain('users'); });
});
