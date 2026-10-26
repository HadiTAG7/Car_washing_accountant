import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { createStore, FieldValue } from '../db/pgstore/index.js';
import { saveQualityObjection, saveQualityObjectionSettings, qualityObjectionId } from '../../functions/src/qualityObjections.js';
import { saveMetricsSnapshot } from '../../functions/src/sweater/metricsSnapshot.js';
const url = 'postgresql://postgres:postgres@127.0.0.1:55622/sweater_report_snapshot_test_20261026';
const uid = '99999999-2222-4222-8222-222222222222', other = '99999999-3333-4333-8333-333333333333';
const month = '2098-10', source = 'quality-isolated-source', snapshotId = 'quality-isolated-reading';
const input = { periodKey: month, metricKey: 'cancelledByCustomer', sourceId: source, snapshotId, expectedRevision: 0, status: 'submitted', note: 'Isolated followup only' };
const docId = qualityObjectionId(month, input.metricKey, source);
describe.skipIf(process.env.QUALITY_OBJECTIONS_PG_TESTS !== '1')('quality objections on isolated Postgres', () => {
  let db, pool, originalSettings;
  beforeAll(async () => {
    const target = new URL(url);
    if (target.hostname !== '127.0.0.1' || target.pathname !== '/sweater_report_snapshot_test_20261026') throw Error('Isolation guard');
    pool = new pg.Pool({ connectionString: url });
    expect((await pool.query('select current_database() as name')).rows[0].name).toBe('sweater_report_snapshot_test_20261026');
    if (!(await pool.query("select to_regclass('public.sweater_metric_snapshots') as name")).rows[0].name) await pool.query(await readFile(new URL('../../supabase/migrations/20261023000000_sweater_metric_snapshots.sql', import.meta.url), 'utf8'));
    if (!(await pool.query("select to_regclass('public.quality_objections') as name")).rows[0].name) await pool.query(await readFile(new URL('../../supabase/migrations/20261026203950_quality_objections.sql', import.meta.url), 'utf8'));
    await pool.query("insert into auth.users(id,email) values ($1,'quality@isolated.test'),($2,'quality-other@isolated.test') on conflict(id) do nothing", [uid, other]);
    db = createStore({ connectionString: url, role: 'ledger_server', max: 4 });
    await db.collection('users').doc(uid).set({ role: 'admin', displayName: 'Isolated reviewer' });
    await db.collection('users').doc(other).set({ role: 'accountant' });
    originalSettings = await db.collection('app_settings').doc('quality-objections').get();
    const payload = { contractVersion: 'sweater-metrics-v1', importRunId: snapshotId, periodKey: month, extractedAt: '2098-10-26T19:00:00+03:00', sourceUrl: 'https://ssp-portal.sweater.sa/test', metrics: { cancelledByCustomer: 1 },
      eventDetails: [{ metricKey: 'cancelledByCustomer', sourceId: source, bookingId: 'TEST-BOOKING', date: '2098-10-20', time: null, driverExternalId: 'TEST', reason: 'Test', quantity: 1, amount: null, sourceUrl: 'https://ssp-portal.sweater.sa/test' }],
      eventCoverage: [{ metricKey: 'cancelledByCustomer', totalRows: 1, complete: true }] };
    const receipt = await saveMetricsSnapshot(db, FieldValue, payload, { keyId: 'isolated-key', nowMs: Date.parse('2098-10-26T20:00:00+03:00') });
    expect(receipt.stored).toBe(true);
    expect((await db.collection('sweater_metric_snapshots').doc(snapshotId).get()).data().eventDetails).toEqual(payload.eventDetails);
    expect((await saveMetricsSnapshot(db, FieldValue, payload, { keyId: 'isolated-key', nowMs: Date.parse('2098-10-26T20:00:00+03:00') })).stored).toBe(false);
    await expect(saveMetricsSnapshot(db, FieldValue, { ...payload, eventDetails: payload.eventDetails.map(r => ({ ...r, reason: 'Changed' })) }, { keyId: 'isolated-key', nowMs: Date.parse('2098-10-26T20:00:00+03:00') })).rejects.toMatchObject({ code: 'already-exists' });
  });
  afterAll(async () => {
    if (pool) {
      await pool.query("delete from public.audit_logs where document_id=$1 or (document_id='quality-objections' and user_id=$2)", [docId, uid]);
      await pool.query('delete from public.quality_objections where id=$1', [docId]);
      await pool.query('delete from public.sweater_metric_snapshots where id in ($1,$2)', [snapshotId, snapshotId + '-new']);
      if (originalSettings?.exists) await db.collection('app_settings').doc('quality-objections').set(originalSettings.data());
      else await pool.query("delete from public.app_settings where id='quality-objections'");
      await pool.query('delete from public.members where id in ($1,$2)', [uid, other]);
      await pool.query('delete from auth.users where id in ($1,$2)', [uid, other]);
    }
    await db?.close(); await pool?.end();
  });
  it('refuses nonadmin, foreign fields and nonexistent source without writing', async () => {
    await expect(saveQualityObjection(db, FieldValue, input, { userId: other })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(saveQualityObjection(db, FieldValue, { ...input, amount: 20 }, { userId: uid })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(saveQualityObjection(db, FieldValue, { ...input, sourceId: 'missing' }, { userId: uid })).rejects.toMatchObject({ code: 'aborted' });
    expect((await db.collection('quality_objections').doc(docId).get()).exists).toBe(false);
  });
  it('writes only metadata plus audit; source remains byte-for-byte equivalent', async () => {
    const before = (await db.collection('sweater_metric_snapshots').doc(snapshotId).get()).data();
    const result = await saveQualityObjection(db, FieldValue, input, { userId: uid });
    expect(result.objection).toMatchObject({ revision: 1, status: 'submitted', updatedBy: uid });
    expect((await db.collection('sweater_metric_snapshots').doc(snapshotId).get()).data()).toEqual(before);
    expect((await db.collection('quality_objections').doc(docId).get()).data().history).toMatchObject([{ before: {}, after: { status: 'submitted', note: input.note }, userId: uid }]);
    const audit = (await db.collection('audit_logs').doc(`quality-objection-${docId}__1`).get()).data();
    expect(audit).toMatchObject({ before: { revision: 0 }, after: { revision: 1 }, userId: uid });
    expect(JSON.stringify(audit)).not.toContain(input.note);
    expect(JSON.stringify(audit)).not.toContain('submitted');
  });
  it('only one concurrent revision commits, and stale source snapshots cannot be saved', async () => {
    const outcomes = await Promise.allSettled(['one', 'two'].map(note => saveQualityObjection(db, FieldValue, { ...input, expectedRevision: 1, note }, { userId: uid })));
    expect(outcomes.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(r => r.status === 'rejected')).toHaveLength(1);
    const old = (await db.collection('sweater_metric_snapshots').doc(snapshotId).get()).data();
    await db.collection('sweater_metric_snapshots').doc(snapshotId + '-new').set({ ...old, extractedAtIso: '2098-10-27T19:00:00+03:00' });
    await expect(saveQualityObjection(db, FieldValue, { ...input, expectedRevision: 2 }, { userId: uid })).rejects.toMatchObject({ code: 'aborted' });
  });
  it('settings have no assumed deadline, strict range, revision and audit', async () => {
    await expect(saveQualityObjectionSettings(db, FieldValue, { deadlineDays: 0, expectedRevision: 0 }, { userId: uid })).rejects.toMatchObject({ code: 'invalid-argument' });
    const result = await saveQualityObjectionSettings(db, FieldValue, { deadlineDays: 7, expectedRevision: originalSettings?.data()?.revision || 0 }, { userId: uid });
    expect(result.settings.deadlineDays).toBe(7);
  });
  it('RLS permits admin read only; authenticated cannot insert or update', async () => {
    const client = await pool.connect();
    try {
      await client.query('begin'); await client.query('set local role authenticated');
      await client.query("select set_config('request.jwt.claim.sub',$1,true)", [other]);
      expect((await client.query('select id from public.quality_objections where id=$1', [docId])).rows).toHaveLength(0);
      const audit = (await client.query('select app.doc_audit_logs(a) as doc from public.audit_logs a where document_id=$1', [docId])).rows;
      expect(audit.length).toBe(2);
      expect(audit[0].doc.before).toEqual({ revision: 0 });
      expect(JSON.stringify(audit)).not.toContain(input.note);
      expect(JSON.stringify(audit)).not.toContain('submitted');
      await client.query("select set_config('request.jwt.claim.sub',$1,true)", [uid]);
      expect((await client.query('select id from public.quality_objections where id=$1', [docId])).rows).toHaveLength(1);
      const full = (await client.query('select app.doc_quality_objections(q) as doc from public.quality_objections q where id=$1', [docId])).rows[0].doc;
      expect(full.history).toHaveLength(2); expect(full.history[0].after.note).toBe(input.note);
      await expect(client.query('update public.quality_objections set note=$1 where id=$2', ['forbidden', docId])).rejects.toMatchObject({ code: '42501' });
    } finally { await client.query('rollback'); client.release(); }
  });
});
