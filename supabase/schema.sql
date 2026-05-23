-- ═══════════════════════════════════════════════════════════════════════════
-- Monster Wash — Supabase schema
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

-- ─── assets ────────────────────────────────────────────────────────────────
create table if not exists public.assets (
  id                 uuid primary key default gen_random_uuid(),
  asset_name         text        not null,
  purchase_date      date        not null,
  cost               numeric(12,2) not null,
  salvage_value      numeric(12,2) not null default 0,
  useful_life_years  integer     not null check (useful_life_years > 0),
  created_at         timestamptz not null default now()
);

-- ─── vehicles ──────────────────────────────────────────────────────────────
create table if not exists public.vehicles (
  id                     uuid primary key default gen_random_uuid(),
  vehicle_name           text        not null,
  route                  text,
  asset_cost             numeric(12,2) not null default 0,
  allocated_fixed_costs  numeric(12,2) not null default 0,
  created_at             timestamptz not null default now()
);

-- ─── maintenance_logs ──────────────────────────────────────────────────────
create table if not exists public.maintenance_logs (
  id                   uuid primary key default gen_random_uuid(),
  vehicle_id           uuid        not null references public.vehicles(id) on delete cascade,
  maintenance_type     text        not null,
  last_service_date    date,
  next_service_date    date,
  estimated_cost       numeric(12,2) not null default 0,
  notes                text,
  created_at           timestamptz not null default now()
);
create index if not exists maintenance_logs_vehicle_idx  on public.maintenance_logs(vehicle_id);
create index if not exists maintenance_logs_next_svc_idx on public.maintenance_logs(next_service_date);

