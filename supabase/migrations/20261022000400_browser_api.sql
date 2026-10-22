-- ═══════════════════════════════════════════════════════════════════════════
-- واجهة المتصفح: كتابة دفعة واحدة تحت RLS، والاستماع الحي لمركز الوكلاء
-- ═══════════════════════════════════════════════════════════════════════════
-- المتصفح يقرأ الجداول مباشرة عبر PostgREST (RLS يحكم). أما الكتابة فتمر من
-- دالة واحدة apply_writes بصلاحيات المستخدم نفسه (SECURITY INVOKER):
--   • الدفعة كلها في عملية واحدة — كلها أو لا شيء، مثل writeBatch.
--   • التعديل يغيّر حقوله فقط ولا يمسّ غيرها، مثل updateDoc.
--   • الرفض خطأ صريح: «لا صلاحية» أو «غير موجود»، لا تحديث صامت لصفر صفوف.
--   • serverTimestamp = لحظة واحدة للدفعة كلها، من القاعدة.
-- ═══════════════════════════════════════════════════════════════════════════

-- A Firestore Timestamp in the codec's tagged JSON form.
create or replace function app.ts_tag(ts timestamptz) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('$fs:ts', jsonb_build_object(
    's', floor(extract(epoch from ts))::bigint,
    'n', ((extract(epoch from ts) - floor(extract(epoch from ts))) * 1000000)::bigint * 1000))
$$;

