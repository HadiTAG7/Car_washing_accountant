-- ═══════════════════════════════════════════════════════════════════════════
-- ثوابت الدفاتر في القاعدة نفسها — لا تعتمد على أن الكود تذكّرها
-- ═══════════════════════════════════════════════════════════════════════════
-- • القيد لا يُحفظ إلا متوازناً: مجموع المدين = مجموع الدائن، وسطران على الأقل.
--   الفحص مؤجَّل إلى نهاية العملية، فالقيد وسطوره يُكتبان بأي ترتيب داخلها.
-- • السطر طرف واحد، بلا سالب، ولا يُحذف ولا يتغيّر مبلغه أو حسابه بعد الحفظ.
-- • القيد لا يُحذف، ولا يتغيّر تاريخه أو رقمه أو مجموعه.
-- • المراجع بين القيود والأقفال والمسيرات والفواتير مفاتيح أجنبية.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Lines ──
alter table public.journal_entry_lines
  add constraint journal_entry_lines_debit_nonneg check (debit is null or debit >= 0),
  add constraint journal_entry_lines_credit_nonneg check (credit is null or credit >= 0),
  add constraint journal_entry_lines_one_side check (not (coalesce(debit, 0) > 0 and coalesce(credit, 0) > 0)),
  add constraint journal_entry_lines_account_fk foreign key (account_id) references public.chart_of_accounts(id) deferrable initially deferred;

-- ── The balance rule, checked once per entry at commit ──
create or replace function app.assert_entry_balanced(p_entry text) returns void
language plpgsql set search_path = '' as $$
declare
  e record; d numeric; c numeric; n integer;
begin
  select id, shape, extra, total_debit, total_credit into e from public.journal_entries where id = p_entry;
  if not found then return; end if;
  -- An entry whose lines were never an array (legacy) is checked at import.
  if coalesce((e.shape ->> 'nolines')::boolean, false) or e.extra ? 'lines' then return; end if;
  select coalesce(sum(coalesce(debit, 0)), 0), coalesce(sum(coalesce(credit, 0)), 0), count(*)
    into d, c, n from public.journal_entry_lines where entry_id = p_entry;
  if n < 2 then
    raise exception 'القيد % يحتاج سطرين على الأقل (عنده %)', p_entry, n using errcode = '23514';
  end if;
  if d <> c then
    raise exception 'القيد % غير متوازن: المدين % لا يساوي الدائن %', p_entry, d, c using errcode = '23514';
  end if;
  if (e.total_debit is not null and e.total_debit <> d) or (e.total_credit is not null and e.total_credit <> c) then
    raise exception 'مجموع القيد % المسجّل لا يطابق سطوره', p_entry using errcode = '23514';
  end if;
end $$;

create or replace function app.trg_lines_balanced() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform app.assert_entry_balanced(coalesce(new.entry_id, old.entry_id));
  return null;
end $$;
create or replace function app.trg_entry_balanced() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform app.assert_entry_balanced(new.id);
  return null;
end $$;
create constraint trigger journal_entry_lines_balanced
  after insert or update on public.journal_entry_lines
  deferrable initially deferred for each row execute function app.trg_lines_balanced();
create constraint trigger journal_entries_balanced
  after insert or update on public.journal_entries
  deferrable initially deferred for each row execute function app.trg_entry_balanced();

-- ── Immutability ──
create or replace function app.trg_lines_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'سطور القيد لا تُحذف؛ القيد يُعكس بقيد مقابل' using errcode = '42501';
  end if;
  if (new.entry_id, new.line_no, new.account_id, new.debit, new.credit)
     is distinct from (old.entry_id, old.line_no, old.account_id, old.debit, old.credit) then
    raise exception 'مبلغ السطر وحسابه لا يتغيّران بعد الترحيل' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger journal_entry_lines_immutable before update or delete on public.journal_entry_lines
  for each row execute function app.trg_lines_immutable();

create or replace function app.trg_entry_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'القيد لا يُحذف؛ يُعكس بقيد مقابل' using errcode = '42501';
  end if;
  if (new.entry_date, new.entry_number, new.total_debit, new.total_credit, new.source_type, new.source_id)
     is distinct from (old.entry_date, old.entry_number, old.total_debit, old.total_credit, old.source_type, old.source_id) then
    raise exception 'تاريخ القيد ورقمه ومجموعه ومصدره لا تتغيّر بعد الترحيل' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger journal_entries_immutable before update or delete on public.journal_entries
  for each row execute function app.trg_entry_immutable();

