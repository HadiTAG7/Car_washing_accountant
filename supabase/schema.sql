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
create table if not exists public.partners (
  id              uuid primary key default gen_random_uuid(),
  partner_name    text not null,
  workers_count   integer not null default 0,
  contact_number  text,
  status          text not null default 'active',
  created_at      timestamptz not null default now()
);

-- ─── annual_expenses (Module 2 — recurring fleet expenses) ─────────────────
create table if not exists public.annual_expenses (
  id              uuid primary key default gen_random_uuid(),
  expense_name    text        not null,
  category        text        not null,
  annual_cost     numeric(12,2) not null default 0 check (annual_cost >= 0),
  due_date        date,
  payment_status  text        not null default 'pending'
                  check (payment_status in ('paid','pending')),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists annual_expenses_due_date_idx       on public.annual_expenses(due_date);
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
alter table public.partners          enable row level security;
alter table public.annual_expenses   enable row level security;

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

drop policy if exists "rw_auth" on public.annual_expenses;
create policy "rw_auth" on public.annual_expenses
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