-- shape := shape with fields added to / removed from its n (nulls), r (raw), t (form) parts.
create or replace function app.shape_patch(shape jsonb, p jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  s jsonb := coalesce(shape, '{}'::jsonb);
  n jsonb; r jsonb; t jsonb;
begin
  n := (select coalesce(jsonb_agg(x order by x), '[]'::jsonb) from (
          select jsonb_array_elements_text(coalesce(s -> 'n', '[]'::jsonb)) x
          union select jsonb_array_elements_text(coalesce(p -> 'n_add', '[]'::jsonb))
        ) a where x not in (select jsonb_array_elements_text(coalesce(p -> 'n_remove', '[]'::jsonb))));
  r := (coalesce(s -> 'r', '{}'::jsonb) - array(select jsonb_array_elements_text(coalesce(p -> 'r_remove', '[]'::jsonb)))) || coalesce(p -> 'r_set', '{}'::jsonb);
  t := (coalesce(s -> 't', '{}'::jsonb) - array(select jsonb_array_elements_text(coalesce(p -> 't_remove', '[]'::jsonb)))) || coalesce(p -> 't_set', '{}'::jsonb);
  s := s - 'n' - 'r' - 't';
  if jsonb_array_length(n) > 0 then s := s || jsonb_build_object('n', n); end if;
  if r <> '{}'::jsonb then s := s || jsonb_build_object('r', r); end if;
  if t <> '{}'::jsonb then s := s || jsonb_build_object('t', t); end if;
  return nullif(s, '{}'::jsonb);
end $$;

-- Whether a row exists, without RLS — only to tell «not found» from «denied»
-- for a member; anyone else is always told «denied».
create or replace function app.row_exists(p_table text, p_id text, p_parent text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare found boolean;
begin
  if not app.is_member() then return true; end if;
  if p_parent is null then
    execute format('select exists (select 1 from public.%I where id = $1)', p_table) into found using p_id;
  else
    execute format('select exists (select 1 from public.%I where id = $1 and parent_ref = $2)', p_table) into found using p_id, p_parent;
  end if;
  return found;
end $$;

create or replace function public.apply_writes(ops jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  op jsonb; t text; kind text; rc integer; cols text[]; key_cols text; key_where text;
  now_ts timestamptz := clock_timestamp(); row_data jsonb; patch jsonb; extra_set jsonb; col_sets text;
  f text;
begin
  if jsonb_typeof(ops) <> 'array' then raise exception 'ops must be an array' using errcode = '22023'; end if;
  for op in select * from jsonb_array_elements(ops) loop
    t := op ->> 'table';
    if t is null or to_regclass(format('public.%I', t)) is null or t = 'firebase_uid_map' then
      raise exception 'permission-denied: %', t using errcode = '42501';
    end if;
    kind := op ->> 'op';
    key_cols := case when op ->> 'parent' is not null then 'parent_ref, id' else 'id' end;
    key_where := format('id = %L', op ->> 'id') || case when op ->> 'parent' is not null then format(' and parent_ref = %L', op ->> 'parent') else '' end;

    if kind = 'set' then
      row_data := op -> 'row';
      -- A merge is read, combined and written by the browser; `if_match` is
      -- the row it read (null: there was none). Changed since → 40001, and the
      -- browser reads and merges again — atomic, as Firestore's merge is.
      if op ? 'if_match' then
        if jsonb_typeof(op -> 'if_match') = 'null' then
          if app.row_exists(t, op ->> 'id', op ->> 'parent') and app.is_member() then
            raise exception 'aborted: %/% was created concurrently', t, op ->> 'id' using errcode = '40001';
          end if;
        else
          execute format('select to_jsonb(x) from public.%I x where %s for update', t, key_where) into patch;
          if patch is null and app.row_exists(t, op ->> 'id', op ->> 'parent') then
            raise exception 'permission-denied: %/%', t, op ->> 'id' using errcode = '42501';
          end if;
          if patch is distinct from op -> 'if_match' then
            raise exception 'aborted: %/% changed concurrently', t, op ->> 'id' using errcode = '40001';
          end if;
        end if;
      end if;
      -- Server timestamps: typed columns take the commit instant, extra keys its tag.
      for f in select jsonb_array_elements_text(coalesce(op -> 'ts_columns', '[]'::jsonb)) loop
        row_data := jsonb_set(row_data, array[f], to_jsonb(now_ts));
      end loop;
      for f in select jsonb_array_elements_text(coalesce(op -> 'ts_extra', '[]'::jsonb)) loop
        row_data := jsonb_set(row_data, array['extra', f], app.ts_tag(now_ts));
      end loop;
      cols := array(select jsonb_object_keys(row_data));
      execute format('insert into public.%I as t (%s) select %s from jsonb_populate_record(null::public.%I, $1) on conflict (%s) do update set %s',
        t,
        (select string_agg(format('%I', c), ', ') from unnest(cols) c),
        (select string_agg(format('%I', c), ', ') from unnest(cols) c),
        t, key_cols,
        (select string_agg(format('%I = excluded.%I', c, c), ', ') from unnest(cols) c where c not in ('id', 'parent_ref')))
        using row_data;
      get diagnostics rc = row_count;
      if rc = 0 then raise exception 'permission-denied: %/%', t, op ->> 'id' using errcode = '42501'; end if;

    elsif kind = 'update' then
      patch := coalesce(op -> 'columns', '{}'::jsonb);
      for f in select jsonb_array_elements_text(coalesce(op -> 'ts_columns', '[]'::jsonb)) loop
        patch := patch || jsonb_build_object(f, to_jsonb(now_ts));
      end loop;
      extra_set := coalesce(op -> 'extra_set', '{}'::jsonb);
      for f in select jsonb_array_elements_text(coalesce(op -> 'ts_extra', '[]'::jsonb)) loop
        extra_set := extra_set || jsonb_build_object(f, app.ts_tag(now_ts));
      end loop;
      col_sets := (select string_agg(format('%I = r.%I', c, c), ', ') from jsonb_object_keys(patch) c);
      execute format('update public.%I as x set %s extra = (x.extra - $3::text[]) || $2, shape = app.shape_patch(x.shape, $4) from (select * from jsonb_populate_record(null::public.%I, $1)) r where x.%s',
        t, coalesce(col_sets || ',', ''), t, replace(key_where, 'parent_ref', 'x.parent_ref'))
        using patch, extra_set, array(select jsonb_array_elements_text(coalesce(op -> 'extra_unset', '[]'::jsonb))), coalesce(op -> 'shape', '{}'::jsonb);
      get diagnostics rc = row_count;
      if rc = 0 then
        if app.row_exists(t, op ->> 'id', op ->> 'parent') then
          raise exception 'permission-denied: %/%', t, op ->> 'id' using errcode = '42501';
        end if;
        raise exception 'not-found: %/%', t, op ->> 'id' using errcode = 'P0002';
      end if;

    elsif kind = 'delete' then
      execute format('delete from public.%I where %s', t, key_where);
      get diagnostics rc = row_count;
      -- Deleting what is not there is not an error (deleteDoc); deleting what one may not is.
      if rc = 0 and app.row_exists(t, op ->> 'id', op ->> 'parent') then
        raise exception 'permission-denied: %/%', t, op ->> 'id' using errcode = '42501';
      end if;

    else
      raise exception 'unknown op %', kind using errcode = '22023';
    end if;
  end loop;
  return jsonb_build_object('commitTime', now_ts);
end $$;
revoke all on function public.apply_writes(jsonb) from public, anon;
grant execute on function public.apply_writes(jsonb) to authenticated;

-- ── الاستماع الحي: مركز قيادة الوكلاء وحده (المستمع الوحيد في الموقع) ──
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['agent_command_agents', 'agent_command_reports', 'agent_command_alerts', 'agent_command_approvals',
                              'agent_command_activity', 'agent_command_tasks', 'agent_command_sources'] loop
      execute format('alter publication supabase_realtime add table public.%I', t);
    end loop;
  end if;
end $$;
