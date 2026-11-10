-- Receptboken: aktivitetslogg för superanvändare
-- Körs en gång: Supabase -> SQL Editor -> New query -> klistra in -> Run.
-- Appen skriver händelser (öppnade appen, visade recept, lagade, sparade …).
-- Bara superanvändare kan läsa loggen. Händelser äldre än ett år rensas bort.

create table if not exists public.recipe_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  email text not null,
  kind text not null,
  recipe_id text,
  title text,
  detail jsonb,
  device text
);
create index if not exists recipe_log_at on public.recipe_log (at desc);
alter table public.recipe_log enable row level security;
-- (inga policies: loggen nås bara via funktionerna nedan)

create or replace function public.recipe_log_event(p_kind text, p_recipe text default null, p_title text default null, p_detail jsonb default null, p_device text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.recipe_role_at_least('viewer') then return; end if;
  insert into recipe_log (email, kind, recipe_id, title, detail, device)
  values (lower(coalesce(auth.jwt() ->> 'email', '')), left(p_kind, 40), left(p_recipe, 80), left(p_title, 200), p_detail, left(p_device, 40));
  if random() < 0.01 then delete from recipe_log where at < now() - interval '365 days'; end if;
end $$;
revoke all on function public.recipe_log_event(text, text, text, jsonb, text) from public, anon;
grant execute on function public.recipe_log_event(text, text, text, jsonb, text) to authenticated;

create or replace function public.recipe_admin_activity(p_days int default 30)
returns json language plpgsql stable security definer set search_path = public, auth as $$
begin
  if public.recipe_my_role() <> 'admin' then raise exception 'Bara för superanvändare'; end if;
  return json_build_object(
    'events', coalesce((select json_agg(e order by e.at desc) from (
        select at, email, kind, recipe_id, title, detail, device from recipe_log
        where at > now() - make_interval(days => greatest(1, least(p_days, 365)))
        order by at desc limit 2000) e), '[]'::json),
    'users', coalesce((select json_agg(u) from (
        select ru.email, ru.name, ru.role, ru.created_at,
               au.last_sign_in_at,
               (select max(at) from recipe_log l where l.email = lower(ru.email)) as last_seen,
               (select count(*) from recipe_log l where l.email = lower(ru.email) and l.at > now() - interval '30 days') as events_30d
        from recipe_users ru left join auth.users au on lower(au.email) = lower(ru.email)
        order by 6 desc nulls last) u), '[]'::json)
  );
end $$;
revoke all on function public.recipe_admin_activity(int) from public, anon;
grant execute on function public.recipe_admin_activity(int) to authenticated;
