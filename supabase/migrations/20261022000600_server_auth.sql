-- ═══════════════════════════════════════════════════════════════════════════
-- الجلسة الحيّة: ما يقابل verifyIdToken(token, true) في Firebase
-- ═══════════════════════════════════════════════════════════════════════════
-- توقيع التوكن يُفحص في الخادم (jose). هذا يكمّله: من سجّل خروجه أو حُظر أو
-- حُذف حسابه يُرفض فوراً لا عند انتهاء التوكن. للخادم وحده، لا للمتصفح.
create or replace function app.session_is_live(p_user uuid, p_session uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from auth.sessions s
    join auth.users u on u.id = s.user_id
    where s.id = p_session and s.user_id = p_user
      and (s.not_after is null or s.not_after > now())
      and u.deleted_at is null
      and (u.banned_until is null or u.banned_until <= now())
  )
$$;
revoke all on function app.session_is_live(uuid, uuid) from public;
grant execute on function app.session_is_live(uuid, uuid) to ledger_server;
