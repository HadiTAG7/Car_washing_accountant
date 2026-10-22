-- ═══════════════════════════════════════════════════════════════════════════
-- الأساس: مخطط داخلي، فحوص التواريخ، «اليوم» بتوقيت الرياض، ودور الخادم
-- ═══════════════════════════════════════════════════════════════════════════

-- `app` holds helpers the browser API (PostgREST) never exposes.
create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- A business date is a local calendar date in Riyadh, stored as text
-- 'YYYY-MM-DD'. It is never converted between time zones: «2026-10-05» is the
-- same day for everyone. The check makes sure it is a real date.
create or replace function app.is_day(v text) returns boolean
language plpgsql immutable parallel safe set search_path = '' as $$
begin
  if v is null then return true; end if;
  if v !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
  return to_char(make_date(substr(v, 1, 4)::int, substr(v, 6, 2)::int, substr(v, 9, 2)::int), 'YYYY-MM-DD') = v;
exception when others then
  return false;
end $$;

create or replace function app.is_month(v text) returns boolean
language sql immutable parallel safe set search_path = '' as $$
  select v is null or v ~ '^\d{4}-(0[1-9]|1[0-2])$'
$$;

-- «Today» and the day of an instant, in Riyadh — never the session's zone.
create or replace function app.riyadh_date(ts timestamptz) returns text
language sql stable parallel safe set search_path = '' as $$
  select to_char((ts at time zone 'Asia/Riyadh')::date, 'YYYY-MM-DD')
$$;
create or replace function app.riyadh_today() returns text
language sql stable parallel safe set search_path = '' as $$
  select app.riyadh_date(now())
$$;

-- The trusted server (Vercel /api) connects as this role: not service_role,
-- no RLS bypass. Its grants and policies are in the security migration. It
-- gets LOGIN and a password outside the repository (Stage 6), never here.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'ledger_server') then
    create role ledger_server nologin noinherit nobypassrls;
  end if;
end $$;
-- The project owner (postgres) may act as it: migrations and tests run as owner.
grant ledger_server to postgres;
grant usage on schema public to ledger_server;
grant usage on schema app to ledger_server;
alter role ledger_server set statement_timeout = '30s';
alter role ledger_server set idle_in_transaction_session_timeout = '30s';
