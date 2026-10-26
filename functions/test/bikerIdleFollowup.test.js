import { describe, it, expect } from 'vitest';
import { saveBikerIdleFollowup } from '../src/bikerIdleFollowup.js';
import { dispatch } from '../src/handlers.js';
const fv = { serverTimestamp: () => 'SERVER_TIME' };
const input = { bikerId: 'b1', expectedRevision: 0, reasonKey: 'training', expectedStartDate: '2026-10-28', note: 'تدريب على التنفيذ' };
function database(role = 'admin') {
  const stored = { name: 'اختبار', salary: 900, current_status: 'يشتغل', extra_unknown: 7 };
  const writes = [];
  const snap = (path) => { const row = path === 'users/actor' ? { role, displayName: 'مستخدم اختباري' } : path === 'bikers/b1' ? stored : null;
    return { exists: Boolean(row), data: () => row }; };
  const ref = path => ({ path, get: async () => snap(path) });
  const db = { writes, stored, collection: name => ({ doc: id => ref(`${name}/${id}`) }), runTransaction: async fn => {
    const staged = []; const result = await fn({ get: async r => snap(r.path), update: (r, data) => staged.push({ path: r.path, data }), set: (r, data) => staged.push({ path: r.path, data }) });
    writes.push(...staged); for (const write of staged) if (write.path === 'bikers/b1') Object.assign(stored, write.data); return result;
  } }; return db;
}
describe('audited biker idle follow-up metadata only', () => {
  it('records trusted actor and time and audits old/new values atomically', async () => {
    const db = database(); const result = await saveBikerIdleFollowup(db, fv, input, { userId: 'actor', now: new Date('2026-10-26T20:00:00Z') });
    expect(result.followup).toMatchObject({ revision: 1, updatedBy: 'actor', updatedByName: 'مستخدم اختباري', updatedAtIso: '2026-10-26T20:00:00.000Z' });
    expect(db.writes).toHaveLength(2); expect(Object.keys(db.writes[0].data)).toEqual(['idle_follow_up']);
    expect(db.stored).toMatchObject({ salary: 900, current_status: 'يشتغل', extra_unknown: 7 });
    expect(db.writes[1]).toMatchObject({ path: 'audit_logs/biker-idle-b1__1', data: { action: 'biker-idle-followup', before: {}, after: result.followup, userId: 'actor' } });
    await expect(saveBikerIdleFollowup(db, fv, input, { userId: 'actor' })).rejects.toMatchObject({ code: 'aborted' });
    expect(db.writes).toHaveLength(2);
  });
  it.each([{ salary: 0 }, { current_status: 'هرب' }, { updatedBy: 'fake' }, { expectedStartDate: '2026-02-30' }, { reasonKey: 'unknown' }, { reasonKey: 'other', note: '' }, { bikerId: '../b1' }])('refuses unsupported or forged fields %j without writing', async patch => {
    const db = database(); await expect(saveBikerIdleFollowup(db, fv, { ...input, ...patch }, { userId: 'actor' })).rejects.toBeTruthy(); expect(db.writes).toEqual([]);
  });
  it.each(['partner', 'operator', 'supervisor'])('refuses role %s even with a forged payload role', async role => {
    const db = database(role);
    await expect(saveBikerIdleFollowup(db, fv, input, { userId: 'actor' })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(dispatch('bikerIdleFollowupSave', { auth: { uid: 'actor' }, data: input }, { db, FieldValue: fv })).rejects.toBeTruthy();
    expect(db.writes).toEqual([]);
  });
  it('allows the accountant role and makes a no-change save idempotent', async () => {
    const db = database('accountant'); await saveBikerIdleFollowup(db, fv, input, { userId: 'actor' });
    const result = await saveBikerIdleFollowup(db, fv, { ...input, expectedRevision: 1 }, { userId: 'actor' });
    expect(result.unchanged).toBe(true); expect(db.writes).toHaveLength(2);
  });
});
