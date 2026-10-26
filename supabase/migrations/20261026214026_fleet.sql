-- ═══════════════════════════════════════════════════════════════════════════
-- 20261026214026_fleet — مولَّد من src/lib/data/schema/registry.js بـ
--   node scripts/migration/generate-schema-sql.mjs
-- لا تعدّله بيدك: عدّل السجل وأعد التوليد (اختبار يفشل إن اختلفا).
-- جدول أُضيف بعد التشغيل: الجدول ثم صلاحياته، كما في الملفين الأساسيين.
-- ═══════════════════════════════════════════════════════════════════════════

-- fleet_bikes
create table public."fleet_bikes" (
  id text collate "C" not null,
  "internal_number" text collate "C",
  "plate" text collate "C",
  "model" text collate "C",
  "purchased_on" text collate "C",
  "startup_item_id" text collate "C",
  "status" text collate "C",
  "status_since" text collate "C",
  "current_biker_id" text collate "C",
  "active_assignment_id" text collate "C",
  "policy_id" text collate "C",
  "revision" integer,
  "updated_by" text collate "C",
  "updated_by_name" text collate "C",
  "updated_at_iso" text collate "C",
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "fleet_bikes_pk" primary key (id),
  constraint "fleet_bikes_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "fleet_bikes_shape_object" check (shape is null or jsonb_typeof(shape) = 'object'),
  constraint "fleet_bikes_purchased_on_day" check (app.is_day("purchased_on")),
  constraint "fleet_bikes_status_since_day" check (app.is_day("status_since"))
);

