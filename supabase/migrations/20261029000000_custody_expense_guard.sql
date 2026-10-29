-- The trusted ledger server records the shared advance consumption in `extra`.
-- Browser users may still flip an unreconciled recovery status, but may not
-- create or alter the server-owned consumption counter.
create or replace function app.trg_temporary_custody_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user <> 'authenticated' then return new; end if;
  if tg_op = 'INSERT' then
    if app.doc_temporary_expenses(new) ?| array['custody_expense_used_halala', 'custody_balance_opened_journal_id', 'custody_historical_partial_hold'] then
      raise exception 'استهلاك العهدة يكتبه دفتر الأستاذ فقط' using errcode = '42501';
    end if;
  elsif (app.doc_temporary_expenses(old) -> 'custody_expense_used_halala')
      is distinct from (app.doc_temporary_expenses(new) -> 'custody_expense_used_halala')
      or (app.doc_temporary_expenses(old) -> 'custody_balance_opened_journal_id')
      is distinct from (app.doc_temporary_expenses(new) -> 'custody_balance_opened_journal_id')
      or (app.doc_temporary_expenses(old) -> 'custody_historical_partial_hold')
      is distinct from (app.doc_temporary_expenses(new) -> 'custody_historical_partial_hold') then
    raise exception 'استهلاك العهدة يكتبه دفتر الأستاذ فقط' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger temporary_expenses_custody_guard before insert or update
on public.temporary_expenses for each row execute function app.trg_temporary_custody_guard();
