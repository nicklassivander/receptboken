-- Aviseringar: "Någon börjar laga" (nov 2026). Kräver notify.sql och shopping.sql.
-- Kör hela filen i Supabase SQL Editor.
--   cooking -> alla andra användare som slagit på "Någon börjar laga" (av som standard)
--   Högst en avisering per recept och person inom 2 timmar.

create or replace function public.recipe_notify(p_kind text, p_recipe text, p_extra text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if p_kind not in ('added', 'cooked', 'liked', 'variant', 'cooking') then return; end if;
  if not public.recipe_role_at_least('viewer') then return; end if;
  -- samma händelse från samma person skickas inte igen inom 30 minuter (börjar laga: 2 timmar)
  if exists (select 1 from recipe_notify_queue where actor = v_me and kind = p_kind and recipe_id = p_recipe
             and at > now() - case when p_kind = 'cooking' then interval '2 hours' else interval '30 minutes' end) then return; end if;
  insert into recipe_notify_queue (actor, kind, recipe_id, extra) values (v_me, p_kind, left(p_recipe, 80), left(p_extra, 40));
  delete from recipe_notify_queue where at < now() - interval '30 days';
end $$;

-- Utskicket: samma som i shopping.sql + cooking
create or replace function public.recipe_notify_due(p_secret text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare items jsonb;
begin
  if p_secret is null or p_secret is distinct from (select value from recipe_settings where key = 'cron_secret') then
    raise exception 'Nekad';
  end if;
  with q as (
    select * from recipe_notify_queue where sent_at is null order by at limit 50 for update skip locked
  ), marked as (
    update recipe_notify_queue n set sent_at = now() from q where n.id = q.id returning n.id
  ), ev as (
    select q.*, r.data as rd, b.data as bd,
           coalesce(nullif(u.name, ''), initcap(split_part(q.actor, '@', 1))) as actor_name,
           lower(coalesce(r.data ->> 'addedBy', (select email from recipe_users where role = 'admin' order by created_at limit 1))) as owner,
           lower(coalesce(b.data ->> 'addedBy', (select email from recipe_users where role = 'admin' order by created_at limit 1))) as base_owner
    from q
    left join recipes r on r.id = q.recipe_id
    left join recipes b on b.id = r.data ->> 'variantOf'
    left join recipe_users u on lower(u.email) = q.actor
  ), rcpt as (
    select ev.*, lower(ru.email) as rcpt from ev join recipe_users ru on true
    where (ev.kind in ('test', 'list') and lower(ru.email) = ev.to_email)
       or (ev.kind in ('added', 'cooked', 'cooking') and lower(ru.email) <> ev.actor)
       or (ev.kind = 'liked' and lower(ru.email) = ev.owner and ev.owner <> ev.actor)
       or (ev.kind = 'variant' and lower(ru.email) = ev.base_owner and ev.base_owner <> ev.actor)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'tag', 'ev-' || rc.id || '-' || rc.rcpt,
      'sub', s.sub,
      'url', case when rc.kind = 'list' then '/#lista' when rc.recipe_id is null then '/' else '/#r=' || rc.recipe_id end,
      'title', case rc.kind
          when 'added' then 'Nytt recept: ' || coalesce(rc.rd ->> 'title', 'recept')
          when 'cooked' then rc.actor_name || ' lagade ' || coalesce(rc.rd ->> 'title', 'ett recept')
          when 'cooking' then rc.actor_name || ' har börjat laga ' || coalesce(rc.rd ->> 'title', 'ett recept')
          when 'liked' then rc.actor_name || ' gillar ditt recept'
          when 'variant' then rc.actor_name || ' gjorde en variant av ditt recept'
          when 'list' then rc.actor_name || ' delade en inköpslista med dig'
          else 'Aviseringar fungerar' end,
      'body', case rc.kind
          when 'added' then rc.actor_name || ' lade till ett recept i receptboken'
          when 'cooked' then coalesce(nullif(rc.extra, '') || ' ', '') || 'Tryck för att se receptet'
          when 'cooking' then coalesce('Klar ca ' || nullif(rc.extra, '') || ' · ', '') || 'Tryck för att se receptet'
          when 'liked' then coalesce(rc.rd ->> 'title', '') || ' blev favorit'
          when 'variant' then coalesce(rc.bd ->> 'title', rc.rd ->> 'title', '')
          when 'list' then coalesce(rc.extra, 'Inköpslista') || ' – tryck för att öppna'
          else 'Så här ser det ut när något händer i köket.' end)), '[]'::jsonb)
  into items
  from rcpt rc
  join recipe_push_subs s on lower(s.email) = rc.rcpt
  left join recipe_notify_prefs p on p.email = rc.rcpt
  where rc.kind in ('test', 'list')
     -- "Någon börjar laga" är av tills man slår på den
     or (rc.kind = 'cooking' and p.prefs ->> 'cooking' = 'true')
     or (rc.kind <> 'cooking' and coalesce(p.prefs ->> rc.kind, 'true') <> 'false');
  return jsonb_build_object('items', items);
end $$;
grant execute on function public.recipe_notify_due(text) to anon, authenticated;
