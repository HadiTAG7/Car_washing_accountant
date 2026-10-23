-- ═══════════════════════════════════════════════════════════════════════════
-- 20261023180318_vat_return_tracking — مولَّد من src/lib/data/schema/registry.js بـ
--   node scripts/migration/generate-schema-sql.mjs
-- لا تعدّله بيدك: عدّل السجل وأعد التوليد (اختبار يفشل إن اختلفا).
-- جدول أُضيف بعد التشغيل: الجدول ثم صلاحياته، كما في الملفين الأساسيين.
-- ═══════════════════════════════════════════════════════════════════════════

-- vat_declarations
create table public."vat_declarations" (
  id text collate "C" not null,
  "period_key" text collate "C",
  "status" text collate "C",
  "submitted_date" text collate "C",
  "evidence_url" text collate "C",
  "refund_received_date" text collate "C",
  "updated_at" timestamptz,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "vat_declarations_pk" primary key (id),
  constraint "vat_declarations_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "vat_declarations_shape_object" check (shape is null or jsonb_typeof(shape) = 'object'),
  constraint "vat_declarations_submitted_date_day" check (app.is_day("submitted_date")),
  constraint "vat_declarations_refund_received_date_day" check (app.is_day("refund_received_date")),
  constraint "vat_declarations_period" check (period_key is not null and id = period_key and period_key ~ '^\d{4}-(Q[1-4]|0[1-9]|1[0-2])$'),
  constraint "vat_declarations_status" check (status is not null and status in ('not_submitted', 'submitted', 'refund_received')),
  constraint "vat_declarations_proof" check (status = 'not_submitted' or (submitted_date is not null and evidence_url is not null and evidence_url ~ '^https?://')),
  constraint "vat_declarations_refund" check (status <> 'refund_received' or refund_received_date is not null)
);
create index "vat_declarations_period_key_idx" on public."vat_declarations" ("period_key", id);

create or replace function app."doc_vat_declarations"(r public."vat_declarations") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('periodKey', to_jsonb(r."period_key"), 'status', to_jsonb(r."status"), 'submittedDate', to_jsonb(r."submitted_date"), 'evidenceUrl', to_jsonb(r."evidence_url"), 'refundReceivedDate', to_jsonb(r."refund_received_date"), 'updatedAt', to_jsonb(r."updated_at"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
grant execute on function app."doc_vat_declarations"(public."vat_declarations") to ledger_server, authenticated;
alter table public."vat_declarations" enable row level security;
revoke all on public."vat_declarations" from anon, authenticated;
-- vat_declarations: read staff, write none
create policy "vat_declarations_read" on public."vat_declarations" for select to authenticated using ((select app.is_staff()));
grant select on public."vat_declarations" to authenticated;
create policy "vat_declarations_server" on public."vat_declarations" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."vat_declarations" to ledger_server;

