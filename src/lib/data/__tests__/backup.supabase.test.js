// النسخة الاحتياطية على Supabase تُستعاد حرفياً: استيراد → نسخ عبر صفحات الخادم
// → استعادة بسكربت النقل → كل مستند وربط الحسابات كما كان.
// التشغيل: npx supabase start && npm run test:supabase
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { available, closeDb, db } from './supabaseTestDb.js';
import { SCHEMA } from '../schema/registry.js';
import { plainTimestamp } from '../schema/codec.js';
import { readDocuments } from '../../../../server/db/rows.js';
import { createStore } from '../../../../server/db/pgstore/index.js';
import { exportPage, BACKUP_COLLECTIONS } from '../../../../server/backupExportHttp.js';
import { runImport } from '../../../../scripts/migration/import-supabase.mjs';

const up = await available();
const d = up ? describe : describe.skip;
const LOCAL = process.env.SUPABASE_TEST_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const ts = (s, n = 0) => ({ '$fs:ts': { s, n } });
const row = (path, data) => ({ id: path.split('/').at(-1), path, data });
function writeExport(dir, files) {
  for (const [name, rows] of Object.entries(files)) writeFileSync(join(dir, `${name}.ndjson`), rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
}
async function snapshot() {
  const out = {};
  for (const t of SCHEMA) out[t.table] = (await readDocuments(db(), t, { makeTimestamp: plainTimestamp })).map(x => JSON.stringify(x));
  out.uidMap = (await db().query('select firebase_uid, user_id::text, email from public.firebase_uid_map order by 1')).rows;
  return out;
}

d('النسخة الاحتياطية تُستعاد حرفياً', () => {
  let store;
  beforeAll(async () => {
    const env = Object.fromEntries(execFileSync('npx', ['supabase', 'status', '-o', 'env'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').map(l => /^([A-Z_]+)="?(.*?)"?$/.exec(l.trim())).filter(Boolean).map(m => [m[1], m[2]]));
    process.env.SUPABASE_URL = env.API_URL; process.env.SUPABASE_SERVICE_ROLE_KEY = env.SERVICE_ROLE_KEY;
    store = createStore({ connectionString: LOCAL, role: 'ledger_server' });
  }, 60_000);
  afterAll(async () => { await store?.close(); await closeDb(); });

  it('استيراد ← نسخ ← استعادة = نفس كل مستند', async () => {
    const source = mkdtempSync(join(tmpdir(), 'export-'));
    const lines = [{ accountId: '1100', debit: 57.5, credit: 0, description: 'نقد' }, { accountId: '4000', debit: 0, credit: 57.5, description: 'إيراد' }];
    writeExport(source, {
      'auth-users': [{ uid: 'fbAdmin1', email: 'backup-admin@sweater.test', disabled: false }],
      users: [row('users/fbAdmin1', { email: 'backup-admin@sweater.test', role: 'admin' })],
      app_admins: [row('app_admins/fbAdmin1', { email: 'backup-admin@sweater.test' })],
      chart_of_accounts: ['1100', '4000'].map(c => row(`chart_of_accounts/${c}`, { code: c, nameArabic: c, accountType: c === '1100' ? 'asset' : 'revenue', normalBalance: c === '1100' ? 'debit' : 'credit', active: true })),
      washes: Array.from({ length: 1203 }, (_, i) => row(`washes/w${String(i).padStart(5, '0')}`, { wash_date: '2026-10-05', quantity: 1, price: 20 + (i % 7) / 4, status: 'مكتملة', created_at: ts(1760000000 + i, 123000) })),
      journal_entries: [row('journal_entries/e1', { entryDate: '2026-10-05', periodKey: '2026-10', status: 'posted', sourceType: 'manual', entryNumber: 1, lines, totalDebit: 57.5, totalCredit: 57.5 })],
      payroll_runs: [row('payroll_runs/2026-10__r1', { periodKey: '2026-10', status: 'draft' })],
      group__items: [row('payroll_runs/2026-10__r1/items/b1', { bikerId: 'b1', net: 1234.56 }), row('payroll_runs/2026-10__r1/items/b2', { bikerId: 'b2', net: 10 })],
    });
    await runImport({ dir: source, dbUrl: LOCAL, log: () => {} });
    const before = await snapshot();

    // The backup, exactly as the button builds it: every collection, page by page.
    const backup = mkdtempSync(join(tmpdir(), 'backup-'));
    const files = {}; let pages = 0;
    for (const collection of BACKUP_COLLECTIONS) {
      const rows = [];
      for (let after = null; ;) { const page = await exportPage(store, collection, after); pages += 1; rows.push(...page.rows); if (!page.next) break; after = page.next; }
      const name = collection === 'firebase_uid_map' ? 'firebase-uid-map' : collection.includes('/*/') ? `group__${collection.split('/*/')[1]}` : collection;
      files[name] = [...(files[name] || []), ...rows];
    }
    expect(pages).toBeGreaterThan(BACKUP_COLLECTIONS.length); // washes took more than one page
    writeExport(backup, files);
    writeFileSync(join(backup, 'manifest.json'), JSON.stringify({ version: 1, source: 'supabase-backup' }));

    const report = await runImport({ dir: backup, dbUrl: LOCAL, log: () => {} });
    expect(report.restore).toBe(true);
    expect(await snapshot()).toEqual(before);
  }, 300_000);
});
