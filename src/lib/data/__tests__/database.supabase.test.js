// قاعدة Supabase المحلية: ثوابت الدفاتر، وصلاحيات كل دور مطابقة لـ firestore.rules.
// التشغيل: npx supabase start && npm run test:supabase
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { tableFor } from '../schema/registry.js';
import { writeDocument } from '../../../../server/db/rows.js';
import { available, resetDb, createAuthUser, asUser, asServer, asOwner, attempt, closeDb, db, actAsUser } from './supabaseTestDb.js';

const up = await available();
const d = up ? describe : describe.skip;

const U = {
  admin: '00000000-0000-4000-8000-000000000001', accountant: '00000000-0000-4000-8000-000000000002',
  operator: '00000000-0000-4000-8000-000000000003', partner: '00000000-0000-4000-8000-000000000004',
  supervisor: '00000000-0000-4000-8000-000000000005', partnerAdmin: '00000000-0000-4000-8000-000000000006',
  ghost: '00000000-0000-4000-8000-000000000007', adminDocOnly: '00000000-0000-4000-8000-000000000008',
  partner2: '00000000-0000-4000-8000-000000000009', noRoleKey: '00000000-0000-4000-8000-00000000000a',
};
const put = (client, collection, id, data, mode) => writeDocument(client, tableFor(collection).table, id, data, { mode });
const entry = (lines, extra = {}) => ({ entryDate: '2026-10-05', periodKey: '2026-10', status: 'posted', sourceType: 'manual', description: 'قيد', entryNumber: extra.entryNumber ?? 1, lines, ...extra });
const L = (accountId, debit, credit) => ({ accountId, debit, credit, description: '' });

async function seedUsers() {
  for (const [name, id] of Object.entries(U)) await createAuthUser(id, `${name}@sweater.test`);
  await asOwner(async (c) => {
    const role = { admin: 'admin', accountant: 'accountant', operator: 'operator', partner: 'partner', supervisor: 'supervisor', partnerAdmin: 'partner', partner2: 'partner' };
    for (const [name, r] of Object.entries(role)) await put(c, 'users', U[name], { email: `${name}@sweater.test`, role: r });
    await put(c, 'users', U.noRoleKey, { email: 'x@sweater.test' });
    for (const name of ['admin', 'partnerAdmin', 'adminDocOnly', 'supervisor']) await put(c, 'app_admins', U[name], { email: `${name}@sweater.test` });
    for (const code of ['1000', '1100', '4000', '5000']) await put(c, 'chart_of_accounts', code, { code, nameArabic: code, accountType: 'asset', normalBalance: 'debit', active: true });
  });
}

