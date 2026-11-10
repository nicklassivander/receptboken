-- Receptboken: tydligare timers – notisen upprepas varje minut (max 3 gånger) tills du öppnar appen eller stänger av timern.
-- Körs en gång efter timers.sql: Supabase -> SQL Editor -> New query -> klistra in -> Run.

alter table public.recipe_timers add column if not exists repeats int not null default 0;

create or replace function public.recipe_push_due(p_secret text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare items jsonb;
begin
  if p_secret is null or p_secret is distinct from (select value from recipe_settings where key = 'cron_secret') then
    raise exception 'Nekad';
  end if;
  with due as (
    select * from recipe_timers where fire_at <= now() + interval '3 seconds' for update skip locked
  ), again as (
    update recipe_timers t set fire_at = now() + interval '60 seconds', repeats = t.repeats + 1
    from due where t.id = due.id and due.repeats < 2 returning t.id
  ), gone as (
    delete from recipe_timers t using due where t.id = due.id and due.repeats >= 2 returning t.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'timer', d.id || '-' || d.repeats, 'sub', s.sub,
      'title', case when d.repeats = 0 then d.title else '🔔 Påminnelse ' || (d.repeats + 1) || ' av 3 – ' || d.title end,
      'body', d.body, 'url', d.url)), '[]'::jsonb)
  into items
  from due d join recipe_push_subs s on s.email = d.email;
  return jsonb_build_object(
    'vapid_private', (select value from recipe_settings where key = 'vapid_private'),
    'vapid_public', (select value from recipe_settings where key = 'vapid_public'),
    'items', items);
end $$;
