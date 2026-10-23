-- ═══════════════════════════════════════════════════════════════════════════
-- 20261023000000_sweater_metric_snapshots — مولَّد من src/lib/data/schema/registry.js بـ
--   node scripts/migration/generate-schema-sql.mjs
-- لا تعدّله بيدك: عدّل السجل وأعد التوليد (اختبار يفشل إن اختلفا).
-- جدول أُضيف بعد التشغيل: الجدول ثم صلاحياته، كما في الملفين الأساسيين.
-- ═══════════════════════════════════════════════════════════════════════════

-- sweater_metric_snapshots
create table public."sweater_metric_snapshots" (
  id text collate "C" not null,
  "period_key" text collate "C",
  "extracted_at_iso" text collate "C",
  "source_url" text collate "C",
  "payload_hash" text collate "C",
  "key_id" text collate "C",
  "metrics" jsonb,
  "received_at" timestamptz,
  "received_at_iso" text collate "C",
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "sweater_metric_snapshots_pk" primary key (id),
  constraint "sweater_metric_snapshots_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "sweater_metric_snapshots_shape_object" check (shape is null or jsonb_typeof(shape) = 'object'),
  constraint "sweater_metric_snapshots_period_key_month" check (app.is_month("period_key"))
);
create index "sweater_metric_snapshots_period_key_idx" on public."sweater_metric_snapshots" ("period_key", id);

create or replace function app."doc_sweater_metric_snapshots"(r public."sweater_metric_snapshots") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('periodKey', to_jsonb(r."period_key"), 'extractedAtIso', to_jsonb(r."extracted_at_iso"), 'sourceUrl', to_jsonb(r."source_url"), 'payloadHash', to_jsonb(r."payload_hash"), 'keyId', to_jsonb(r."key_id"), 'metrics', to_jsonb(r."metrics"), 'receivedAt', to_jsonb(r."received_at"), 'receivedAtIso', to_jsonb(r."received_at_iso"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
grant execute on function app."doc_sweater_metric_snapshots"(public."sweater_metric_snapshots") to ledger_server, authenticated;
alter table public."sweater_metric_snapshots" enable row level security;
revoke all on public."sweater_metric_snapshots" from anon, authenticated;
-- sweater_metric_snapshots: read staff, write none
create policy "sweater_metric_snapshots_read" on public."sweater_metric_snapshots" for select to authenticated using ((select app.is_staff()));
grant select on public."sweater_metric_snapshots" to authenticated;
create policy "sweater_metric_snapshots_server" on public."sweater_metric_snapshots" for all to ledger_server using (true) with check (true);
grant select, insert, update on public."sweater_metric_snapshots" to ledger_server;

