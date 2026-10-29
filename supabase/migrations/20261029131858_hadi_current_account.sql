-- ═══════════════════════════════════════════════════════════════════════════
-- 20261029131858_hadi_current_account — مولَّد من src/lib/data/schema/registry.js بـ
--   node scripts/migration/generate-schema-sql.mjs
-- لا تعدّله بيدك: عدّل السجل وأعد التوليد (اختبار يفشل إن اختلفا).
-- جدول أُضيف بعد التشغيل: الجدول ثم صلاحياته، كما في الملفين الأساسيين.
-- ═══════════════════════════════════════════════════════════════════════════

-- bank_statement_lines
create table public."bank_statement_lines" (
  id text collate "C" not null,
  "account" text collate "C",
  "tx_date" text collate "C",
  "direction" text collate "C",
  "amount" numeric(14,2),
  "balance" numeric(14,2),
  "description" text collate "C",
  "reference" text collate "C",
  "file_name" text collate "C",
  "file_hash" text collate "C",
  "row_hash" text collate "C",
  "decision" text collate "C",
  "link_kind" text collate "C",
  "link_id" text collate "C",
  "partner_id" text collate "C",
  "status" text collate "C",
  "result" jsonb,
  "applied_by" text collate "C",
  "applied_by_name" text collate "C",
  "applied_at" timestamptz,
  "applied_at_iso" text collate "C",
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "bank_statement_lines_pk" primary key (id),
  constraint "bank_statement_lines_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "bank_statement_lines_shape_object" check (shape is null or jsonb_typeof(shape) = 'object'),
  constraint "bank_statement_lines_tx_date_day" check (app.is_day("tx_date"))
);
create index "bank_statement_lines_account_idx" on public."bank_statement_lines" ("account", id);
create index "bank_statement_lines_tx_date_idx" on public."bank_statement_lines" ("tx_date", id);
create index "bank_statement_lines_direction_idx" on public."bank_statement_lines" ("direction", id);
create index "bank_statement_lines_row_hash_idx" on public."bank_statement_lines" ("row_hash", id);
create index "bank_statement_lines_decision_idx" on public."bank_statement_lines" ("decision", id);
create index "bank_statement_lines_link_id_idx" on public."bank_statement_lines" ("link_id", id);
create index "bank_statement_lines_status_idx" on public."bank_statement_lines" ("status", id);

create or replace function app."doc_bank_statement_lines"(r public."bank_statement_lines") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('account', to_jsonb(r."account"), 'txDate', to_jsonb(r."tx_date"), 'direction', to_jsonb(r."direction"), 'amount', to_jsonb(r."amount"), 'balance', to_jsonb(r."balance"), 'description', to_jsonb(r."description"), 'reference', to_jsonb(r."reference"), 'fileName', to_jsonb(r."file_name"), 'fileHash', to_jsonb(r."file_hash"), 'rowHash', to_jsonb(r."row_hash"), 'decision', to_jsonb(r."decision"), 'linkKind', to_jsonb(r."link_kind"), 'linkId', to_jsonb(r."link_id"), 'partnerId', to_jsonb(r."partner_id"), 'status', to_jsonb(r."status"), 'result', to_jsonb(r."result"), 'appliedBy', to_jsonb(r."applied_by"), 'appliedByName', to_jsonb(r."applied_by_name"), 'appliedAt', to_jsonb(r."applied_at"), 'appliedAtIso', to_jsonb(r."applied_at_iso"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
grant execute on function app."doc_bank_statement_lines"(public."bank_statement_lines") to ledger_server, authenticated;
alter table public."bank_statement_lines" enable row level security;
revoke all on public."bank_statement_lines" from anon, authenticated;
-- bank_statement_lines: read admin, write none
create policy "bank_statement_lines_read" on public."bank_statement_lines" for select to authenticated using ((select app.is_admin()));
grant select on public."bank_statement_lines" to authenticated;
create policy "bank_statement_lines_server" on public."bank_statement_lines" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."bank_statement_lines" to ledger_server;

-- founding_review
create table public."founding_review" (
  id text collate "C" not null,
  "cutoff_date" text collate "C",
  "threshold" numeric(14,2),
  "actuals" jsonb,
  "revision" integer,
  "updated_by" text collate "C",
  "updated_by_name" text collate "C",
  "updated_at_iso" text collate "C",
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "founding_review_pk" primary key (id),
  constraint "founding_review_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "founding_review_shape_object" check (shape is null or jsonb_typeof(shape) = 'object'),
  constraint "founding_review_cutoff_date_day" check (app.is_day("cutoff_date"))
);

create or replace function app."doc_founding_review"(r public."founding_review") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('cutoffDate', to_jsonb(r."cutoff_date"), 'threshold', to_jsonb(r."threshold"), 'actuals', to_jsonb(r."actuals"), 'revision', to_jsonb(r."revision"), 'updatedBy', to_jsonb(r."updated_by"), 'updatedByName', to_jsonb(r."updated_by_name"), 'updatedAtIso', to_jsonb(r."updated_at_iso"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
grant execute on function app."doc_founding_review"(public."founding_review") to ledger_server, authenticated;
alter table public."founding_review" enable row level security;
revoke all on public."founding_review" from anon, authenticated;
-- founding_review: read admin, write none
create policy "founding_review_read" on public."founding_review" for select to authenticated using ((select app.is_admin()));
grant select on public."founding_review" to authenticated;
create policy "founding_review_server" on public."founding_review" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."founding_review" to ledger_server;

-- founding_decisions
create table public."founding_decisions" (
  id text collate "C" not null,
  "source_key" text collate "C",
  "decision" text collate "C",
  "partner_id" text collate "C",
  "note" text collate "C",
  "vat_reviewed" boolean,
  "revision" integer,
  "decided_by" text collate "C",
  "decided_by_name" text collate "C",
  "decided_at_iso" text collate "C",
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "founding_decisions_pk" primary key (id),
  constraint "founding_decisions_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "founding_decisions_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);
create index "founding_decisions_source_key_idx" on public."founding_decisions" ("source_key", id);
create index "founding_decisions_decision_idx" on public."founding_decisions" ("decision", id);

create or replace function app."doc_founding_decisions"(r public."founding_decisions") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('sourceKey', to_jsonb(r."source_key"), 'decision', to_jsonb(r."decision"), 'partnerId', to_jsonb(r."partner_id"), 'note', to_jsonb(r."note"), 'vatReviewed', to_jsonb(r."vat_reviewed"), 'revision', to_jsonb(r."revision"), 'decidedBy', to_jsonb(r."decided_by"), 'decidedByName', to_jsonb(r."decided_by_name"), 'decidedAtIso', to_jsonb(r."decided_at_iso"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
grant execute on function app."doc_founding_decisions"(public."founding_decisions") to ledger_server, authenticated;
alter table public."founding_decisions" enable row level security;
revoke all on public."founding_decisions" from anon, authenticated;
-- founding_decisions: read admin, write none
create policy "founding_decisions_read" on public."founding_decisions" for select to authenticated using ((select app.is_admin()));
grant select on public."founding_decisions" to authenticated;
create policy "founding_decisions_server" on public."founding_decisions" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."founding_decisions" to ledger_server;

