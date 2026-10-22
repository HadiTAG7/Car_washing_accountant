-- ═══════════════════════════════════════════════════════════════════════════
-- Sweater (سويتر) — Supabase schema
-- Run this in the Supabase SQL editor (or `supabase db push`) to create
-- every table the frontend expects, plus permissive RLS for authenticated
-- users and a small amount of seed data so the dashboard is populated.
-- ═══════════════════════════════════════════════════════════════════════════

-- Required extension for UUID generation
create extension if not exists "pgcrypto";

-- ─── categories ───────────────────────────────────────────────────────────
create table if not exists public.categories (
  id          text primary key,
  label       text not null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

-- ─── startup_costs ─────────────────────────────────────────────────────────
create table if not exists public.startup_costs (
  id                uuid primary key default gen_random_uuid(),
  category          text        not null,
  item_name         text        not null,
  budgeted_amount   numeric(12,2) not null default 0,
  actual_amount     numeric(12,2) not null default 0,
  quantity          integer     not null default 1 check (quantity > 0),
  status            text,          -- 'in_progress' | 'completed'
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists startup_costs_category_idx on public.startup_costs(category);

-- ─── startup_cost_entries (sub-ledger per startup item) ──────────────────────
-- One row per receipt/transaction that contributes to a startup_costs
-- item's actual_amount. The parent roll-up (actual_amount = SUM of its
-- entries) is kept in sync client-side. `is_tax_invoice` flags a
-- VAT-inclusive purchase; the 15% recoverable portion is derived on the
-- client, never stored, so it can't drift from the amount.
create table if not exists public.startup_cost_entries (
  id               uuid          primary key default gen_random_uuid(),
  startup_cost_id  uuid          not null references public.startup_costs(id) on delete cascade,
  description      text          not null,
  amount           numeric(12,2) not null default 0 check (amount >= 0),
  spent_date       date          not null default current_date,
  notes            text,
  invoice_url      text,
  is_tax_invoice   boolean       not null default false,
  created_at       timestamptz   not null default now()
);
create index if not exists startup_cost_entries_parent_idx
  on public.startup_cost_entries(startup_cost_id);
create index if not exists startup_cost_entries_parent_date_idx
  on public.startup_cost_entries(startup_cost_id, spent_date desc);

-- NOTE: the legacy assets / vehicles / maintenance_logs tables (from the
-- original car-wash fleet prototype) were dropped from the live database —
-- no app code reads them. Their definitions and seed data were removed
-- from this file to match.

-- ─── transactions (cash flow — legacy, kept: holds live rows) ──────────────
-- vehicle_id is a plain uuid: it used to reference the (now dropped)
-- vehicles table; the FK went away with it but the column and its rows
-- remain until an explicit decision is made about this table's future.
create table if not exists public.transactions (
  id            uuid primary key default gen_random_uuid(),
  occurred_on   date        not null,
  description   text        not null,
  type          text        not null check (type in ('in','out')),
  amount        numeric(12,2) not null check (amount >= 0),
  vehicle_id    uuid,
  created_at    timestamptz not null default now()
);
create index if not exists transactions_occurred_on_idx on public.transactions(occurred_on desc);
create index if not exists transactions_vehicle_idx     on public.transactions(vehicle_id);
create index if not exists transactions_type_idx        on public.transactions(type);

-- ─── app_settings (simple jsonb key/value store) ───────────────────────────
create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- ─── Updated-at trigger (simple convenience) ───────────────────────────────
create or replace function public.touch_updated_at() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end $$ language plpgsql;

drop trigger if exists startup_costs_touch on public.startup_costs;
create trigger startup_costs_touch
before update on public.startup_costs
for each row execute function public.touch_updated_at();

drop trigger if exists app_settings_touch on public.app_settings;
create trigger app_settings_touch
before update on public.app_settings
for each row execute function public.touch_updated_at();

-- ─── partners ─────────────────────────────────────────────────────────────
-- `paid_amount` tracks the partner's contribution against the per-worker
-- capital fee (20,000 SAR × workers_count). Remaining balance is computed
-- at render time, not stored. The partner's percentage share is also
-- derived on the client (workers_count / total_workers × 100) — it is
-- intentionally NOT a column here.
create table if not exists public.partners (
  id              uuid primary key default gen_random_uuid(),
  partner_name    text not null,
  workers_count   integer not null default 0,
  paid_amount     numeric(12,2) not null default 0 check (paid_amount >= 0),
  contact_number  text,
  status          text not null default 'active',
  user_id         uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists partners_user_id_idx on public.partners(user_id);

-- ─── partner_payments (Module 8 — per-partner capital receipts ledger) ───
-- Stores every individual payment a partner makes against their required
-- capital fee. The trigger below keeps `partners.paid_amount` in sync as
-- SUM(amount) per partner, so the legacy Partners page (which still reads
-- the cached aggregate) stays accurate without any client changes.
create table if not exists public.partner_payments (
  id              uuid primary key default gen_random_uuid(),
  partner_id      uuid not null references public.partners(id) on delete cascade,
  amount          numeric(12,2) not null default 0 check (amount >= 0),
  payment_date    date          not null default current_date,
  payment_method  text          not null default 'bank_transfer'
                  check (payment_method in ('bank_transfer','cash','mada_pos')),
  notes           text,
  created_at      timestamptz   not null default now()
);
create index if not exists partner_payments_partner_id_idx on public.partner_payments(partner_id);
create index if not exists partner_payments_date_idx       on public.partner_payments(payment_date);

-- ─── variable_expense_categories (Module 4 — dynamic category list) ──────
-- Mirrors monthly_expense_categories. UUID id auto-generated; clients must
-- NOT supply an id when inserting.
create table if not exists public.variable_expense_categories (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  sort_order  integer not null default 0,
  is_dynamic  boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ─── variable_expenses (Module 4 — per-wash / per-unit logged expenses) ──
-- One-off logged events with a specific date (not recurring). Stores both
-- unit_cost and total_variable_cost so the page renders unit cost directly.
create table if not exists public.variable_expenses (
  id                    uuid primary key default gen_random_uuid(),
  expense_name          text not null,
  category_id           uuid references public.variable_expense_categories(id) on delete set null,
  quantity              integer not null default 1 check (quantity > 0),
  unit_cost             numeric(12,2) not null default 0 check (unit_cost >= 0),
  total_variable_cost   numeric(12,2) not null default 0 check (total_variable_cost >= 0),
  logged_date           date,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists variable_expenses_logged_date_idx on public.variable_expenses(logged_date desc);
create index if not exists variable_expenses_category_id_idx on public.variable_expenses(category_id);

drop trigger if exists variable_expenses_touch on public.variable_expenses;
create trigger variable_expenses_touch
before update on public.variable_expenses
for each row execute function public.touch_updated_at();

-- ─── monthly_expense_categories (Module 3 — dynamic category list) ───────
-- Mirrors annual_expense_categories. UUID id is auto-generated; clients
-- should NOT supply an id when inserting.
create table if not exists public.monthly_expense_categories (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

-- ─── washes (Module 5 — bulk-quantity service log) ───────────────────────
-- Each row represents a batch of N washes (quantity column). The Variable
-- Expenses page sums quantity for completed rows to auto-scale the biker
-- commissions rule.
create table if not exists public.washes (
  id              uuid primary key default gen_random_uuid(),
  biker_name      text,
  quantity        integer not null default 1 check (quantity > 0),
  price           numeric(12,2) not null default 40 check (price >= 0),
  status          text not null default 'مكتملة'
                  check (status in ('مكتملة','قيد التنفيذ')),
  wash_date       date,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists washes_wash_date_idx on public.washes(wash_date desc);
create index if not exists washes_status_idx    on public.washes(status);

drop trigger if exists washes_touch on public.washes;
create trigger washes_touch
before update on public.washes
for each row execute function public.touch_updated_at();

-- ─── category_budgets (Module 7 — budget allocations vs actual spend) ────
-- One row per budget envelope. category_label is a free-text key matched
-- against expense names and category labels at display time (no FK so
-- users can budget for things they haven't yet logged).
create table if not exists public.category_budgets (
  id              uuid primary key default gen_random_uuid(),
  category_label  text not null,
  budget_type     text not null default 'monthly'
                  check (budget_type in ('monthly','annual')),
  amount          numeric(12,2) not null default 0 check (amount >= 0),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists category_budgets_type_idx on public.category_budgets(budget_type);

drop trigger if exists category_budgets_touch on public.category_budgets;
create trigger category_budgets_touch
before update on public.category_budgets
for each row execute function public.touch_updated_at();

-- ─── monthly_expenses (Module 3 — recurring monthly operational costs) ───
-- Stores BOTH unit_cost and total_monthly_cost (= quantity × unit_cost),
-- so the table can render the unit cost directly without divide-on-read.
-- `recurrence` distinguishes a recurring monthly expense from a one-off
-- payment that happens to be recorded under the monthly tab. For 'one_time'
-- rows, `logged_date` carries the actual paid-on date so downstream
-- computations (budgets, income statement) know which month it belongs to.
create table if not exists public.monthly_expenses (
  id                  uuid primary key default gen_random_uuid(),
  expense_name        text not null,
  category_id         uuid references public.monthly_expense_categories(id) on delete set null,
  quantity            integer not null default 1 check (quantity > 0),
  unit_cost           numeric(12,2) not null default 0 check (unit_cost >= 0),
  total_monthly_cost  numeric(12,2) not null default 0 check (total_monthly_cost >= 0),
  payment_day         integer      check (payment_day is null or (payment_day between 1 and 31)),
  payment_status      text not null default 'pending'
                      check (payment_status in ('paid','pending')),
  recurrence          text not null default 'monthly'
                      check (recurrence in ('monthly','one_time')),
  logged_date         date,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists monthly_expenses_payment_day_idx     on public.monthly_expenses(payment_day);
create index if not exists monthly_expenses_payment_status_idx  on public.monthly_expenses(payment_status);
create index if not exists monthly_expenses_category_id_idx    on public.monthly_expenses(category_id);
create index if not exists monthly_expenses_recurrence_idx     on public.monthly_expenses(recurrence);
create index if not exists monthly_expenses_logged_date_idx    on public.monthly_expenses(logged_date);

drop trigger if exists monthly_expenses_touch on public.monthly_expenses;
create trigger monthly_expenses_touch
before update on public.monthly_expenses
for each row execute function public.touch_updated_at();

-- ─── annual_expense_categories (Module 2 — dynamic category list) ─────────
-- IMPORTANT: id is UUID (matches the rest of the schema). The client must
-- NOT generate an id — it should let this default fill in a fresh UUID.
create table if not exists public.annual_expense_categories (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

-- ─── annual_expenses (Module 2 — recurring fleet expenses) ─────────────────
-- `actual_amount` is the ledger roll-up: SUM(annual_expense_entries.amount)
-- maintained client-side after every entry add/delete (alongside an
-- automatic payment_status flip when the sum reaches annual_cost).
create table if not exists public.annual_expenses (
  id              uuid primary key default gen_random_uuid(),
  expense_name    text        not null,
  category        text        not null,
  annual_cost     numeric(12,2) not null default 0 check (annual_cost >= 0),
  actual_amount   numeric(12,2) not null default 0,
  quantity        integer     not null default 1 check (quantity > 0),
  payment_month   integer     check (payment_month is null or (payment_month between 1 and 12)),
  payment_day     integer     check (payment_day   is null or (payment_day   between 1 and 31)),
  payment_status  text        not null default 'pending'
                  check (payment_status in ('paid','pending')),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists annual_expenses_payment_month_idx  on public.annual_expenses(payment_month);
create index if not exists annual_expenses_payment_day_idx    on public.annual_expenses(payment_day);
create index if not exists annual_expenses_payment_status_idx on public.annual_expenses(payment_status);

drop trigger if exists annual_expenses_touch on public.annual_expenses;
create trigger annual_expenses_touch
before update on public.annual_expenses
for each row execute function public.touch_updated_at();

-- ─── annual_expense_entries (sub-ledger per annual expense) ────────────────
-- One row per payment/receipt that contributes to an annual_expenses
-- row's actual_amount. Mirrors startup_cost_entries exactly:
-- `is_tax_invoice` flags a VAT-inclusive payment; the 15% recoverable
-- portion is derived on the client, never stored.
create table if not exists public.annual_expense_entries (
  id                 uuid          primary key default gen_random_uuid(),
  annual_expense_id  uuid          not null references public.annual_expenses(id) on delete cascade,
  description        text          not null,
  amount             numeric(12,2) not null default 0 check (amount >= 0),
  spent_date         date          not null default current_date,
  notes              text,
  invoice_url        text,
  is_tax_invoice     boolean       not null default false,
  created_at         timestamptz   not null default now()
);
create index if not exists annual_expense_entries_parent_idx
  on public.annual_expense_entries(annual_expense_id);
create index if not exists annual_expense_entries_parent_date_idx
  on public.annual_expense_entries(annual_expense_id, spent_date desc);

-- ─── temporary_expenses (Module 9 — reimbursable outlays ledger) ──────────
-- Temporary outlays the business pays now and recovers later (refunds,
-- deposits, advances). `status` flips between 'pending' and 'recovered';
-- `recovered_date` is required iff status = 'recovered' (CHECK enforced).
create table if not exists public.temporary_expenses (
  id              uuid primary key default gen_random_uuid(),
  title           text          not null,
  amount          numeric(12,2) not null default 0 check (amount >= 0),
  spent_date      date          not null default current_date,
  status          text          not null default 'pending'
                  check (status in ('pending','recovered')),
  recovered_date  date,
  notes           text,
  created_at      timestamptz   not null default now(),
  constraint temporary_expenses_recovery_consistency_chk check (
    (status = 'recovered' and recovered_date is not null)
    or
    (status = 'pending'   and recovered_date is null)
  )
);
create index if not exists temporary_expenses_status_idx     on public.temporary_expenses(status);
create index if not exists temporary_expenses_spent_date_idx on public.temporary_expenses(spent_date);

-- ═══════════════════════════════════════════════════════════════════════════
-- Row-Level Security — member read / admin write (RBAC)
-- ═══════════════════════════════════════════════════════════════════════════
-- Roles:
--   admin  = user_id listed in public.app_admins (explicit allow-list)
--   member = admin OR a user linked to a partners row (partners.user_id)
-- Every business table: SELECT for members, ALL for admins. A freshly
-- self-registered account that is neither admin nor a linked partner
-- reads zero rows and cannot write anything.
-- The is_admin()/is_member() helpers live in the Functions section below.

-- Admin allow-list. ⚠️ Seed at least one admin after a fresh install:
--   insert into public.app_admins (user_id, note)
--   select id, 'primary admin' from auth.users where email = '<admin-email>';
create table if not exists public.app_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;

alter table public.categories        enable row level security;
alter table public.startup_costs     enable row level security;
alter table public.startup_cost_entries enable row level security;
alter table public.transactions      enable row level security;
alter table public.app_settings      enable row level security;
alter table public.partners                    enable row level security;
alter table public.partner_payments             enable row level security;
alter table public.annual_expense_categories   enable row level security;
alter table public.annual_expenses             enable row level security;
alter table public.annual_expense_entries      enable row level security;
alter table public.monthly_expense_categories  enable row level security;
alter table public.monthly_expenses            enable row level security;
alter table public.variable_expense_categories enable row level security;
alter table public.variable_expenses           enable row level security;
alter table public.washes                      enable row level security;
alter table public.category_budgets             enable row level security;
alter table public.temporary_expenses           enable row level security;

-- NOTE: the policies themselves are created AFTER the Functions
-- section below (they reference is_admin()/is_member(), which must
-- exist first on a fresh top-to-bottom run).

-- ═══════════════════════════════════════════════════════════════════════════
-- Seed data (idempotent — only inserts when tables are empty)
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.categories (id, label, sort_order)
select * from (values
  ('legal-permits',      'تراخيص ورسوم قانونية',       1),
  ('franchise-sweater',  'رسوم الامتياز لـ سويتر',      2),
  ('branding-marketing', 'هوية بصرية وتسويق افتتاحي',  3),
  ('other',              'أخرى',                        4)
) as t(id, label, sort_order)
where not exists (select 1 from public.categories);

-- (Module 1 spec: no startup_costs seed rows — users add their own.)

-- (The legacy assets / vehicles / maintenance_logs / transactions demo
-- seeds were removed along with the dropped fleet tables — no app page
-- reads them, and fake fleet data has no place in a fresh install.)

-- Default unit-economics settings
insert into public.app_settings (key, value)
values (
  'unit_economics',
  '{"avgOrderPrice":95,"variableCostPerOrder":34,"monthlyFixedCosts":7625,"estimatedOrders":825}'::jsonb
)
on conflict (key) do nothing;

-- Total achieved washes counter (Module 4 dynamic-rule baseline).
-- Edited inline from the Variable Expenses page; rule-based categories
-- like "عمولات البايكرز والموزعين" multiply this against their unit_cost.
insert into public.app_settings (key, value)
values ('total_achieved_washes', '{"count":0}'::jsonb)
on conflict (key) do nothing;

-- ─── annual_expense_categories — defensive column repair ──────────────────
-- If an older version of this table exists (e.g. created in the dashboard
-- with different column names or without a default on id), `create table
-- if not exists` above won't touch it. These statements ensure the table
-- ends up with the exact shape the app expects.
alter table public.annual_expense_categories
  add column if not exists label      text;
alter table public.annual_expense_categories
  add column if not exists sort_order integer not null default 0;
alter table public.annual_expense_categories
  add column if not exists created_at timestamptz not null default now();
-- Ensure id auto-generates UUIDs when omitted from inserts (required by
-- the new addCategory flow, which sends only label + sort_order).
alter table public.annual_expense_categories
  alter column id set default gen_random_uuid();

-- Default recurring-expense categories (Module 2 dropdown source). We
-- omit id and let the column default generate UUIDs; the WHERE NOT EXISTS
-- guard keeps the block idempotent on re-runs.
insert into public.annual_expense_categories (label, sort_order)
select * from (values
  ('تأمين شامل للأسطول',       1),
  ('تراخيص ورسوم حكومية',      2),
  ('اشتراكات برمجية وأنظمة',   3),
  ('تسويق وحملات سنوية',       4),
  ('أخرى',                     5)
) as t(label, sort_order)
where not exists (select 1 from public.annual_expense_categories);

-- ─── monthly_expenses — defensive column repair ───────────────────────────
-- Ensure all columns + the UUID default exist when this script runs against
-- a partial/older DB. Idempotent on re-run.
alter table public.monthly_expense_categories
  add column if not exists label      text;
alter table public.monthly_expense_categories
  add column if not exists sort_order integer not null default 0;
alter table public.monthly_expense_categories
  add column if not exists created_at timestamptz not null default now();
alter table public.monthly_expense_categories
  alter column id set default gen_random_uuid();

alter table public.monthly_expenses
  add column if not exists quantity           integer not null default 1;
alter table public.monthly_expenses
  add column if not exists unit_cost          numeric(12,2) not null default 0;
alter table public.monthly_expenses
  add column if not exists total_monthly_cost numeric(12,2) not null default 0;
alter table public.monthly_expenses
  add column if not exists payment_status     text not null default 'pending';
alter table public.monthly_expenses
  add column if not exists category_id        uuid;
alter table public.monthly_expenses
  alter column id set default gen_random_uuid();
alter table public.monthly_expenses
  drop constraint if exists monthly_expenses_quantity_chk;
alter table public.monthly_expenses
  add  constraint monthly_expenses_quantity_chk
  check (quantity > 0);
alter table public.monthly_expenses
  drop constraint if exists monthly_expenses_status_chk;
alter table public.monthly_expenses
  add  constraint monthly_expenses_status_chk
  check (payment_status in ('paid','pending'));

-- Recurring payment-day column (replaces billing_date in the UI).
alter table public.monthly_expenses
  add column if not exists payment_day integer;
alter table public.monthly_expenses
  drop constraint if exists monthly_expenses_payment_day_chk;
alter table public.monthly_expenses
  add  constraint monthly_expenses_payment_day_chk
  check (payment_day is null or (payment_day between 1 and 31));

-- Recurrence + paid-on date columns: lets a "monthly tab" row be either
-- a recurring monthly fixed cost or a single one-off expense for a
-- specific date. logged_date is nullable for backwards-compat with the
-- recurring rows; one_time rows should populate it.
alter table public.monthly_expenses
  add column if not exists recurrence  text not null default 'monthly';
alter table public.monthly_expenses
  add column if not exists logged_date date;
alter table public.monthly_expenses
  drop constraint if exists monthly_expenses_recurrence_chk;
alter table public.monthly_expenses
  add  constraint monthly_expenses_recurrence_chk
  check (recurrence in ('monthly','one_time'));
create index if not exists monthly_expenses_recurrence_idx  on public.monthly_expenses(recurrence);
create index if not exists monthly_expenses_logged_date_idx on public.monthly_expenses(logged_date);

-- One-shot migration: pull the day-of-month out of legacy billing_date
-- when payment_day hasn't been set yet. Guarded so a DB whose
-- billing_date column has already been dropped doesn't error.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'monthly_expenses'
       and column_name  = 'billing_date'
  ) then
    update public.monthly_expenses
       set payment_day = extract(day from billing_date)::int
     where billing_date is not null and payment_day is null;
  end if;
end $$;

-- Seed the six default fleet-monthly categories on a fresh DB. Omit `id`
-- so the UUID default kicks in; the WHERE NOT EXISTS guard keeps this
-- block idempotent across re-runs.
insert into public.monthly_expense_categories (label, sort_order)
select * from (values
  ('رواتب وأجور',          1),
  ('إيجار ومرافق',         2),
  ('محروقات',              3),
  ('مستلزمات تشغيلية',     4),
  ('صيانة دورية',          5),
  ('أخرى',                 6)
) as t(label, sort_order)
where not exists (select 1 from public.monthly_expense_categories);

-- ─── variable_expenses — defensive column repair ──────────────────────────
-- Ensure all columns + the UUID default exist when this script runs against
-- a partial/older DB. Idempotent on re-run.
alter table public.variable_expense_categories
  add column if not exists label      text;
alter table public.variable_expense_categories
  add column if not exists sort_order integer not null default 0;
alter table public.variable_expense_categories
  add column if not exists is_dynamic boolean not null default false;
alter table public.variable_expense_categories
  add column if not exists created_at timestamptz not null default now();
alter table public.variable_expense_categories
  alter column id set default gen_random_uuid();

alter table public.variable_expenses
  add column if not exists quantity            integer not null default 1;
alter table public.variable_expenses
  add column if not exists unit_cost           numeric(12,2) not null default 0;
alter table public.variable_expenses
  add column if not exists total_variable_cost numeric(12,2) not null default 0;
alter table public.variable_expenses
  add column if not exists logged_date         date;
alter table public.variable_expenses
  add column if not exists category_id         uuid;
alter table public.variable_expenses
  alter column id set default gen_random_uuid();
alter table public.variable_expenses
  drop constraint if exists variable_expenses_quantity_chk;
alter table public.variable_expenses
  add  constraint variable_expenses_quantity_chk
  check (quantity > 0);

-- Seed five default variable-expense categories on a fresh DB. Omit `id`
-- so the UUID default kicks in; WHERE NOT EXISTS keeps it idempotent.
insert into public.variable_expense_categories (label, sort_order)
select * from (values
  ('عمولات البايكرز والموزعين',  1),
  ('مستلزمات لكل غسلة',          2),
  ('مكافآت أداء وحوافز',         3),
  ('نقل ومواصلات',               4),
  ('أخرى',                       5)
) as t(label, sort_order)
where not exists (select 1 from public.variable_expense_categories);

-- Flag the default biker commissions category as a dynamic rule (its
-- quantity is computed live from total_achieved_washes). Guarded so a
-- user's later toggles of other categories aren't clobbered on re-runs.
update public.variable_expense_categories
   set is_dynamic = true
 where label = 'عمولات البايكرز والموزعين'
   and is_dynamic = false
   and not exists (
     select 1 from public.variable_expense_categories where is_dynamic = true
   );

-- ─── annual_expenses — defensive column repair ────────────────────────────
-- Existing DBs created before the quantity column was added get it now
-- with a sensible default (1 × stored total preserves the persisted
-- annual_cost). Re-runs are no-ops.
alter table public.annual_expenses
  add column if not exists quantity integer not null default 1;
alter table public.annual_expenses
  drop constraint if exists annual_expenses_quantity_chk;
alter table public.annual_expenses
  add  constraint annual_expenses_quantity_chk
  check (quantity > 0);

-- Recurring payment-month + payment-day columns (replace due_date in the UI).
alter table public.annual_expenses
  add column if not exists payment_month integer;
alter table public.annual_expenses
  add column if not exists payment_day   integer;
alter table public.annual_expenses
  drop constraint if exists annual_expenses_payment_month_chk;
alter table public.annual_expenses
  add  constraint annual_expenses_payment_month_chk
  check (payment_month is null or (payment_month between 1 and 12));
alter table public.annual_expenses
  drop constraint if exists annual_expenses_payment_day_chk;
alter table public.annual_expenses
  add  constraint annual_expenses_payment_day_chk
  check (payment_day is null or (payment_day between 1 and 31));

-- One-shot migration: pull month + day out of legacy due_date when the
-- new columns aren't populated yet. Guarded so a DB whose due_date
-- column has already been dropped doesn't error.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'annual_expenses'
       and column_name  = 'due_date'
  ) then
    update public.annual_expenses
       set payment_month = extract(month from due_date)::int,
           payment_day   = extract(day   from due_date)::int
     where due_date is not null
       and (payment_month is null or payment_day is null);
  end if;
end $$;

-- ─── category_budgets — defensive column repair ──────────────────────────
-- Ensure the UUID default + check constraints exist on existing DBs.
alter table public.category_budgets
  add column if not exists category_label text;
alter table public.category_budgets
  add column if not exists budget_type    text not null default 'monthly';
alter table public.category_budgets
  add column if not exists amount         numeric(12,2) not null default 0;
alter table public.category_budgets
  alter column id set default gen_random_uuid();
alter table public.category_budgets
  drop constraint if exists category_budgets_type_chk;
alter table public.category_budgets
  add  constraint category_budgets_type_chk
  check (budget_type in ('monthly','annual'));
alter table public.category_budgets
  drop constraint if exists category_budgets_amount_chk;
alter table public.category_budgets
  add  constraint category_budgets_amount_chk
  check (amount >= 0);

-- ─── washes — defensive column repair ─────────────────────────────────────
-- Ensure all columns + the UUID default + check constraints exist on
-- partial/older DBs. Idempotent on re-run.
alter table public.washes
  add column if not exists biker_name   text;
alter table public.washes
  add column if not exists price        numeric(12,2) not null default 40;
alter table public.washes
  add column if not exists status       text not null default 'مكتملة';
alter table public.washes
  add column if not exists wash_date    date;
alter table public.washes
  alter column id set default gen_random_uuid();
alter table public.washes
  drop constraint if exists washes_status_chk;
alter table public.washes
  add  constraint washes_status_chk
  check (status in ('مكتملة','قيد التنفيذ'));
alter table public.washes
  drop constraint if exists washes_price_chk;
alter table public.washes
  add  constraint washes_price_chk
  check (price >= 0);

-- Bulk-quantity refactor: add the new `quantity` column + soften the
-- legacy per-car columns so existing rows survive but new inserts no
-- longer need vehicle_type / plate_number / service_type / biker_name.
-- check (x in (...)) constraints on the enum columns pass NULLs by
-- default, so no constraint drop is required there.
alter table public.washes
  add column if not exists quantity integer not null default 1;
alter table public.washes
  drop constraint if exists washes_quantity_chk;
alter table public.washes
  add  constraint washes_quantity_chk
  check (quantity > 0);
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='washes'
                and column_name='vehicle_type') then
    alter table public.washes alter column vehicle_type drop not null;
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='washes'
                and column_name='plate_number') then
    alter table public.washes alter column plate_number drop not null;
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='washes'
                and column_name='service_type') then
    alter table public.washes alter column service_type drop not null;
  end if;
end $$;
alter table public.washes alter column biker_name drop not null;

-- ─── partners — defensive column repair ──────────────────────────────────
-- `paid_amount` is a later addition; older databases predate it. The
-- (briefly-shipped) `percentage` column is intentionally NOT added here
-- — the partner's share is a pure client-side derivation now.
alter table public.partners
  add column if not exists paid_amount numeric(12,2) not null default 0;
alter table public.partners
  drop constraint if exists partners_paid_amount_chk;
alter table public.partners
  add  constraint partners_paid_amount_chk
  check (paid_amount >= 0);

-- ─── partner_payments — defensive repair + sync trigger ──────────────────
-- The ledger table itself + the trigger that keeps `partners.paid_amount`
-- equal to SUM(partner_payments.amount) for each partner. Trigger fires
-- after INSERT / UPDATE / DELETE and recomputes the aggregate so the
-- legacy Partners page stays accurate without any client refactor.
alter table public.partner_payments
  add column if not exists amount         numeric(12,2) not null default 0;
alter table public.partner_payments
  add column if not exists payment_date   date          not null default current_date;
alter table public.partner_payments
  add column if not exists payment_method text          not null default 'bank_transfer';
alter table public.partner_payments
  add column if not exists notes          text;
alter table public.partner_payments
  drop constraint if exists partner_payments_amount_chk;
alter table public.partner_payments
  add  constraint partner_payments_amount_chk
  check (amount >= 0);
alter table public.partner_payments
  drop constraint if exists partner_payments_method_chk;
alter table public.partner_payments
  add  constraint partner_payments_method_chk
  check (payment_method in ('bank_transfer','cash','mada_pos'));

create or replace function public.sync_partner_paid_amount() returns trigger
language plpgsql as $$
begin
  if (tg_op = 'DELETE') then
    update public.partners
       set paid_amount = (
         select coalesce(sum(amount), 0)
           from public.partner_payments
          where partner_id = old.partner_id
       )
     where id = old.partner_id;
    return old;
  end if;
  update public.partners
     set paid_amount = (
       select coalesce(sum(amount), 0)
         from public.partner_payments
        where partner_id = new.partner_id
     )
   where id = new.partner_id;
  return new;
end;
$$;

drop trigger if exists partner_payments_sync on public.partner_payments;
create trigger partner_payments_sync
after insert or update or delete on public.partner_payments
for each row execute function public.sync_partner_paid_amount();

-- Tell PostgREST to refresh its schema introspection now that the table
-- and its columns are guaranteed. Without this, the REST API can keep
-- returning "Could not find the 'label' column ... in the schema cache"
-- until the next auto-reload.
notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 2026-05 — Module 1 (Startup Sunk Costs) rebuild
-- Replaces legacy mobile-fleet categories+items with the 4 franchise-startup
-- categories, and constrains startup_costs.status to ('in_progress','completed').
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
begin
  -- 1) Wipe legacy seed items whose categories no longer exist in the new set.
  --    NOTE: the id 'other' is shared between the old and new category sets,
  --    so we delete the single legacy 'other' row by its exact seed item_name
  --    instead of by category — protects user-added rows on migration re-runs.
  delete from public.startup_costs
   where category in (
     'vehicle-purchase','vehicle-customization','portable-equipment',
     'routing-software','mobile-permits','marketing','supplies'
   );
  delete from public.startup_costs
   where category = 'other' and item_name = 'احتياطي تشغيلي'
     and budgeted_amount = 74000 and actual_amount = 65000;

  -- 2) Wipe legacy categories (everything except 'other', which is kept and
  --    re-labeled by the upsert below).
  delete from public.categories
   where id in (
     'vehicle-purchase','vehicle-customization','portable-equipment',
     'routing-software','mobile-permits','marketing','supplies'
   );

  -- 3) Upsert the 4 franchise-startup categories.
  insert into public.categories (id, label, sort_order) values
    ('legal-permits',      'تراخيص ورسوم قانونية',       1),
    ('franchise-sweater',  'رسوم الامتياز لـ سويتر',      2),
    ('branding-marketing', 'هوية بصرية وتسويق افتتاحي',  3),
    ('other',              'أخرى',                        4)
  on conflict (id) do update
    set label      = excluded.label,
        sort_order = excluded.sort_order;

  -- 4) Normalize any legacy status values to the new enum.
  update public.startup_costs
     set status = case
       when status in ('completed','in_progress') then status
       else 'in_progress'
     end;
end $$;

alter table public.startup_costs
  alter column status set default 'in_progress';

alter table public.startup_costs
  drop constraint if exists startup_costs_status_chk;
alter table public.startup_costs
  add  constraint startup_costs_status_chk
  check (status in ('in_progress','completed'));

-- Add the `quantity` column for existing DBs (default 1; existing rows
-- become "1 × total" which preserves their persisted totals exactly).
alter table public.startup_costs
  add column if not exists quantity integer not null default 1;
alter table public.startup_costs
  drop constraint if exists startup_costs_quantity_chk;
alter table public.startup_costs
  add  constraint startup_costs_quantity_chk
  check (quantity > 0);

-- ═══════════════════════════════════════════════════════════════════════════
-- Functions — admin detection + secure email→UUID lookup
-- ═══════════════════════════════════════════════════════════════════════════
-- These previously lived only in migrations
-- (2026_05_admin_helper_and_secure_rpc.sql), which meant a fresh install
-- from schema.sql alone was missing the RPC the partner-linking UI calls
-- (supabase.rpc('get_user_id_by_email')) and broke at runtime.

-- is_admin(): TRUE only for a signed-in user listed in app_admins.
-- (Previously "any authenticated user without a partners row", which made
-- every fresh self-registered account an admin — closed by the RBAC
-- migration 2026_07_admin_rbac.sql.)
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public, auth
as $$
  select auth.uid() is not null and exists (
    select 1 from public.app_admins a where a.user_id = auth.uid()
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- is_member(): admin OR a user linked to a partners row. SECURITY DEFINER
-- so the partners lookup bypasses partners' own RLS (no recursion).
create or replace function public.is_member()
returns boolean
language sql
security definer
stable
set search_path = public, auth
as $$
  select auth.uid() is not null and (
    exists (select 1 from public.app_admins a where a.user_id = auth.uid())
    or exists (select 1 from public.partners p where p.user_id = auth.uid())
  );
$$;

revoke all on function public.is_member() from public, anon;
grant execute on function public.is_member() to authenticated;

-- get_user_id_by_email(): resolves an email to auth.users.id — but only
-- for admin callers. Non-admins (and no-match lookups) both get NULL, so
-- the caller can't distinguish "not registered" from "not authorised".
create or replace function public.get_user_id_by_email(email_search text)
returns uuid
language sql
security definer
stable
set search_path = public, auth
as $$
  select case
    when public.is_admin() then (
      select id
        from auth.users
       where lower(email) = lower(trim(email_search))
       limit 1
    )
    else null
  end;
$$;

revoke all on function public.get_user_id_by_email(text) from public, anon;
grant execute on function public.get_user_id_by_email(text) to authenticated;

-- ── RBAC policies (need the helpers above) ─────────────────────────────
-- app_admins is admin-managed only.
drop policy if exists "admin_all" on public.app_admins;
create policy "admin_all" on public.app_admins
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Business tables: drop the legacy blanket policy, install the pair.
do $$
declare t text;
begin
  foreach t in array array[
    'categories','startup_costs','startup_cost_entries','transactions',
    'app_settings','partners','partner_payments',
    'annual_expense_categories','annual_expenses','annual_expense_entries',
    'monthly_expense_categories','monthly_expenses',
    'variable_expense_categories','variable_expenses',
    'washes','category_budgets','temporary_expenses'
  ] loop
    execute format('drop policy if exists "rw_auth" on public.%I', t);
    execute format('drop policy if exists "admin_all" on public.%I', t);
    execute format('drop policy if exists "member_read" on public.%I', t);
    execute format(
      'create policy "admin_all" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
    execute format(
      'create policy "member_read" on public.%I for select to authenticated using (public.is_member())', t);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Storage — public 'invoices' bucket for invoice/receipt uploads
-- ═══════════════════════════════════════════════════════════════════════════
-- uploadInvoiceFile (src/lib/supabaseClient.js) stores files here and the
-- returned public URL lands in *_entries.invoice_url. Public-read (URLs
-- are shared in ledgers/CSV; keys carry a random UUID slice so they are
-- unguessable), authenticated-write, 10MB cap, image/PDF mimes only.
-- Mirrors supabase/migrations/2026_06_invoices_storage_bucket.sql.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'invoices',
  'invoices',
  true,
  10485760, -- 10MB
  array['image/jpeg','image/png','image/webp','image/gif','application/pdf']
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "invoices_public_read" on storage.objects;
create policy "invoices_public_read" on storage.objects
  for select to public
  using (bucket_id = 'invoices');

drop policy if exists "invoices_auth_insert" on storage.objects;
create policy "invoices_auth_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'invoices' and public.is_admin());

drop policy if exists "invoices_auth_update" on storage.objects;
create policy "invoices_auth_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'invoices' and public.is_admin());

drop policy if exists "invoices_auth_delete" on storage.objects;
create policy "invoices_auth_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'invoices' and public.is_admin());

notify pgrst, 'reload schema';
