// الاستيراد عبر SQL خام (طريق HTTPS) = الاستيراد المباشر حرفياً، وكله أو لا شيء:
// نفس محتوى كل جدول ونفس التقرير، وبيانات مكسورة تفشل داخل التبديل والجداول
// الحية كما كانت والمرحلة المؤقتة محذوفة.
// التشغيل: npx supabase start && npm run test:supabase
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { available, closeDb, db, resetDb } from './supabaseTestDb.js';
import { runImport, runImportViaSql } from '../../../../scripts/migration/import-supabase.mjs';
import { pgSqlTransport } from '../../../../scripts/migration/sql-transport.mjs';
import { fingerprint } from '../../../../scripts/migration/db-fingerprint.mjs';
import { financeSourceHash, financeReviewId } from '../../../../functions/src/financeReview.js';

const up = await available();
const d = up ? describe : describe.skip;
const LOCAL = process.env.SUPABASE_TEST_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const row = (path, data) => ({ id: path.split('/').at(-1), path, data });
function exportDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'export-'));
  for (const [name, rows] of Object.entries(files)) writeFileSync(join(dir, `${name}.ndjson`), rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  return dir;
}
function dataset({ broken = false } = {}) {
  const lines = [{ accountId: '1100', debit: 57.5, credit: 0, description: 'نقد' }, { accountId: '4000', debit: 0, credit: 57.5, description: 'إيراد' }];
  const expense = { expense_name: 'وقود', total_variable_cost: 115, logged_date: '2026-10-03', is_tax_invoice: false };
  return {
    'auth-users': [{ uid: 'fbAdminSql', email: 'sql-admin@sweater.test', disabled: false }],
    users: [row('users/fbAdminSql', { email: 'sql-admin@sweater.test', role: 'admin' })],
    app_admins: [row('app_admins/fbAdminSql', { email: 'sql-admin@sweater.test' })],
    chart_of_accounts: ['1100', '4000'].map(c => row(`chart_of_accounts/${c}`, { code: c, nameArabic: c, accountType: c === '1100' ? 'asset' : 'revenue', normalBalance: c === '1100' ? 'debit' : 'credit', active: true })),
    washes: Array.from({ length: 640 }, (_, i) => row(`washes/w${String(i).padStart(4, '0')}`, { wash_date: '2026-10-05', quantity: 1, price: 20 + (i % 9) / 4, status: 'مكتملة', note: i % 5 ? null : "it's", created_at: { '$fs:ts': { s: 1760000000 + i, n: 123456000 } } })),
    variable_expenses: [row('variable_expenses/v1', expense), row('variable_expenses/v2', { ...expense, total_variable_cost: 40 })],
    // One approval that matches its source, one that no longer does — both states must survive.
    finance_reviews: [
      row(`finance_reviews/${financeReviewId('variable', 'v1')}`, { kind: 'variable', sourceId: 'v1', sourceHash: financeSourceHash({ ...expense, id: 'v1' }), status: 'approved' }),
      row(`finance_reviews/${financeReviewId('variable', 'v2')}`, { kind: 'variable', sourceId: 'v2', sourceHash: 'stale', status: 'approved' }),
    ],
    journal_entries: [row('journal_entries/e1', { entryDate: '2026-10-05', periodKey: '2026-10', status: 'posted', sourceType: 'manual', entryNumber: 1, lines, totalDebit: 57.5, totalCredit: 57.5 })],
    // A lock naming a missing entry: refused by its foreign key when the swap checks keys.
    posting_locks: broken ? [row('posting_locks/wash__w0001', { kind: 'wash', sourceId: 'w0001', entryId: 'no-such-entry' })] : [],
    payroll_runs: [row('payroll_runs/2026-10__r1', { periodKey: '2026-10', status: 'draft' })],
    group__items: [row('payroll_runs/2026-10__r1/items/b1', { bikerId: 'b1', net: 1234.56 })],
  };
}
const quiet = () => {};
const clean = async () => { await resetDb(); };

d('الاستيراد عبر SQL خام = الاستيراد المباشر', () => {
  beforeAll(() => {
    const env = Object.fromEntries(execFileSync('npx', ['supabase', 'status', '-o', 'env'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').map(l => /^([A-Z_]+)="?(.*?)"?$/.exec(l.trim())).filter(Boolean).map(m => [m[1], m[2]]));
    process.env.SUPABASE_URL = env.API_URL; process.env.SUPABASE_SERVICE_ROLE_KEY = env.SERVICE_ROLE_KEY;
  }, 60_000);
  afterAll(async () => { await clean(); await closeDb(); });

  it('نفس محتوى كل جدول ونفس التقرير، وبصمات الاعتماد كما هي', async () => {
    const dir = exportDir(dataset());
    await clean();
    const direct = await runImport({ dir, dbUrl: LOCAL, log: quiet });
    const before = await fingerprint(LOCAL);
    await clean();
    const viaSql = await runImportViaSql({ dir, sql: pgSqlTransport(LOCAL), log: quiet });
    expect(await fingerprint(LOCAL)).toEqual(before);
    const strip = ({ at, target, transport, ...rest }) => rest; // eslint-disable-line no-unused-vars
    expect(strip(viaSql)).toEqual(strip(direct));
    expect(viaSql.financeHashes).toEqual({ reviews: 2, match: 1 });
    expect(viaSql.roundTrip.checked).toBe(viaSql.roundTrip.of);
  }, 300_000);

  it('بيانات مكسورة: تفشل داخل التبديل، والجداول الحية كما كانت، ولا مرحلة مؤقتة باقية', async () => {
    await clean();
    await runImportViaSql({ dir: exportDir(dataset()), sql: pgSqlTransport(LOCAL), log: quiet });
    const live = await fingerprint(LOCAL);
    await expect(runImportViaSql({ dir: exportDir(dataset({ broken: true })), sql: pgSqlTransport(LOCAL), log: quiet }))
      .rejects.toThrow(/foreign key|posting_locks/);
    expect(await fingerprint(LOCAL)).toEqual(live);
    const { rows } = await db().query(`select count(*)::int as n from pg_namespace where nspname = 'migration_stage'`);
    expect(rows[0].n).toBe(0);
  }, 300_000);
});