d('ثوابت الدفاتر في القاعدة', () => {
  beforeEach(async () => { await resetDb(); await seedUsers(); });
  afterAll(closeDb);

  it('القيد المتوازن يُحفظ، وغير المتوازن يُرفض عند نهاية العملية', async () => {
    expect((await attempt(asServer(c => put(c, 'journal_entries', 'e1', entry([L('1000', 10, 0), L('4000', 0, 10)], { totalDebit: 10, totalCredit: 10 }))))).ok).toBe(true);
    const bad = await attempt(asServer(c => put(c, 'journal_entries', 'e2', entry([L('1000', 10, 0), L('4000', 0, 9.99)], { entryNumber: 2 }))));
    expect(bad).toMatchObject({ ok: false, code: '23514' });
    expect(bad.message).toMatch(/غير متوازن/);
  });
  it('قيد بسطر واحد، أو سطر بطرفين، أو مبلغ سالب: مرفوض', async () => {
    expect(await attempt(asServer(c => put(c, 'journal_entries', 'e3', entry([L('1000', 0, 0)]))))).toMatchObject({ ok: false, code: '23514' });
    expect(await attempt(asServer(c => put(c, 'journal_entries', 'e4', entry([L('1000', 5, 5), L('4000', 5, 5)]))))).toMatchObject({ ok: false, code: '23514' });
    expect(await attempt(asServer(c => put(c, 'journal_entries', 'e5', entry([L('1000', -5, 0), L('4000', -5, 0)]))))).toMatchObject({ ok: false, code: '23514' });
  });
  it('السطر لا يُحذف ولا يتغيّر مبلغه، والوصف يتغيّر؛ القيد لا يُحذف، وحالته تتغيّر عند العكس', async () => {
    await asServer(c => put(c, 'journal_entries', 'e1', entry([L('1000', 10, 0), L('4000', 0, 10)])));
    expect(await attempt(asServer(c => c.query(`update journal_entry_lines set debit = 11 where entry_id = 'e1' and line_no = 0`)))).toMatchObject({ ok: false, code: '42501' });
    expect((await attempt(asServer(c => c.query(`update journal_entry_lines set description = 'وصف' where entry_id = 'e1'`)))).ok).toBe(true);
    expect(await attempt(asServer(c => c.query(`delete from journal_entry_lines where entry_id = 'e1'`)))).toMatchObject({ ok: false });
    expect(await attempt(asServer(c => c.query(`delete from journal_entries where id = 'e1'`)))).toMatchObject({ ok: false });
    expect((await attempt(asServer(c => c.query(`update journal_entries set status = 'reversed', reversed_at = now() where id = 'e1'`)))).ok).toBe(true);
    expect(await attempt(asServer(c => c.query(`update journal_entries set entry_date = '2026-10-06', period_key = '2026-10' where id = 'e1'`)))).toMatchObject({ ok: false, code: '42501' });
  });
  it('رقم القيد فريد، والتاريخ والشهر حقيقيان', async () => {
    await asServer(c => put(c, 'journal_entries', 'e1', entry([L('1000', 10, 0), L('4000', 0, 10)])));
    expect(await attempt(asServer(c => put(c, 'journal_entries', 'e2', entry([L('1000', 1, 0), L('4000', 0, 1)]))))).toMatchObject({ ok: false, code: '23505' });
    expect(await attempt(asOwner(c => c.query(`insert into washes (id, wash_date) values ('w', '2026-02-30')`)))).toMatchObject({ ok: false, code: '23514' });
    expect(await attempt(asOwner(c => c.query(`insert into expense_vouchers (id, period_key) values ('v', '2026-13')`)))).toMatchObject({ ok: false, code: '23514' });
  });
  it('السطر يشير لحساب موجود، والقفل لقيد موجود', async () => {
    expect(await attempt(asServer(c => put(c, 'journal_entries', 'e1', entry([L('9999', 10, 0), L('4000', 0, 10)]))))).toMatchObject({ ok: false, code: '23503' });
    expect(await attempt(asServer(c => put(c, 'posting_locks', 'wash__w1', { kind: 'wash', sourceId: 'w1', entryId: 'missing' })))).toMatchObject({ ok: false, code: '23503' });
  });
});