create or replace function app."doc_fleet_bikes"(r public."fleet_bikes") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('internalNumber', to_jsonb(r."internal_number"), 'plate', to_jsonb(r."plate"), 'model', to_jsonb(r."model"), 'purchasedOn', to_jsonb(r."purchased_on"), 'startupItemId', to_jsonb(r."startup_item_id"), 'status', to_jsonb(r."status"), 'statusSince', to_jsonb(r."status_since"), 'currentBikerId', to_jsonb(r."current_biker_id"), 'activeAssignmentId', to_jsonb(r."active_assignment_id"), 'policyId', to_jsonb(r."policy_id"), 'revision', to_jsonb(r."revision"), 'updatedBy', to_jsonb(r."updated_by"), 'updatedByName', to_jsonb(r."updated_by_name"), 'updatedAtIso', to_jsonb(r."updated_at_iso"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
grant execute on function app."doc_fleet_bikes"(public."fleet_bikes") to ledger_server, authenticated;
alter table public."fleet_bikes" enable row level security;
revoke all on public."fleet_bikes" from anon, authenticated;
-- fleet_bikes: read accountant, write none
create policy "fleet_bikes_read" on public."fleet_bikes" for select to authenticated using ((select app.is_accountant()));
grant select on public."fleet_bikes" to authenticated;
create policy "fleet_bikes_server" on public."fleet_bikes" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."fleet_bikes" to ledger_server;

-- fleet_assignments
create table public."fleet_assignments" (
  id text collate "C" not null,
  "bike_id" text collate "C",
  "biker_id" text collate "C",
  "biker_name" text collate "C",
  "received_on" text collate "C",
  "returned_on" text collate "C",
  "note" text collate "C",
  "revision" integer,
  "updated_by" text collate "C",
  "updated_by_name" text collate "C",
  "updated_at_iso" text collate "C",
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "fleet_assignments_pk" primary key (id),
  constraint "fleet_assignments_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "fleet_assignments_shape_object" check (shape is null or jsonb_typeof(shape) = 'object'),
  constraint "fleet_assignments_received_on_day" check (app.is_day("received_on")),
  constraint "fleet_assignments_returned_on_day" check (app.is_day("returned_on"))
);
create index "fleet_assignments_bike_id_idx" on public."fleet_assignments" ("bike_id", id);
create index "fleet_assignments_biker_id_idx" on public."fleet_assignments" ("biker_id", id);
create index "fleet_assignments_received_on_idx" on public."fleet_assignments" ("received_on", id);

create or replace function app."doc_fleet_assignments"(r public."fleet_assignments") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('bikeId', to_jsonb(r."bike_id"), 'bikerId', to_jsonb(r."biker_id"), 'bikerName', to_jsonb(r."biker_name"), 'receivedOn', to_jsonb(r."received_on"), 'returnedOn', to_jsonb(r."returned_on"), 'note', to_jsonb(r."note"), 'revision', to_jsonb(r."revision"), 'updatedBy', to_jsonb(r."updated_by"), 'updatedByName', to_jsonb(r."updated_by_name"), 'updatedAtIso', to_jsonb(r."updated_at_iso"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
grant execute on function app."doc_fleet_assignments"(public."fleet_assignments") to ledger_server, authenticated;
alter table public."fleet_assignments" enable row level security;
revoke all on public."fleet_assignments" from anon, authenticated;
-- fleet_assignments: read accountant, write none
create policy "fleet_assignments_read" on public."fleet_assignments" for select to authenticated using ((select app.is_accountant()));
grant select on public."fleet_assignments" to authenticated;
create policy "fleet_assignments_server" on public."fleet_assignments" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."fleet_assignments" to ledger_server;

-- fleet_maintenance
create table public."fleet_maintenance" (
  id text collate "C" not null,
  "bike_id" text collate "C",
  "started_on" text collate "C",
  "ended_on" text collate "C",
  "description" text collate "C",
  "cost" numeric(14,2),
  "expense_url" text collate "C",
  "revision" integer,
  "updated_by" text collate "C",
  "updated_by_name" text collate "C",
  "updated_at_iso" text collate "C",
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "fleet_maintenance_pk" primary key (id),
  constraint "fleet_maintenance_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "fleet_maintenance_shape_object" check (shape is null or jsonb_typeof(shape) = 'object'),
  constraint "fleet_maintenance_started_on_day" check (app.is_day("started_on")),
  constraint "fleet_maintenance_ended_on_day" check (app.is_day("ended_on"))
);
create index "fleet_maintenance_bike_id_idx" on public."fleet_maintenance" ("bike_id", id);
create index "fleet_maintenance_started_on_idx" on public."fleet_maintenance" ("started_on", id);

create or replace function app."doc_fleet_maintenance"(r public."fleet_maintenance") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('bikeId', to_jsonb(r."bike_id"), 'startedOn', to_jsonb(r."started_on"), 'endedOn', to_jsonb(r."ended_on"), 'description', to_jsonb(r."description"), 'cost', to_jsonb(r."cost"), 'expenseUrl', to_jsonb(r."expense_url"), 'revision', to_jsonb(r."revision"), 'updatedBy', to_jsonb(r."updated_by"), 'updatedByName', to_jsonb(r."updated_by_name"), 'updatedAtIso', to_jsonb(r."updated_at_iso"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
grant execute on function app."doc_fleet_maintenance"(public."fleet_maintenance") to ledger_server, authenticated;
alter table public."fleet_maintenance" enable row level security;
revoke all on public."fleet_maintenance" from anon, authenticated;
-- fleet_maintenance: read accountant, write none
create policy "fleet_maintenance_read" on public."fleet_maintenance" for select to authenticated using ((select app.is_accountant()));
grant select on public."fleet_maintenance" to authenticated;
create policy "fleet_maintenance_server" on public."fleet_maintenance" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."fleet_maintenance" to ledger_server;

-- fleet_incidents
create table public."fleet_incidents" (
  id text collate "C" not null,
  "bike_id" text collate "C",
  "biker_id" text collate "C",
  "biker_name" text collate "C",
  "happened_on" text collate "C",
  "booking_id" text collate "C",
  "description" text collate "C",
  "cost" numeric(14,2),
  "claim_status" text collate "C",
  "claim_note" text collate "C",
  "revision" integer,
  "updated_by" text collate "C",
  "updated_by_name" text collate "C",
  "updated_at_iso" text collate "C",
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "fleet_incidents_pk" primary key (id),
  constraint "fleet_incidents_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "fleet_incidents_shape_object" check (shape is null or jsonb_typeof(shape) = 'object'),
  constraint "fleet_incidents_happened_on_day" check (app.is_day("happened_on"))
);
create index "fleet_incidents_bike_id_idx" on public."fleet_incidents" ("bike_id", id);
create index "fleet_incidents_happened_on_idx" on public."fleet_incidents" ("happened_on", id);

create or replace function app."doc_fleet_incidents"(r public."fleet_incidents") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('bikeId', to_jsonb(r."bike_id"), 'bikerId', to_jsonb(r."biker_id"), 'bikerName', to_jsonb(r."biker_name"), 'happenedOn', to_jsonb(r."happened_on"), 'bookingId', to_jsonb(r."booking_id"), 'description', to_jsonb(r."description"), 'cost', to_jsonb(r."cost"), 'claimStatus', to_jsonb(r."claim_status"), 'claimNote', to_jsonb(r."claim_note"), 'revision', to_jsonb(r."revision"), 'updatedBy', to_jsonb(r."updated_by"), 'updatedByName', to_jsonb(r."updated_by_name"), 'updatedAtIso', to_jsonb(r."updated_at_iso"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
grant execute on function app."doc_fleet_incidents"(public."fleet_incidents") to ledger_server, authenticated;
alter table public."fleet_incidents" enable row level security;
revoke all on public."fleet_incidents" from anon, authenticated;
-- fleet_incidents: read accountant, write none
create policy "fleet_incidents_read" on public."fleet_incidents" for select to authenticated using ((select app.is_accountant()));
grant select on public."fleet_incidents" to authenticated;
create policy "fleet_incidents_server" on public."fleet_incidents" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."fleet_incidents" to ledger_server;

-- fleet_policies
create table public."fleet_policies" (
  id text collate "C" not null,
  "number" text collate "C",
  "company" text collate "C",
  "starts_on" text collate "C",
  "expires_on" text collate "C",
  "whole_fleet" boolean,
  "revision" integer,
  "updated_by" text collate "C",
  "updated_by_name" text collate "C",
  "updated_at_iso" text collate "C",
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "fleet_policies_pk" primary key (id),
  constraint "fleet_policies_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "fleet_policies_shape_object" check (shape is null or jsonb_typeof(shape) = 'object'),
  constraint "fleet_policies_starts_on_day" check (app.is_day("starts_on")),
  constraint "fleet_policies_expires_on_day" check (app.is_day("expires_on"))
);
create index "fleet_policies_expires_on_idx" on public."fleet_policies" ("expires_on", id);

create or replace function app."doc_fleet_policies"(r public."fleet_policies") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('number', to_jsonb(r."number"), 'company', to_jsonb(r."company"), 'startsOn', to_jsonb(r."starts_on"), 'expiresOn', to_jsonb(r."expires_on"), 'wholeFleet', to_jsonb(r."whole_fleet"), 'revision', to_jsonb(r."revision"), 'updatedBy', to_jsonb(r."updated_by"), 'updatedByName', to_jsonb(r."updated_by_name"), 'updatedAtIso', to_jsonb(r."updated_at_iso"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
grant execute on function app."doc_fleet_policies"(public."fleet_policies") to ledger_server, authenticated;
alter table public."fleet_policies" enable row level security;
revoke all on public."fleet_policies" from anon, authenticated;
-- fleet_policies: read accountant, write none
create policy "fleet_policies_read" on public."fleet_policies" for select to authenticated using ((select app.is_accountant()));
grant select on public."fleet_policies" to authenticated;
create policy "fleet_policies_server" on public."fleet_policies" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."fleet_policies" to ledger_server;

-- fleet_control
create table public."fleet_control" (
  id text collate "C" not null,
  "revision" integer,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "fleet_control_pk" primary key (id),
  constraint "fleet_control_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "fleet_control_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);

create or replace function app."doc_fleet_control"(r public."fleet_control") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('revision', to_jsonb(r."revision"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
grant execute on function app."doc_fleet_control"(public."fleet_control") to ledger_server, authenticated;
alter table public."fleet_control" enable row level security;
revoke all on public."fleet_control" from anon, authenticated;
create policy "fleet_control_server" on public."fleet_control" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."fleet_control" to ledger_server;

