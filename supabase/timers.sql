-- Receptboken: timers som ringer som pushnotis även när appen är stängd.
-- Ersätt <<VAPID_PRIVATE_KEY>> innan körning (görs av Claude, nyckeln ska inte ligga i GitHub). Hemligheten för cron skapas i databasen.
-- Körs en gång: Supabase -> SQL Editor -> New query -> klistra in -> Run.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Hemliga inställningar (ingen åtkomst utifrån)
create table if not exists public.recipe_settings (key text primary key, value text not null);
alter table public.recipe_settings enable row level security;
insert into public.recipe_settings (key, value) values
  ('vapid_private', '<<VAPID_PRIVATE_KEY>>'),
  ('vapid_public', 'BC5bVnd2jko7hbqt27XQmVY6T48JDCGzPEQBM4sGhX7qhITGFnJv_SsGUYlQ6B_Mdy1ScNn9tokkUG_SnXPylGQ'),
  ('cron_secret', md5(random()::text || clock_timestamp()::text) || md5(random()::text)),
  ('push_url', 'https://recept.sivander.com/api/push-due')
on conflict (key) do update set value = excluded.value;

-- Enheter som tar emot notiser
create table if not exists public.recipe_push_subs (
  endpoint text primary key,
  email text not null,
  sub jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.recipe_push_subs enable row level security;

-- Pågående timers
create table if not exists public.recipe_timers (
  id text primary key,
  email text not null,
  fire_at timestamptz not null,
  title text,
  body text,
  url text,
  created_at timestamptz not null default now()
);
create index if not exists recipe_timers_fire on public.recipe_timers (fire_at);
alter table public.recipe_timers enable row level security;

create or replace function public.recipe_push_save(p_sub jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.recipe_my_role() is null then raise exception 'Ingen behörighet'; end if;
  if coalesce(p_sub ->> 'endpoint', '') !~ '^https://' then raise exception 'Ogiltig prenumeration'; end if;
  insert into recipe_push_subs (endpoint, email, sub) values (p_sub ->> 'endpoint', lower(auth.jwt() ->> 'email'), p_sub)
  on conflict (endpoint) do update set email = excluded.email, sub = excluded.sub, created_at = now();
end $$;

create or replace function public.recipe_timer_set(p_id text, p_fire_at timestamptz, p_title text, p_body text, p_url text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.recipe_my_role() is null then raise exception 'Ingen behörighet'; end if;
  if p_fire_at > now() + interval '2 days' then raise exception 'För lång timer'; end if;
  insert into recipe_timers (id, email, fire_at, title, body, url)
  values (left(p_id, 80), lower(auth.jwt() ->> 'email'), p_fire_at, left(p_title, 120), left(p_body, 300), left(p_url, 300))
  on conflict (id) do update set fire_at = excluded.fire_at, title = excluded.title, body = excluded.body, url = excluded.url;
end $$;

create or replace function public.recipe_timer_cancel(p_id text)
returns void language sql security definer set search_path = public as $$
  delete from recipe_timers where id = p_id and email = lower(auth.jwt() ->> 'email');
$$;

-- Anropas av servern (med hemligheten): timers som ska ringa nu, och nyckeln för att skicka
create or replace function public.recipe_push_due(p_secret text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare items jsonb;
begin
  if p_secret is null or p_secret is distinct from (select value from recipe_settings where key = 'cron_secret') then
    raise exception 'Nekad';
  end if;
  with due as (
    delete from recipe_timers where fire_at <= now() + interval '3 seconds' returning *
  )
  select coalesce(jsonb_agg(jsonb_build_object('timer', d.id, 'sub', s.sub, 'title', d.title, 'body', d.body, 'url', d.url)), '[]'::jsonb)
  into items
  from due d join recipe_push_subs s on s.email = d.email;
  return jsonb_build_object(
    'vapid_private', (select value from recipe_settings where key = 'vapid_private'),
    'vapid_public', (select value from recipe_settings where key = 'vapid_public'),
    'items', items);
end $$;

create or replace function public.recipe_push_gone(p_secret text, p_endpoint text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_secret is distinct from (select value from recipe_settings where key = 'cron_secret') then raise exception 'Nekad'; end if;
  delete from recipe_push_subs where endpoint = p_endpoint;
end $$;

revoke all on function public.recipe_push_save(jsonb) from public, anon;
revoke all on function public.recipe_timer_set(text, timestamptz, text, text, text) from public, anon;
revoke all on function public.recipe_timer_cancel(text) from public, anon;
grant execute on function public.recipe_push_save(jsonb) to authenticated;
grant execute on function public.recipe_timer_set(text, timestamptz, text, text, text) to authenticated;
grant execute on function public.recipe_timer_cancel(text) to authenticated;
revoke all on function public.recipe_push_due(text) from public;
revoke all on function public.recipe_push_gone(text, text) from public;
grant execute on function public.recipe_push_due(text) to anon, authenticated;
grant execute on function public.recipe_push_gone(text, text) to anon, authenticated;

-- Var 15:e sekund: finns det timers som ska ringa, be appens server skicka notiserna
select cron.unschedule('recept-timers') where exists (select 1 from cron.job where jobname = 'recept-timers');
select cron.schedule('recept-timers', '15 seconds', $job$
  select net.http_post(
    url := (select value from public.recipe_settings where key = 'push_url'),
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', (select value from public.recipe_settings where key = 'cron_secret')),
    body := '{}'::jsonb)
  where exists (select 1 from public.recipe_timers where fire_at <= now() + interval '3 seconds');
$job$);