d('الصلاحيات تطابق firestore.rules', () => {
  beforeAll(async () => { await resetDb(); await seedUsers(); });
  afterAll(closeDb);
  const count = async (uid, sql, params = []) => (await asUser(uid, c => c.query(sql, params))).rowCount;

  it('لا أحد من المتصفح يكتب قيداً، حتى المدير', async () => {
    for (const uid of [U.admin, U.accountant, U.operator]) {
      expect(await attempt(asUser(uid, c => put(c, 'journal_entries', `x${uid.slice(-1)}`, entry([L('1000', 1, 0), L('4000', 0, 1)], { entryNumber: 90 }))))).toMatchObject({ ok: false, code: '42501' });
      expect(await attempt(asUser(uid, c => put(c, 'posting_locks', 'wash__z', { kind: 'wash', sourceId: 'z' })))).toMatchObject({ ok: false, code: '42501' });
      expect(await attempt(asUser(uid, c => put(c, 'counters', 'journal', { nextNumber: 1 })))).toMatchObject({ ok: false, code: '42501' });
    }
  });
  it('الموظفون يقرؤون الدفاتر؛ الشريك والمشرف والحساب بلا مستند لا يرون شيئاً', async () => {
    await asServer(c => put(c, 'journal_entries', 'r1', entry([L('1000', 10, 0), L('4000', 0, 10)], { entryNumber: 50 })));
    for (const uid of [U.admin, U.accountant, U.operator, U.partnerAdmin, U.adminDocOnly]) expect(await count(uid, 'select * from journal_entries'), uid).toBe(1);
    for (const uid of [U.partner, U.supervisor, U.ghost, U.noRoleKey]) expect(await count(uid, 'select * from journal_entries'), uid).toBe(0);
    expect(await count(U.partner, 'select * from journal_entry_lines')).toBe(0);
  });
  it('الغسلة: الموظف يضيف ويعدّل ويحذف ما لم تُرحَّل؛ بعد القفل لا شيء يتغيّر', async () => {
    expect((await attempt(asUser(U.operator, c => put(c, 'washes', 'w1', { wash_date: '2026-10-05', quantity: 1, price: 20, status: 'مكتملة' })))).ok).toBe(true);
    expect(await count(U.operator, `update washes set price = 25 where id = 'w1'`)).toBe(1);
    expect(await attempt(asUser(U.partner, c => put(c, 'washes', 'w2', { wash_date: '2026-10-05' })))).toMatchObject({ ok: false, code: '42501' });
    await asServer(async (c) => {
      await put(c, 'journal_entries', 'ew1', entry([L('1100', 25, 0), L('4000', 0, 25)], { entryNumber: 60 }));
      await put(c, 'posting_locks', 'wash__w1', { kind: 'wash', sourceId: 'w1', entryId: 'ew1' });
    });
    expect(await count(U.admin, `update washes set price = 30 where id = 'w1'`)).toBe(0);
    expect(await count(U.admin, `delete from washes where id = 'w1'`)).toBe(0);
    expect(await count(U.partner, 'select * from washes')).toBe(0);
  });
  it('تعديل ينتظر صف غسلة يرحّلها الخادم يُرفض بعد الترحيل، لا يمر بلقطة قديمة', async () => {
    await asUser(U.operator, c => put(c, 'washes', 'w-race', { wash_date: '2026-10-05', quantity: 1, price: 20, status: 'مكتملة' }));
    const server = await db().connect(); const user = await db().connect();
    try {
      // The server's posting holds the wash it read (as pgstore does at commit).
      await server.query('begin isolation level serializable');
      await server.query('set local role ledger_server');
      await server.query(`select id from washes where id = 'w-race' for share`);
      await put(server, 'journal_entries', 'ew-race', entry([L('1100', 20, 0), L('4000', 0, 20)], { entryNumber: 9061 }));
      await put(server, 'posting_locks', 'wash__w-race', { kind: 'wash', sourceId: 'w-race', entryId: 'ew-race' });
      // The edit starts before the posting commits: its policy sees no lock yet, and it waits for the row.
      await user.query('begin'); await actAsUser(user, U.operator);
      const edit = attempt(user.query(`update washes set price = 99 where id = 'w-race'`));
      await new Promise(r => setTimeout(r, 300));
      await server.query('commit');
      expect(await edit).toMatchObject({ ok: false, code: '42501' });
      await user.query('rollback');
    } finally { server.release(); user.release(); }
    expect((await asOwner(c => c.query(`select price from washes where id = 'w-race'`))).rows[0].price).toBe('20.00');
  });
  it('الجلسة الحيّة: للخادم وحده، ولا تقبل جلسة محذوفة أو مستخدماً محظوراً', async () => {
    const sid = '11111111-1111-4111-8111-111111111111';
    await asOwner(c => c.query(`insert into auth.sessions (id, user_id, created_at, updated_at) values ($1, $2, now(), now())`, [sid, U.operator]));
    const live = (uid, s) => asServer(c => c.query('select app.session_is_live($1, $2) as v', [uid, s])).then(r => r.rows[0].v);
    expect(await live(U.operator, sid)).toBe(true);
    expect(await live(U.admin, sid)).toBe(false);
    expect(await attempt(asUser(U.operator, c => c.query('select app.session_is_live($1, $2)', [U.operator, sid])))).toMatchObject({ ok: false, code: '42501' });
    await asOwner(c => c.query(`update auth.users set banned_until = now() + interval '1 day' where id = $1`, [U.operator]));
    expect(await live(U.operator, sid)).toBe(false);
    await asOwner(c => c.query(`update auth.users set banned_until = null where id = $1`, [U.operator]));
    await asOwner(c => c.query('delete from auth.sessions where id = $1', [sid]));
    expect(await live(U.operator, sid)).toBe(false);
  });
  it('مصروف شهري بقفل قديم expense__ لا يتعدّل', async () => {
    await asUser(U.operator, c => put(c, 'monthly_expenses', 'm1', { expense_name: 'إيجار', total_monthly_cost: 100 }));
    await asServer(async (c) => {
      await put(c, 'journal_entries', 'em1', entry([L('5000', 100, 0), L('1000', 0, 100)], { entryNumber: 61 }));
      await put(c, 'posting_locks', 'expense__m1', { kind: 'expense', sourceId: 'm1', entryId: 'em1' });
    });
    expect(await count(U.accountant, `update monthly_expenses set total_monthly_cost = 1 where id = 'm1'`)).toBe(0);
  });
  it('قواعد الرسوم والشركاء للمدير وحده', async () => {
    expect(await attempt(asUser(U.accountant, c => put(c, 'fee_rules', 'f1', { key: 'mgmt', rate: 0.1 })))).toMatchObject({ ok: false, code: '42501' });
    expect((await attempt(asUser(U.admin, c => put(c, 'fee_rules', 'f1', { key: 'mgmt', rate: 0.1 })))).ok).toBe(true);
    expect(await attempt(asUser(U.accountant, c => put(c, 'partners', 'p1', { partner_name: 'س' })))).toMatchObject({ ok: false, code: '42501' });
  });
  it('إعدادات المحاسبة لا يكتبها أحد من المتصفح؛ بيانات الشركة للمحاسب', async () => {
    expect(await attempt(asUser(U.admin, c => put(c, 'app_settings', 'accounting', { value: { vatRate: 0.15 } })))).toMatchObject({ ok: false, code: '42501' });
    expect((await attempt(asUser(U.accountant, c => put(c, 'app_settings', 'company', { value: { name: 'سويتر' } })))).ok).toBe(true);
    expect(await attempt(asUser(U.operator, c => put(c, 'app_settings', 'other', { value: {} })))).toMatchObject({ ok: false, code: '42501' });
  });
  it('المستخدمون: كلٌّ يقرأ مستنده، والمدير يقرأ الكل؛ الدور لا يتغيّر من المتصفح', async () => {
    expect(await count(U.operator, 'select * from members')).toBe(1);
    expect(await count(U.supervisor, 'select * from members')).toBe(1);
    expect(await count(U.admin, 'select * from members')).toBeGreaterThan(5);
    expect(await attempt(asUser(U.admin, c => c.query(`update members set role = 'admin' where id = $1`, [U.operator])))).toMatchObject({ ok: false, code: '42501' });
    expect(await count(U.admin, `update members set email = 'new@sweater.test' where id = $1`, [U.operator])).toBe(1);
    expect(await attempt(asUser(U.admin, c => c.query('delete from members where id = $1', [U.operator])))).toMatchObject({ ok: false, code: '42501' });
    expect(await count(U.accountant, 'select * from app_admins')).toBe(0);
    expect(await count(U.admin, 'select * from app_admins')).toBe(4);
  });
  it('بند التأسيس الجديد خطة فقط، والتعديل للخادم', async () => {
    expect((await attempt(asUser(U.operator, c => put(c, 'startup_costs', 's1', { item_name: 'سيارة', budgeted_amount: 1000, actual_amount: 0 })))).ok).toBe(true);
    expect(await attempt(asUser(U.operator, c => put(c, 'startup_costs', 's2', { item_name: 'سيارة', actual_amount: 5 })))).toMatchObject({ ok: false, code: '42501' });
    expect(await attempt(asUser(U.admin, c => put(c, 'startup_costs', 's3', { item_name: 'x', converted_at: new Date() })))).toMatchObject({ ok: false, code: '42501' });
    expect(await attempt(asUser(U.admin, c => c.query(`update startup_costs set item_name = 'y' where id = 's1'`)))).toMatchObject({ ok: false, code: '42501' });
  });
  it('السلفة المرحّلة: قلب الاسترداد فقط؛ والمرتبطة بمسير مجمّدة', async () => {
    await asUser(U.operator, async (c) => {
      await put(c, 'temporary_expenses', 't1', { title: 'سلفة', amount: 100, status: 'pending', recovered_date: null });
      await put(c, 'temporary_expenses', 't2', { title: 'سلفة', amount: 50, status: 'pending', payroll_lock_id: null });
    });
    await asServer(async (c) => {
      await put(c, 'journal_entries', 'et1', entry([L('1100', 100, 0), L('1000', 0, 100)], { entryNumber: 70 }));
      await put(c, 'posting_locks', 'temporary_expense__t1', { kind: 'temporary_expense', sourceId: 't1', entryId: 'et1' });
    });
    expect(await count(U.operator, `update temporary_expenses set status = 'recovered', recovered_date = '2026-10-10' where id = 't1'`)).toBe(1);
    expect(await attempt(asUser(U.operator, c => c.query(`update temporary_expenses set amount = 1 where id = 't1'`)))).toMatchObject({ ok: false, code: '42501' });
    expect(await count(U.operator, `update temporary_expenses set title = 'x' where id = 't2'`)).toBe(0);
    expect(await count(U.operator, `delete from temporary_expenses where id = 't2'`)).toBe(0);
  });
  it('دفعة سنوية مرحّلة: الوحدة فقط', async () => {
    await asUser(U.operator, c => put(c, 'annual_expense_entries', 'a1', { annual_expense_id: 'ae1', amount: 300, unit: 'A', spent_date: '2026-10-01' }));
    await asServer(async (c) => {
      await put(c, 'journal_entries', 'ea1', entry([L('5000', 300, 0), L('1000', 0, 300)], { entryNumber: 71 }));
      await put(c, 'posting_locks', 'annual__a1', { kind: 'annual', sourceId: 'a1', entryId: 'ea1' });
    });
    expect(await count(U.operator, `update annual_expense_entries set unit = 'B' where id = 'a1'`)).toBe(1);
    expect(await attempt(asUser(U.operator, c => c.query(`update annual_expense_entries set amount = 1 where id = 'a1'`)))).toMatchObject({ ok: false, code: '42501' });
    expect(await count(U.operator, `delete from annual_expense_entries where id = 'a1'`)).toBe(0);
  });
  it('السندات: المحاسب ينشئ ويعدّل ما لم يُرحَّل، ولا أحد يحذف', async () => {
    expect((await attempt(asUser(U.accountant, c => put(c, 'expense_vouchers', 'tpl__2026-10', { templateId: 'tpl', periodKey: '2026-10', amount: 10 })))).ok).toBe(true);
    expect(await attempt(asUser(U.operator, c => put(c, 'expense_vouchers', 'tpl__2026-11', { templateId: 'tpl', periodKey: '2026-11' })))).toMatchObject({ ok: false, code: '42501' });
    expect(await attempt(asUser(U.admin, c => c.query(`delete from expense_vouchers where id = 'tpl__2026-10'`)))).toMatchObject({ ok: false, code: '42501' });
  });
  it('مفتاح MCP: الشريك يرى مفتاحه فقط', async () => {
    await asServer(async (c) => {
      await put(c, 'partner_mcp_keys', 'pmk_1', { partnerId: 'p1', ownerUid: U.partner, status: 'active' });
      await put(c, 'partner_mcp_keys', 'pmk_2', { partnerId: 'p2', ownerUid: U.partner2, status: 'active' });
    });
    expect(await count(U.partner, 'select * from partner_mcp_keys')).toBe(1);
    expect(await count(U.admin, 'select * from partner_mcp_keys')).toBe(2);
    expect(await count(U.supervisor, 'select * from partner_mcp_keys')).toBe(0);
    // A collection closed to every client refuses outright, as Firestore does.
    expect(await attempt(asUser(U.partner, c => c.query('select * from partner_mcp_key_hashes')))).toMatchObject({ ok: false, code: '42501' });
  });
  it('سويتر: الموظفون يقرؤون بيانات الخادم، والمحاسب يكتب الإعدادات المؤرخة', async () => {
    await asServer(c => put(c, 'sweater_bookings', 'SB1', { sspBookingId: 'SB1', periodKey: '2026-10', processingStatus: 'posted' }));
    expect(await count(U.operator, 'select * from sweater_bookings')).toBe(1);
    expect(await count(U.partner, 'select * from sweater_bookings')).toBe(0);
    expect(await attempt(asUser(U.admin, c => put(c, 'sweater_bookings', 'SB2', { sspBookingId: 'SB2' })))).toMatchObject({ ok: false, code: '42501' });
    expect((await attempt(asUser(U.accountant, c => put(c, 'sweater_price_list', 'pl1', { key: 'wash', effectiveFrom: '2026-10-01' })))).ok).toBe(true);
    expect(await attempt(asUser(U.operator, c => put(c, 'sweater_price_list', 'pl2', { key: 'wash' })))).toMatchObject({ ok: false, code: '42501' });
  });
  it('الخادم لا يحذف من سجل التدقيق ولا يعدّله', async () => {
    await asServer(c => put(c, 'audit_logs', 'a1', { action: 'x' }));
    expect(await attempt(asServer(c => c.query(`delete from audit_logs where id = 'a1'`)))).toMatchObject({ ok: false, code: '42501' });
    expect(await attempt(asServer(c => c.query(`update audit_logs set note = 'y' where id = 'a1'`)))).toMatchObject({ ok: false, code: '42501' });
  });
});
