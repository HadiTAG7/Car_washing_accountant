import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { createStore } from '../db/pgstore/index.js';
import { financeReports } from '../financeReports.js';
import { executiveReports } from '../executiveReports.js';
import { financeFixture } from './financeFixtures.js';
import { executiveFixture } from './executiveFixture.js';
import { snapshotNow, snapshotSeed } from './reportSnapshotFixture.js';

// Explicit disposable database, on loopback. Never accepts a production URL.
const url = 'postgresql://postgres:postgres@127.0.0.1:55622/sweater_report_snapshot_test_20261026';
const enabled = process.env.REPORT_SNAPSHOT_PG_TESTS === '1';
const uid = '11111111-1111-4111-8111-111111111111';
describe.skipIf(!enabled)('report publication on isolated Postgres schema', () => {
  let pool, db;
  beforeAll(async () => {
    const target = new URL(url);
    if (target.hostname !== '127.0.0.1' || target.pathname !== '/sweater_report_snapshot_test_20261026') throw new Error('Test isolation guard');
    pool = new pg.Pool({ connectionString: url });
    expect((await pool.query('select current_database() as db')).rows[0].db).toBe('sweater_report_snapshot_test_20261026');
    await pool.query("insert into auth.users(id,email) values ($1,'report-test@isolated.test') on conflict(id) do nothing", [uid]);
    db = createStore({ connectionString: url, role: 'ledger_server', max: 8 });
    const batch = db.batch();
    for (let [path, row] of Object.entries(snapshotSeed())) {
      path = path.replace('users/test-admin', `users/${uid}`);
      batch.set(db.doc(path), row);
    }
    await batch.commit();
  }, 120000);
  afterAll(async () => { if (db) await db.close(); if (pool) await pool.end(); });
  it('atomically saves six figures, concurrent replay, immutable readback, and server-only capture for all reports', async () => {
    const before = await db.collection('journal_entries').get();
    for (const role of [1, 2, 3]) {
      const report = financeFixture({ sourceRole: role, reportId: `finance-2026-10-19-${role}-daily-2026-10-19-2026-10-19` });
      const args = { action: 'save', report, expectedRevision: 0 };
      const [a, b] = await Promise.all([financeReports(db, { uid }, args, snapshotNow, () => snapshotNow), financeReports(db, { uid }, args, snapshotNow, () => snapshotNow)]);
      expect([a, b].filter(r => r.duplicate)).toHaveLength(1);
      const read = await financeReports(db, { uid }, { action: 'read', reportId: report.reportId }, snapshotNow);
      expect(Object.fromEntries(read.report.financialSnapshot.metrics.map(m => [m.id, m.value]))).toEqual({ revenue: 60, expenses: 175, 'net-profit': -115, 'bank-ledger': 975, 'cash-ledger': -12, 'vat-due': 9 });
      const version = await db.collection('finance_reports').doc(report.reportId).collection('revisions').doc('000001').get();
      expect(version.data().financialSnapshotHash).toMatch(/^[a-f0-9]{64}$/);
    }
    const ceo = executiveFixture();
    await executiveReports(db, { uid }, { action: 'save', report: ceo, expectedRevision: 0 }, snapshotNow, () => snapshotNow);
    expect((await executiveReports(db, { uid }, { action: 'read', reportId: ceo.reportId }, snapshotNow)).report.financialSnapshot.metrics.every(m => m.value !== null)).toBe(true);
    expect((await db.collection('journal_entries').get()).docs.map(d => d.data())).toEqual(before.docs.map(d => d.data()));
  }, 120000);
  it('rolls back a real SQL read failure instead of claiming that an aborted transaction saved a report', async () => {
    const report = financeFixture({ dateRiyadh: '2026-10-20', cutAtRiyadh: '2026-10-20T10:00:00+03:00',
      period: { kind: 'daily', from: '2026-10-20', to: '2026-10-20' }, reportId: 'finance-2026-10-20-1-daily-2026-10-20-2026-10-20' });
    await pool.query('alter table public.startup_costs rename to report_test_hidden_startup_costs');
    try { await expect(financeReports(db, { uid }, { action: 'save', report, expectedRevision: 0 }, snapshotNow, () => snapshotNow)).rejects.toBeTruthy(); }
    finally { await pool.query('alter table public.report_test_hidden_startup_costs rename to startup_costs'); }
    expect((await db.collection('finance_reports').doc(report.reportId).get()).exists).toBe(false);
  }, 120000);
});
