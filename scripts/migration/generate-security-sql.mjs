#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// يولّد migration الصلاحيات (RLS) من سجل الجداول — مطابقة لـ firestore.rules
// ═══════════════════════════════════════════════════════════════════════════
//   node scripts/migration/generate-security-sql.mjs [--check]
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { SCHEMA } from '../../src/lib/data/schema/registry.js';

const ROOT = new URL('../../', import.meta.url).pathname;
const FILE = `${ROOT}supabase/migrations/20261022000300_security.sql`;
const q = name => `"${name.replace(/"/g, '""')}"`;
const lit = s => `'${String(s).replace(/'/g, "''")}'`;

// ── Per table: the document as jsonb, rebuilt from columns, extra and shape ──
// Field-level rules (which keys changed, is a key present) compare documents,
// exactly as Firestore's `diff().affectedKeys()` and `keys().hasAny()` do.
function docFunction(t) {
  const pairs = t.columns.map(c => `${lit(c.field)}, to_jsonb(r.${q(c.column)})`);
  const chunks = [];
  for (let i = 0; i < pairs.length; i += 40) chunks.push(`jsonb_build_object(${pairs.slice(i, i + 40).join(', ')})`);
  const typed = chunks.length ? chunks.join(' || ') : `'{}'::jsonb`;
  return `create or replace function app.${q(`doc_${t.table}`)}(r public.${q(t.table)}) returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(${typed}) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;`;
}

const READ = {
  staff: '(select app.is_staff())',
  accountant: '(select app.is_accountant())',
  admin: '(select app.is_admin())',
  'members-self': `(id = (select auth.uid())::text or (select app.is_admin()))`,
  owner: `((select app.is_admin()) or ((select app.is_signed_in_known_non_supervisor()) and owner_uid = (select auth.uid())::text))`,
};