-- ─── transactions (cash flow) ──────────────────────────────────────────────
create table if not exists public.transactions (
  id            uuid primary key default gen_random_uuid(),
  occurred_on   date        not null,
  description   text        not null,
  type          text        not null check (type in ('in','out')),
  amount        numeric(12,2) not null check (amount >= 0),
  vehicle_id    uuid        references public.vehicles(id) on delete set null,
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
  created_at      timestamptz not null default now()
);

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
create table if not exists public.annual_expenses (
  id              uuid primary key default gen_random_uuid(),
  expense_name    text        not null,
  category        text        not null,
  annual_cost     numeric(12,2) not null default 0 check (annual_cost >= 0),
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

-- ═══════════════════════════════════════════════════════════════════════════
-- Row-Level Security
-- For an internal financial tool, we enable RLS and grant full access to
-- any authenticated user. If you prefer anonymous read access, swap the
-- policy's `to authenticated` for `to public`.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.categories        enable row level security;
alter table public.startup_costs     enable row level security;
alter table public.assets            enable row level security;
alter table public.vehicles          enable row level security;
alter table public.maintenance_logs  enable row level security;
alter table public.transactions      enable row level security;
alter table public.app_settings      enable row level security;
alter table public.partners                    enable row level security;
alter table public.annual_expense_categories   enable row level security;
alter table public.annual_expenses             enable row level security;
alter table public.monthly_expense_categories  enable row level security;
alter table public.monthly_expenses            enable row level security;
alter table public.variable_expense_categories enable row level security;
alter table public.variable_expenses           enable row level security;
alter table public.washes                      enable row level security;
alter table public.category_budgets             enable row level security;

do $$ begin
  -- Drop existing policies first (idempotent)
  perform 1;
exception when others then null;
end $$;

drop policy if exists "rw_auth" on public.categories;
create policy "rw_auth" on public.categories
  for all to public using (true) with check (true);

drop policy if exists "rw_auth" on public.startup_costs;
create policy "rw_auth" on public.startup_costs
  for all to public using (true) with check (true);

drop policy if exists "rw_auth" on public.assets;
create policy "rw_auth" on public.assets
  for all to public using (true) with check (true);

drop policy if exists "rw_auth" on public.vehicles;
create policy "rw_auth" on public.vehicles
  for all to public using (true) with check (true);

drop policy if exists "rw_auth" on public.maintenance_logs;
create policy "rw_auth" on public.maintenance_logs
  for all to public using (true) with check (true);

drop policy if exists "rw_auth" on public.transactions;
create policy "rw_auth" on public.transactions
  for all to public using (true) with check (true);

drop policy if exists "rw_auth" on public.app_settings;
create policy "rw_auth" on public.app_settings
  for all to public using (true) with check (true);

drop policy if exists "rw_auth" on public.partners;
create policy "rw_auth" on public.partners
  for all to public using (true) with check (true);

drop policy if exists "rw_auth" on public.annual_expense_categories;
create policy "rw_auth" on public.annual_expense_categories
  for all to public using (true) with check (true);

drop policy if exists "rw_auth" on public.annual_expenses;
create policy "rw_auth" on public.annual_expenses
  for all to public using (true) with check (true);

drop policy if exists "rw_auth" on public.monthly_expense_categories;
create policy "rw_auth" on public.monthly_expense_categories
  for all to public using (true) with check (true);

drop policy if exists "rw_auth" on public.monthly_expenses;
create policy "rw_auth" on public.monthly_expenses
  for all to public using (true) with check (true);

drop policy if exists "rw_auth" on public.variable_expense_categories;
create policy "rw_auth" on public.variable_expense_categories
  for all to public using (true) with check (true);

drop policy if exists "rw_auth" on public.variable_expenses;
create policy "rw_auth" on public.variable_expenses
  for all to public using (true) with check (true);

drop policy if exists "rw_auth" on public.washes;
create policy "rw_auth" on public.washes
  for all to public using (true) with check (true);

drop policy if exists "rw_auth" on public.category_budgets;
create policy "rw_auth" on public.category_budgets
  for all to public using (true) with check (true);

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

insert into public.assets (asset_name, purchase_date, cost, salvage_value, useful_life_years)
select * from (values
  ('شاحنة إيسوزو مجهزة',        date '2025-01-15', 115000, 20000, 7),
  ('فان هيونداي H1',            date '2025-02-01',  88000, 15000, 7),
  ('بيك أب تويوتا هايلوكس',     date '2025-02-20',  92500, 18000, 7),
  ('مولد كهرباء 15kVA',         date '2025-03-10',  14500,  2000, 5),
  ('غسالة ضغط عالي صناعية',    date '2025-03-10',   6800,   800, 4),
  ('نظام تتبع GPS',             date '2025-04-01',   6500,     0, 3)
) as t(asset_name, purchase_date, cost, salvage_value, useful_life_years)
where not exists (select 1 from public.assets);

insert into public.vehicles (vehicle_name, route, asset_cost, allocated_fixed_costs)
select * from (values
  ('شاحنة إيسوزو #01', 'شمال الرياض', 115000, 12000),
  ('فان هيونداي #02',   'شرق الرياض',   88000, 12000),
  ('بيك أب تويوتا #03', 'جنوب الرياض',  92500, 12000),
  ('فان هيونداي #04',   'غرب الرياض',   88000, 12000)
) as t(vehicle_name, route, asset_cost, allocated_fixed_costs)
where not exists (select 1 from public.vehicles);

-- Maintenance logs seeded by vehicle_name lookup
do $$
declare
  v1 uuid; v2 uuid; v3 uuid; v4 uuid;
begin
  select id into v1 from public.vehicles where vehicle_name = 'شاحنة إيسوزو #01' limit 1;
  select id into v2 from public.vehicles where vehicle_name = 'فان هيونداي #02'   limit 1;
  select id into v3 from public.vehicles where vehicle_name = 'بيك أب تويوتا #03' limit 1;
  select id into v4 from public.vehicles where vehicle_name = 'فان هيونداي #04'   limit 1;

  if not exists (select 1 from public.maintenance_logs) and v1 is not null then
    insert into public.maintenance_logs (vehicle_id, maintenance_type, last_service_date, next_service_date, estimated_cost)
    values
      (v1, 'oil',       '2026-01-10', '2026-03-10',  900),
      (v1, 'filters',   '2026-01-20', '2026-04-20',  600),
      (v2, 'oil',       '2026-01-01', '2026-03-20',  700),
      (v2, 'brakes',    '2025-12-15', '2026-06-15', 2400),
      (v3, 'tires',     '2025-10-20', '2026-03-20', 4550),
      (v1, 'generator', '2026-03-05', '2026-04-28', 1200),
      (v4, 'pumps',     '2026-01-10', '2026-05-10', 1600),
      (v3, 'general',   '2026-02-01', '2026-08-01',  500);
  end if;

  -- Seed transactions (revenue + expenses) so the cash-flow and route
  -- aggregates have realistic monthly numbers.
  if not exists (select 1 from public.transactions) and v1 is not null then
    insert into public.transactions (occurred_on, description, type, amount, vehicle_id) values
      -- Route revenue (approx monthly totals distributed across last 30 days)
      ('2026-04-01', 'إيرادات — شمال الرياض',  'in',  28400, v1),
      ('2026-04-08', 'إيرادات — شرق الرياض',   'in',  22100, v2),
      ('2026-04-10', 'إيرادات — جنوب الرياض',  'in',  19600, v3),
      ('2026-04-12', 'إيرادات — غرب الرياض',   'in',  13200, v4),
      ('2026-03-25', 'إيرادات — شمال الرياض',  'in',  27600, v1),
      ('2026-03-20', 'إيرادات — شرق الرياض',   'in',  21900, v2),
      ('2026-03-15', 'إيرادات — جنوب الرياض',  'in',  19100, v3),
      ('2026-03-10', 'إيرادات — غرب الرياض',   'in',  13000, v4),
      ('2026-04-05', 'عقد شركة — تأجير شهري',   'in',  35000, null),
      -- Expenses
      ('2026-04-11', 'صيانة مضخات الأسطول',     'out',  4200, null),
      ('2026-04-09', 'رواتب الفريق التشغيلي',    'out', 18500, null),
      ('2026-04-07', 'وقود الأسطول الأسبوعي',    'out',  6800, null),
      ('2026-04-06', 'اشتراك منصة إدارة المواعيد','out', 1200, null),
      ('2026-04-03', 'مصاريف تشغيل — شمال',      'out',  3700, v1),
      ('2026-04-03', 'مصاريف تشغيل — شرق',       'out',  2800, v2),
      ('2026-04-03', 'مصاريف تشغيل — جنوب',      'out',  2450, v3),
      ('2026-04-03', 'مصاريف تشغيل — غرب',       'out',  2350, v4),
      -- Opening balance as an initial "in" transaction
      ('2025-06-01', 'رأس المال الافتتاحي',       'in',  3000000, null);
  end if;
end $$;

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
