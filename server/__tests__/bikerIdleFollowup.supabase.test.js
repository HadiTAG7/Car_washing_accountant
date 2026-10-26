import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { createStore, FieldValue } from '../db/pgstore/index.js';
import { saveBikerIdleFollowup } from '../../functions/src/bikerIdleFollowup.js';
const url = 'postgresql://postgres:postgres@127.0.0.1:55622/sweater_report_snapshot_test_20261026';
const uid = '99999999-1111-4111-8111-111111111111';
const id = 'idle-biker-test-20261026';
describe.skipIf(process.env.IDLE_BIKER_PG_TESTS !== '1')('idle metadata on existing extra storage, isolated local Postgres', () => {
  let db, pool;
  beforeAll(async () => {
    const target = new URL(url);
    if (target.hostname !== '127.0.0.1' || target.pathname !== '/sweater_report_snapshot_test_20261026') throw Error('Test isolation guard');
    pool = new pg.Pool({ connectionString: url });
    expect((await pool.query('select current_database() as name')).rows[0].name).toBe('sweater_report_snapshot_test_20261026');
    await pool.query("insert into auth.users(id,email) values ($1,'idle-test@isolated.test') on conflict(id) do nothing", [uid]);
    db = createStore({ connectionString: url, role: 'ledger_server', max: 4 });
    await db.collection('users').doc(uid).set({ role: 'accountant', displayName: 'Isolated tester' });
    await db.collection('bikers').doc(id).set({ name: 'Isolated idle biker', salary: 900, current_status: 'تدريب',
      start_date: '2026-10-01', untouched_marker: { nested: true } });
    await pool.query('delete from public.audit_logs where document_id=$1', [id]);
  });
  afterAll(async () => {
    if (pool) {
      await pool.query('delete from public.audit_logs where document_id=$1', [id]);
      await pool.query('delete from public.bikers where id=$1', [id]);
      await pool.query('delete from public.members where id=$1', [uid]);
      await pool.query('delete from auth.users where id=$1', [uid]);
    }
    await db?.close(); await pool?.end();
  });
  it('round-trips current metadata and immutable before/after history without changing other fields', async () => {
    const result = await saveBikerIdleFollowup(db, FieldValue, { bikerId: id, expectedRevision: 0, reasonKey: 'training', expectedStartDate: '2026-10-28', note: 'Test only' }, { userId: uid });
    const row = (await db.collection('bikers').doc(id).get()).data();
    expect(row).toMatchObject({ salary: 900, current_status: 'تدريب', start_date: '2026-10-01', untouched_marker: { nested: true }, idle_follow_up: result.followup });
    const raw = (await pool.query('select extra from public.bikers where id=$1', [id])).rows[0];
    expect(raw.extra.idle_follow_up.revision).toBe(1);
    const audit = (await db.collection('audit_logs').doc(`biker-idle-${id}__1`).get()).data();
    expect(audit).toMatchObject({ before: {}, after: result.followup, userId: uid });
  });
  it('commits only one concurrent edit of the same revision and keeps both audit revisions', async () => {
    const outcomes = await Promise.allSettled(['one', 'two'].map(note => saveBikerIdleFollowup(db, FieldValue,
      { bikerId: id, expectedRevision: 1, reasonKey: 'no_bike', expectedStartDate: '', note }, { userId: uid })));
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect((await db.collection('bikers').doc(id).get()).data().idle_follow_up.revision).toBe(2);
    const audits = (await pool.query('select count(*)::int as count from public.audit_logs where document_id=$1', [id])).rows[0].count;
    expect(audits).toBe(2);
  });
});
