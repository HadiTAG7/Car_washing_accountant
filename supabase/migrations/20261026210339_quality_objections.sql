-- ═══════════════════════════════════════════════════════════════════════════
-- 20261026210339_quality_objections — مولَّد من src/lib/data/schema/registry.js بـ
--   node scripts/migration/generate-schema-sql.mjs
-- لا تعدّله بيدك: عدّل السجل وأعد التوليد (اختبار يفشل إن اختلفا).
-- جدول أُضيف بعد التشغيل: الجدول ثم صلاحياته، كما في الملفين الأساسيين.
-- ═══════════════════════════════════════════════════════════════════════════

-- quality_objections
create table public."quality_objections" (
  id text collate "C" not null,
  "period_key" text collate "C",
  "metric_key" text collate "C",
  "source_id" text collate "C",
  "snapshot_id" text collate "C",
  "source_hash" text collate "C",
  "status" text collate "C",
  "note" text collate "C",
  "revision" integer,
  "updated_by" text collate "C",
  "updated_by_name" text collate "C",
  "updated_at_iso" text collate "C",
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "quality_objections_pk" primary key (id),
  constraint "quality_objections_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "quality_objections_shape_object" check (shape is null or jsonb_typeof(shape) = 'object'),
  constraint "quality_objections_period_key_month" check (app.is_month("period_key"))
);
create index "quality_objections_period_key_idx" on public."quality_objections" ("period_key", id);

create or replace function app."doc_quality_objections"(r public."quality_objections") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('periodKey', to_jsonb(r."period_key"), 'metricKey', to_jsonb(r."metric_key"), 'sourceId', to_jsonb(r."source_id"), 'snapshotId', to_jsonb(r."snapshot_id"), 'sourceHash', to_jsonb(r."source_hash"), 'status', to_jsonb(r."status"), 'note', to_jsonb(r."note"), 'revision', to_jsonb(r."revision"), 'updatedBy', to_jsonb(r."updated_by"), 'updatedByName', to_jsonb(r."updated_by_name"), 'updatedAtIso', to_jsonb(r."updated_at_iso"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
grant execute on function app."doc_quality_objections"(public."quality_objections") to ledger_server, authenticated;
alter table public."quality_objections" enable row level security;
revoke all on public."quality_objections" from anon, authenticated;
-- quality_objections: read admin, write none
create policy "quality_objections_read" on public."quality_objections" for select to authenticated using ((select app.is_admin()));
grant select on public."quality_objections" to authenticated;
create policy "quality_objections_server" on public."quality_objections" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."quality_objections" to ledger_server;

