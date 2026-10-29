import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { createStore } from '../db/pgstore/index.js';
import { SCHEMA } from '../../src/lib/data/schema/registry.js';
import { financeWorkbench } from '../financeWorkbench.js';
import { statementLineId } from '../foundingSettlement.js';
import { foundingSeed } from './foundingFixture.js';

// The local Supabase only (truncated here): migrations, RLS, triggers and pgstore as ledger_server.
const url = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const admin = '11111111-2222-4333-8444-555555555555', accountant = '11111111-2222-4333-8444-666666666666';
const enabled = process.env.FOUNDING_PG_TESTS === '1';
describe.skipIf(!enabled)('founding settlement on Postgres with the production schema, RLS and ledger triggers', () => {
  let pool, db;
  const call = (request, uid = admin) => financeWorkbench(db, { uid }, { kind: 'founding', request });
  beforeAll(async () => {
    const target = new URL(url);
    if (target.hostname !== '127.0.0.1' || target.port !== '54322') throw new Error('Local database only');
    pool = new pg.Pool({ connectionString: url });
    db = createStore({ connectionString: url, role: 'ledger_server', max: 6 });
  });
  beforeEach(async () => {
    const names = [...new Set([...SCHEMA.map(t => t.table), ...SCHEMA.filter(t => t.lines).map(t => t.lines), 'firebase_uid_map'])];
    await pool.query(`truncate ${names.map(n => `public."${n}"`).join(', ')} cascade`);
    await pool.query('insert into auth.users(id,email) values ($1,$2),($3,$4) on conflict(id) do nothing', [admin, 'founding-admin@isolated.test', accountant, 'founding-accountant@isolated.test']);
    const batch = db.batch();
    for (let [path, value] of Object.entries(foundingSeed())) {
      path = path.replace('users/test-admin', `users/${admin}`).replace('users/test-accountant', `users/${accountant}`);
      batch.set(db.doc(path), value);
    }
    await batch.commit();
  }, 120000);
  afterAll(async () => { await db?.close(); await pool?.end(); });

  it('applies a personal statement, posts the approved corrections and keeps every entry balanced', async () => {
    const rows = [
      { txDate: '2026-08-12', direction: 'debit', amount: 1000, description: 'POS', reference: 'r1', balance: null, occurrence: 1 },
      { txDate: '2026-08-03', direction: 'credit', amount: 5000, description: 'in', reference: 'r2', balance: null, occurrence: 1 },
      { txDate: '2026-09-15', direction: 'debit', amount: 75, description: 'grocery', reference: 'r3', balance: null, occurrence: 1 },
    ];
    const result = await call({ action: 'statementApply', account: 'personal', fileName: 'f.xlsx', fileHash: 'h', confirm: true, rows: [
      { ...rows[0], decision: 'document', linkKey: 'startup:se1', expense: null },
      { ...rows[1], decision: 'partner_payment', linkKey: 'partner_payment:pp1', expense: null },
      { ...rows[2], decision: 'statement_expense', linkKey: null, expense: { kind: 'variable', classificationId: 'cat1', description: 'groceries', supplier: 'shop' } },
    ] });
    expect(result).toMatchObject({ applied: 3, failed: 0 });
    expect((await pool.query('select count(*)::int as n from public.bank_statement_lines where status = $1', ['applied'])).rows[0].n).toBe(3);
    const line = (await db.collection('bank_statement_lines').doc(statementLineId('personal', rows[2])).get()).data();
    const expense = (await db.collection('variable_expenses').doc(line.linkId).get()).data();
    expect(expense).toMatchObject({ payment_method: 'owner_current', approval_status: 'pending', total_variable_cost: 75 });
    expect(Number((await pool.query("select count(*) from public.chart_of_accounts where id in ('2300','3200')")).rows[0].count)).toBe(2);

    let read = await call({ action: 'read' });
    const proposed = read.plan.entries.filter(e => e.status === 'proposed');
    expect(proposed.map(e => e.key).sort()).toEqual(['doc:startup:se1', 'payment:partner_payment:pp1']);
    await expect(call({ action: 'postEntries', reason: 'approval', confirm: true, entries: proposed.map(e => ({ key: e.key, hash: e.hash })) }, accountant))
      .rejects.toMatchObject({ code: 'permission-denied' });
    const posted = await call({ action: 'postEntries', reason: 'approval', confirm: true, entries: proposed.map(e => ({ key: e.key, hash: e.hash })) });
    expect(posted.posted).toHaveLength(2);
    const balance = (await pool.query(`select sum(debit) - sum(credit) as net, count(*)::int as n from public.journal_entry_lines l
      join public.journal_entries e on e.id = l.entry_id where e.source_kind like 'founding_%'`)).rows[0];
    expect(Number(balance.net)).toBe(0); expect(balance.n).toBe(4);
    read = await call({ action: 'read' });
    expect(read.plan.hadi.postedBalance).toBe(-4000);
    expect(read.plan.hadi.pending.map(p => p.credit)).toEqual([75]);
    await expect(call({ action: 'postEntries', reason: 'again', confirm: true, entries: proposed.map(e => ({ key: e.key, hash: e.hash })) })).rejects.toBeTruthy();
    expect((await pool.query("select count(*)::int as n from public.journal_entries where source_kind like 'founding_%'")).rows[0].n).toBe(2);
  }, 120000);

  it('lets only an admin read statement lines from the browser (RLS)', async () => {
    await pool.query("insert into public.bank_statement_lines(id, account, tx_date, direction, amount, status) values ('stmt_x','personal','2026-09-01','debit',1,'applied')");
    const read = async uid => {
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: 'authenticated' })]);
        await client.query('set local role authenticated');
        return (await client.query('select count(*)::int as n from public.bank_statement_lines')).rows[0].n;
      } finally { await client.query('rollback'); client.release(); }
    };
    expect(await read(accountant)).toBe(0);
    expect(await read(admin)).toBe(1);
  }, 120000);
});