alter table public.journal_entries
  add constraint journal_entries_status check (status is null or status in ('posted', 'reversed', 'draft')),
  add constraint journal_entries_period_matches check (period_key is null or entry_date is null or period_key = substr(entry_date, 1, 7)),
  add constraint journal_entries_number_unique unique (entry_number),
  add constraint journal_entries_reversal_of_fk foreign key (reversal_of) references public.journal_entries(id) deferrable initially deferred,
  add constraint journal_entries_reverses_fk foreign key (reverses_entry_id) references public.journal_entries(id) deferrable initially deferred,
  add constraint journal_entries_reversed_by_fk foreign key (reversed_by) references public.journal_entries(id) deferrable initially deferred,
  add constraint journal_entries_settlement_fk foreign key (settlement_entry_id) references public.journal_entries(id) deferrable initially deferred,
  add constraint journal_entries_settlement_of_fk foreign key (settlement_of) references public.journal_entries(id) deferrable initially deferred;

alter table public.journal_lines_legacy
  add constraint journal_lines_legacy_debit_nonneg check (debit is null or debit >= 0),
  add constraint journal_lines_legacy_credit_nonneg check (credit is null or credit >= 0);

-- ── Locks and the records that point at entries ──
alter table public.posting_locks
  add constraint posting_locks_entry_fk foreign key (entry_id) references public.journal_entries(id) deferrable initially deferred,
  add constraint posting_locks_settlement_fk foreign key (settlement_entry_id) references public.journal_entries(id) deferrable initially deferred;
alter table public.payroll_runs
  add constraint payroll_runs_entry_fk foreign key (journal_entry_id) references public.journal_entries(id) deferrable initially deferred,
  add constraint payroll_runs_reversal_fk foreign key (reversal_entry_id) references public.journal_entries(id) deferrable initially deferred;
alter table public.payroll_payment_locks
  add constraint payroll_payment_locks_run_fk foreign key (run_id) references public.payroll_runs(id) deferrable initially deferred,
  add constraint payroll_payment_locks_entry_fk foreign key (journal_entry_id) references public.journal_entries(id) deferrable initially deferred;
alter table public.temporary_expenses
  add constraint temporary_expenses_payroll_run_fk foreign key (payroll_lock_id) references public.payroll_runs(id) deferrable initially deferred;
alter table public.sales_documents
  add constraint sales_documents_entry_fk foreign key (journal_entry_id) references public.journal_entries(id) deferrable initially deferred,
  add constraint sales_documents_linked_entry_fk foreign key (linked_journal_entry_id) references public.journal_entries(id) deferrable initially deferred,
  add constraint sales_documents_reference_fk foreign key (reference_document_id) references public.sales_documents(id) deferrable initially deferred;
alter table public.sales_document_sources
  add constraint sales_document_sources_document_fk foreign key (document_id) references public.sales_documents(id) deferrable initially deferred;
alter table public.sweater_settlements
  add constraint sweater_settlements_entry_fk foreign key (journal_entry_id) references public.journal_entries(id) deferrable initially deferred;
alter table public.sweater_adjustments
  add constraint sweater_adjustments_entry_fk foreign key (journal_entry_id) references public.journal_entries(id) deferrable initially deferred;
alter table public.startup_cost_entries
  add constraint startup_cost_entries_parent_fk foreign key (startup_cost_id) references public.startup_costs(id) deferrable initially deferred;
alter table public.fixed_assets
  add constraint fixed_assets_disposal_entry_fk foreign key (disposal_entry_id) references public.journal_entries(id) deferrable initially deferred;

-- Periods and counters
alter table public.accounting_periods
  add constraint accounting_periods_status check (status is null or status in ('open', 'closed')),
  add constraint accounting_periods_id_is_month check (app.is_month(id));

-- ── Accounts: the app's users are Supabase Auth users ──
-- users/{uid} and app_admins/{uid} keep the uid as their id; it must be a real
-- Auth user. Firebase uids map to Supabase ids here (historical «who did it»
-- fields keep the Firebase uid as written, so approval hashes do not change).
alter table public.members
  add column auth_user uuid generated always as (id::uuid) stored,
  add constraint members_auth_fk foreign key (auth_user) references auth.users(id) on delete restrict deferrable initially deferred,
  add constraint members_role check (role is null or role in ('admin', 'accountant', 'operator', 'partner', 'supervisor'));
alter table public.app_admins
  add column auth_user uuid generated always as (id::uuid) stored,
  add constraint app_admins_auth_fk foreign key (auth_user) references auth.users(id) on delete restrict deferrable initially deferred;

create table public.firebase_uid_map (
  firebase_uid text collate "C" primary key,
  user_id uuid not null unique references auth.users(id) on delete restrict,
  email text,
  migrated_at timestamptz not null default now()
);
comment on table public.firebase_uid_map is 'Firebase uid → Supabase user id. Historical actor fields keep the Firebase uid; the UI resolves names through this map.';