function policiesFor(t) {
  const out = []; const T = `public.${q(t.table)}`; const p = t.policy; const name = s => q(`${t.table}_${s}`);
  const grants = new Set();
  if (READ[p.read]) { out.push(`create policy ${name('read')} on ${T} for select to authenticated using (${READ[p.read]});`); grants.add('select'); }
  const op = '(select app.is_operator())'; const acc = '(select app.is_accountant())'; const adm = '(select app.is_admin())';
  const lockFor = kinds => kinds.map(k => `app.not_locked(${lit(k)}, id)`).join(' and ');
  switch (p.write) {
    case 'none': break;
    case 'operator': {
      const guard = p.lock ? ` and ${lockFor(p.lock)}` : p.expenseLock ? ` and app.not_posted_expense(${lit(p.expenseLock)}, id)` : '';
      out.push(`create policy ${name('insert')} on ${T} for insert to authenticated with check (${op});`);
      out.push(`create policy ${name('update')} on ${T} for update to authenticated using (${op}${guard}) with check (${op});`);
      out.push(`create policy ${name('delete')} on ${T} for delete to authenticated using (${op}${guard});`);
      ['insert', 'update', 'delete'].forEach(g => grants.add(g)); break;
    }
    case 'accountant':
      out.push(`create policy ${name('write')} on ${T} for all to authenticated using (${acc}) with check (${acc});`);
      ['insert', 'update', 'delete'].forEach(g => grants.add(g)); break;
    case 'accountant-no-delete':
      out.push(`create policy ${name('insert')} on ${T} for insert to authenticated with check (${acc});`);
      out.push(`create policy ${name('update')} on ${T} for update to authenticated using (${acc}) with check (${acc});`);
      ['insert', 'update'].forEach(g => grants.add(g)); break;
    case 'admin':
      out.push(`create policy ${name('write')} on ${T} for all to authenticated using (${adm}) with check (${adm});`);
      ['insert', 'update', 'delete'].forEach(g => grants.add(g)); break;
    case 'app-settings':
      // Firestore: write if isAccountant() && key != 'accounting'.
      out.push(`create policy ${name('write')} on ${T} for all to authenticated using (${acc} and id <> 'accounting') with check (${acc} and id <> 'accounting');`);
      ['insert', 'update', 'delete'].forEach(g => grants.add(g)); break;
    case 'vouchers':
      out.push(`create policy ${name('insert')} on ${T} for insert to authenticated with check (${acc});`);
      out.push(`create policy ${name('update')} on ${T} for update to authenticated using (${acc} and app.not_posted_expense('voucher', id)) with check (${acc});`);
      ['insert', 'update'].forEach(g => grants.add(g)); break;
    case 'members':
      // create/update by admin; update limited to email/displayName by trigger; never delete.
      out.push(`create policy ${name('insert')} on ${T} for insert to authenticated with check (${adm});`);
      out.push(`create policy ${name('update')} on ${T} for update to authenticated using (${adm}) with check (${adm});`);
      ['insert', 'update'].forEach(g => grants.add(g)); break;
    case 'annual-entries':
      // update: not posted, or only `unit` changes (trigger); delete: not posted.
      out.push(`create policy ${name('insert')} on ${T} for insert to authenticated with check (${op});`);
      out.push(`create policy ${name('update')} on ${T} for update to authenticated using (${op}) with check (${op});`);
      out.push(`create policy ${name('delete')} on ${T} for delete to authenticated using (${op} and app.not_posted_expense('annual', id));`);
      ['insert', 'update', 'delete'].forEach(g => grants.add(g)); break;
    case 'temporary-expenses': {
      const noPayrollKey = `not (app.${q('doc_temporary_expenses')}(temporary_expenses) ? 'payroll_lock_id')`;
      out.push(`create policy ${name('insert')} on ${T} for insert to authenticated with check (${op});`);
      out.push(`create policy ${name('update')} on ${T} for update to authenticated using (${op} and app.not_locked('recovery', id) and ${noPayrollKey}) with check (${op});`);
      out.push(`create policy ${name('delete')} on ${T} for delete to authenticated using (${op} and ${noPayrollKey} and app.not_locked('temporary_expense', id) and app.not_locked('recovery', id));`);
      ['insert', 'update', 'delete'].forEach(g => grants.add(g)); break;
    }
    case 'startup-plan':
      out.push(`create policy ${name('insert')} on ${T} for insert to authenticated with check (${op} and app.startup_plan_only(app.${q('doc_startup_costs')}(startup_costs)));`);
      grants.add('insert'); break;
    default: throw new Error(`${t.table}: unknown write policy ${p.write}`);
  }
  return { out, grants: [...grants] };
}

