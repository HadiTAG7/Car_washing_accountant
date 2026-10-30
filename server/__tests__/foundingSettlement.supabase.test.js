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

  it('applies the default rule on Postgres: decisions, workbench updates through RLS, and entries that still need approval', async () => {
    let read = await call({ action: 'read' });
    const rule = read.plan.rule;
    expect(rule.candidates.map(c => c.key).sort()).toEqual(['startup:se1', 'variable:v1', 'variable:v2', 'variable:v3']);
    await call({ action: 'decide', sourceKey: 'variable:v2', decision: 'custody', custodian: 'مشرف', confirm: true });
    await expect(call({ action: 'applyRule', hash: rule.hash, confirm: true })).rejects.toThrow(/تغيرت/);
    read = await call({ action: 'read' });
    const applied = await call({ action: 'applyRule', hash: read.plan.rule.hash, confirm: true });
    expect(applied).toMatchObject({ applied: 3 });
    expect(applied.updates.sort()).toEqual(['variable:v1', 'variable:v2']);
    const result = await call({ action: 'applyUpdates', keys: ['variable:v1', 'variable:v2'], confirm: true });
    expect(result.results.every(r => r.ok)).toBe(true);
    const rows = (await pool.query("select id, payment_method, paid_date, finance_metadata->>'fundingType' as funding from public.variable_expenses where id in ('v1','v2') order by id")).rows;
    expect(rows).toEqual([{ id: 'v1', payment_method: 'founding_personal', paid_date: '2026-09-05', funding: 'owner_current' },
      { id: 'v2', payment_method: 'custody', paid_date: '2026-09-10', funding: 'custody' }]);
    expect((await pool.query("select count(*)::int as n from public.founding_decisions where decision = 'founding_rule' and decided_by = $1", [admin])).rows[0].n).toBe(3);
    expect((await pool.query("select count(*)::int as n from public.journal_entries where source_kind like 'founding_%'")).rows[0].n).toBe(0);
    read = await call({ action: 'read' });
    expect(read.plan.entries.filter(e => e.status === 'proposed').map(e => e.key).sort()).toEqual(['doc:startup:se1', 'doc:variable:v3']);
  }, 120000);

  it('keeps the no-statement settings, an attested expense, the attested balance and a written 3200 entry in Postgres', async () => {
    let read = await call({ action: 'read' });
    await call({ action: 'saveSettings', revision: 0, cutoffDate: '2026-10-01', threshold: 500, actuals: null, noPersonalStatement: true, confirm: true });
    const saved = await call({ action: 'attestExpense', requestId: 'pg-attest-1', approxDate: '2026-07-20', amount: 45.5, description: 'نقل أغراض',
      kind: 'variable', classificationId: 'cat1', proofUrl: null, note: null, confirm: true });
    expect(saved.recordDate).toBe('2026-09-30');
    const row = (await pool.query('select logged_date, payment_method, is_tax_invoice, vat_deductible, finance_metadata from public.variable_expenses where id = $1', [saved.sourceId])).rows[0];
    expect(row).toMatchObject({ logged_date: '2026-09-30', payment_method: 'founding_personal', is_tax_invoice: false, vat_deductible: false });
    expect(row.finance_metadata.managerAttestation).toMatchObject({ by: admin, approxDate: '2026-07-20' });
    read = await call({ action: 'read' });
    expect(read.plan.comparison.status).toBe('off');
    expect(read.plan.attestedExpenses.map(e => e.sourceId)).toEqual([saved.sourceId]);
    await call({ action: 'attestBalance', hash: read.plan.hadiBalance.hash, note: 'مراجعة أولى', confirm: true });
    await call({ action: 'proposeAdjustment', amount: 45.5, direction: 'debit_2300', reason: 'تنازل عن مبلغ بلا مستند', confirm: true });
    const review = (await db.collection('founding_review').doc('current').get()).data();
    expect(review).toMatchObject({ noPersonalStatement: true, hadiAttestation: { note: 'مراجعة أولى', net: 45.5 }, adjustments: [{ amount: 45.5, direction: 'debit_2300' }] });
    read = await call({ action: 'read' });
    const entry = read.plan.entries.find(e => e.type === 'adjustment');
    expect(entry.status).toBe('proposed');
    await call({ action: 'postEntries', reason: 'موافقة', confirm: true, entries: [{ key: entry.key, hash: entry.hash }] });
    const lines = (await pool.query(`select l.account_id, l.debit, l.credit from public.journal_entry_lines l join public.journal_entries e on e.id = l.entry_id
      where e.source_kind = 'founding_adjustment' order by l.line_no`)).rows.map(l => [l.account_id, Number(l.debit), Number(l.credit)]);
    expect(lines).toEqual([['2300', 45.5, 0], ['3200', 0, 45.5]]);
    await call({ action: 'decidePayments', keys: ['partner_payment:pp1'], arrival: 'hadi', confirm: true });
    read = await call({ action: 'read' });
    expect(read.plan.hadiBalance).toMatchObject({ received: 5000, net: -4954.5, attestation: { changed: true } });
  }, 120000);

  it('posts a closed-month founding document on the last founding day, holds a filed return until reviewed, and posts a receipt under its own lock', async () => {
    const wb = (sourceId, request) => financeWorkbench(db, { uid: admin }, { kind: 'variable', sourceId, ...request });
    const complete = { category_id: 'cat1', quantity: 1, supplier: 'مورد', invoice_url: 'https://example.org/july', price_mode: 'inclusive',
      payment_method: 'cash', payment_status: 'paid', finance_metadata: { fundingType: 'company_cash', fundingReference: 'صندوق', purpose: 'تجهيز', evidenceRefs: ['ref'] } };
    const batch = db.batch();
    batch.set(db.doc('app_settings/accounting'), { value: { vatRegistered: true } });
    batch.set(db.doc('chart_of_accounts/1200'), { code: '1200', nameArabic: '1200', accountType: 'asset', active: true });
    batch.set(db.doc('variable_expenses/v5'), { ...complete, expense_name: 'مصروف يوليو', total_variable_cost: 150, unit_cost: 150, logged_date: '2026-07-15',
      paid_date: '2026-07-15', is_tax_invoice: false, vat_deductible: false });
    batch.set(db.doc('variable_expenses/v7'), { ...complete, expense_name: 'فاتورة ضريبية يوليو', total_variable_cost: 115, unit_cost: 115, logged_date: '2026-07-16',
      paid_date: '2026-07-16', is_tax_invoice: true, vat_deductible: true, vat_amount: 15, invoice_number: 'INV-7', invoice_date: '2026-07-16', invoice_url: 'https://example.org/july-7',
      finance_metadata: { ...complete.finance_metadata, taxReviewRef: 'REV-7' } });
    batch.set(db.doc('partner_payments/pp2'), { partner_id: 'p1', amount: 3000, payment_date: '2026-07-20', payment_method: 'owner_current' });
    await batch.commit();

    let detail = await wb('v5', { action: 'read' });
    expect(detail).toMatchObject({ closed: false, postingDate: '2026-09-30' });
    await wb('v5', { action: 'approve', sourceHash: detail.sourceHash, postingHash: detail.postingPreview.postingHash, reason: 'اعتماد', confirm: true });
    detail = await wb('v5', { action: 'read' });
    const posted = await wb('v5', { action: 'post', sourceHash: detail.sourceHash, confirm: true });
    const entry = (await pool.query('select entry_date, period_key from public.journal_entries where id = $1', [posted.verification.journalIds[0]])).rows[0];
    expect(entry).toMatchObject({ entry_date: '2026-09-30', period_key: '2026-09' });
    expect((await pool.query("select status from public.accounting_periods where id = '2026-07'")).rows[0].status).toBe('closed');
    expect((await pool.query("select logged_date from public.variable_expenses where id = 'v5'")).rows[0].logged_date).toBe('2026-07-15');

    // Input VAT in a filed quarter: held until reviewed in the founding settlement.
    detail = await wb('v7', { action: 'read' });
    expect(detail.postingPreview).toMatchObject({ ready: false });
    expect(detail.postingPreview.issues.join(' ')).toContain('راجعته');
    await call({ action: 'decide', sourceKey: 'variable:v7', vatReviewed: true, confirm: true });
    detail = await wb('v7', { action: 'read' });
    expect(detail.postingPreview.ready).toBe(true);
    expect(detail.postingPreview.lines.map(l => [String(l.accountId), l.debit, l.credit])).toEqual([['5100', 100, 0], ['1200', 15, 0], ['1010', 0, 115]]);

    // A receipt that reached Hadi with no entry: proposed with a reason, posted on approval, locked.
    await call({ action: 'proposeReceipts', keys: ['partner_payment:pp2'], reason: 'وصلت لحسابي الشخصي', confirm: true });
    const read = await call({ action: 'read' });
    const receipt = read.plan.entries.find(e => e.key === 'receipt:partner_payment:pp2');
    await call({ action: 'postEntries', reason: 'موافقة', confirm: true, entries: [{ key: receipt.key, hash: receipt.hash }] });
    const rows = (await pool.query(`select e.entry_date, e.source_type, e.source_id, l.account_id, l.debit, l.credit from public.journal_entries e
      join public.journal_entry_lines l on l.entry_id = e.id where e.source_kind = 'founding_receipt' order by l.line_no`)).rows;
    expect(rows.map(r => [r.entry_date, r.source_type, r.source_id, r.account_id, Number(r.debit), Number(r.credit)])).toEqual([
      ['2026-09-30', 'partner_payment', 'pp2', '2300', 3000, 0], ['2026-09-30', 'partner_payment', 'pp2', '3000-p1', 0, 3000]]);
    expect((await pool.query("select count(*)::int as n from public.posting_locks where id = 'partner_payment__pp2'")).rows[0].n).toBe(1);
  }, 120000);
});