export function securitySql() {
  const out = [];
  out.push(`-- ═══════════════════════════════════════════════════════════════════════════
-- الصلاحيات — مولَّد من src/lib/data/schema/registry.js بـ
--   node scripts/migration/generate-security-sql.mjs
-- يطابق firestore.rules حرفياً. RLS مفعّل على كل جدول والأصل المنع.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── من المتصل؟ (role() في القواعد) ──
-- users/{uid} موجود وفيه مفتاح role → قيمته؛ وإلا app_admins/{uid} وحده → admin؛ وإلا unknown.
create or replace function app.caller() returns table (role text, user_doc boolean, admin_doc boolean)
language sql stable security definer set search_path = '' as $$
  select
    case
      when m.id is not null and (m.role is not null or coalesce(m.shape -> 'n', '[]'::jsonb) ? 'role' or coalesce(m.shape -> 'r', '{}'::jsonb) ? 'role')
        then coalesce(m.role, 'unknown')
      when m.id is null and a.id is not null then 'admin'
      else 'unknown'
    end,
    m.id is not null,
    a.id is not null
  from (select auth.uid()::text as uid) me
  left join public.members m on m.id = me.uid
  left join public.app_admins a on a.id = me.uid
  where me.uid is not null
$$;
create or replace function app.app_role() returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select role from app.caller()), 'unknown') $$;
create or replace function app.known_role() returns boolean language sql stable security definer set search_path = '' as $$
  select app.app_role() in ('admin', 'accountant', 'operator', 'partner', 'supervisor') $$;
create or replace function app.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select c.role in ('admin', 'accountant', 'operator', 'partner') and (c.admin_doc or c.role = 'admin') from app.caller() c), false) $$;
create or replace function app.is_accountant() returns boolean language sql stable security definer set search_path = '' as $$
  select app.is_admin() or app.app_role() = 'accountant' $$;
create or replace function app.is_operator() returns boolean language sql stable security definer set search_path = '' as $$
  select app.is_accountant() or app.app_role() = 'operator' $$;
create or replace function app.is_member() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select c.role in ('admin', 'accountant', 'operator', 'partner') and (c.user_doc or c.admin_doc) from app.caller() c), false) $$;
create or replace function app.is_staff() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select c.role in ('admin', 'accountant', 'operator', 'partner') and (c.user_doc or c.admin_doc)
    and (c.role <> 'partner' or c.admin_doc) from app.caller() c), false) $$;
create or replace function app.is_signed_in_known_non_supervisor() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select c.role in ('admin', 'accountant', 'operator', 'partner') from app.caller() c), false) $$;

-- ── الأقفال: سجل مرحّل لا يُعدّل (notLocked / notPostedExpense) ──
create or replace function app.not_locked(p_kind text, p_id text) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.posting_locks where id = p_kind || '__' || p_id) $$;
create or replace function app.not_posted_expense(p_kind text, p_id text) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.not_locked(p_kind, p_id) and app.not_locked('expense', p_id) $$;

-- ── diff().affectedKeys(): مفاتيح تغيّرت أو ظهرت أو اختفت ──
create or replace function app.changed_keys(o jsonb, n jsonb) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(k order by k), '{}') from (
    select key as k from jsonb_each(o) union select key from jsonb_each(n)
  ) keys where (o -> k) is distinct from (n -> k) $$;
`);
  for (const t of SCHEMA) out.push(docFunction(t));

  out.push(`
-- ── بند تأسيس جديد = خطة فقط (startupCreateIsPlanOnly) ──
create or replace function app.startup_plan_only(d jsonb) returns boolean language sql immutable set search_path = '' as $$
  select coalesce(d -> 'actual_amount', '0'::jsonb) = '0'::jsonb
    and coalesce(d -> 'is_tax_invoice', 'false'::jsonb) = 'false'::jsonb
    and coalesce(d -> 'invoice_number', 'null'::jsonb) = 'null'::jsonb
    and coalesce(d -> 'invoice_date', 'null'::jsonb) = 'null'::jsonb
    and coalesce(d -> 'supplier', 'null'::jsonb) = 'null'::jsonb
    and coalesce(d -> 'vat_amount', 'null'::jsonb) = 'null'::jsonb
    and coalesce(d -> 'vat_rate', 'null'::jsonb) = 'null'::jsonb
    and not (d ? 'converted_at' or d ? 'converted_by')
    and coalesce(d -> 'status', '"in_progress"'::jsonb) = '"in_progress"'::jsonb $$;

-- ── قيود الحقول على المستخدم (الخادم ledger_server مستثنى) ──
create or replace function app.trg_members_fields() returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user <> 'authenticated' then return new; end if;
  if not (app.changed_keys(app.doc_members(old), app.doc_members(new)) <@ array['email', 'displayName']) then
    raise exception 'لا يتغيّر في حساب المستخدم إلا الإيميل والاسم' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger members_fields before update on public.members for each row execute function app.trg_members_fields();

create or replace function app.trg_annual_entry_fields() returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user <> 'authenticated' then return new; end if;
  if app.not_posted_expense('annual', old.id)
     or app.changed_keys(app.doc_annual_expense_entries(old), app.doc_annual_expense_entries(new)) <@ array['unit'] then
    return new;
  end if;
  raise exception 'دفعة مرحّلة: لا يتغيّر فيها إلا الوحدة' using errcode = '42501';
end $$;
create trigger annual_expense_entries_fields before update on public.annual_expense_entries for each row execute function app.trg_annual_entry_fields();

create or replace function app.trg_temporary_expense_fields() returns trigger language plpgsql set search_path = '' as $$
declare d jsonb;
begin
  if current_user <> 'authenticated' then return new; end if;
  if app.not_locked('temporary_expense', old.id) then return new; end if;
  d := app.doc_temporary_expenses(new);
  if app.changed_keys(app.doc_temporary_expenses(old), d) <@ array['status', 'recovered_date', 'recovery_method']
     and ((d -> 'status' = '"recovered"'::jsonb and jsonb_typeof(d -> 'recovered_date') = 'string')
       or (d -> 'status' = '"pending"'::jsonb and d ? 'recovered_date' and d -> 'recovered_date' = 'null'::jsonb)) then
    return new;
  end if;
  raise exception 'سلفة مرحّلة: يُسمح بقلب الاسترداد فقط' using errcode = '42501';
end $$;
create trigger temporary_expenses_fields before update on public.temporary_expenses for each row execute function app.trg_temporary_expense_fields();

-- ── RLS لكل جدول، والأصل المنع ──
`);
  const extraTables = ['journal_entry_lines', 'firebase_uid_map'];
  for (const name of [...SCHEMA.map(t => t.table), ...extraTables]) {
    out.push(`alter table public.${q(name)} enable row level security;`);
    out.push(`revoke all on public.${q(name)} from anon, authenticated;`);
  }
  out.push('');
  for (const t of SCHEMA) {
    const { out: pol, grants } = policiesFor(t);
    if (pol.length) out.push(`-- ${t.collection}: read ${t.policy.read}, write ${t.policy.write}`, ...pol);
    if (grants.length) out.push(`grant ${grants.join(', ')} on public.${q(t.table)} to authenticated;`);
  }
  out.push(`-- journal entry lines follow their entries; the uid map is for the admin
create policy journal_entry_lines_read on public.journal_entry_lines for select to authenticated using ((select app.is_staff()));
grant select on public.journal_entry_lines to authenticated;
create policy firebase_uid_map_read on public.firebase_uid_map for select to authenticated using ((select app.is_admin()));
grant select on public.firebase_uid_map to authenticated;
`);

  out.push(`-- ── الخادم الموثوق (ledger_server): بلا تجاوز للـRLS، بسياسة صريحة لكل جدول ──
-- The ledger tables cannot be deleted from by anyone (triggers), the audit log
-- is append-only for the server too.`);
  for (const name of [...SCHEMA.map(t => t.table), 'journal_entry_lines']) {
    const appendOnly = ['audit_logs', 'journal_entries', 'journal_entry_lines', 'journal_lines_legacy', 'sweater_raw_payloads',
      'executive_report_revisions', 'finance_report_revisions', 'operations_report_revisions', 'partner_worker_eligibility_audit'].includes(name);
    out.push(`create policy ${q(`${name}_server`)} on public.${q(name)} for all to ledger_server using (true) with check (true);`);
    out.push(`grant select, insert${appendOnly && name === 'audit_logs' ? '' : ', update'}${appendOnly ? '' : ', delete'} on public.${q(name)} to ledger_server;`);
  }
  out.push(`grant select on public.firebase_uid_map to ledger_server;
create policy firebase_uid_map_server on public.firebase_uid_map for select to ledger_server using (true);
grant execute on all functions in schema app to ledger_server, authenticated;
`);
  return `${out.join('\n')}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sql = securitySql();
  if (process.argv.includes('--check')) {
    const current = existsSync(FILE) ? readFileSync(FILE, 'utf8') : '';
    if (current !== sql) { console.error(`${FILE} ليس محدّثاً`); process.exit(1); }
    console.log('محدّث ✓');
  } else { writeFileSync(FILE, sql); console.log(`كُتب ${FILE}`); }
}
