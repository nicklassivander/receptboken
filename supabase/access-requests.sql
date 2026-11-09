-- Receptboken: nya användare kan begära tillgång från inloggningssidan.
-- Körs en gång: Supabase -> SQL Editor -> New query -> klistra in -> Run.

create table if not exists public.recipe_access_requests (
  id bigint generated always as identity primary key,
  email text not null,
  name text,
  message text,
  created_at timestamptz not null default now()
);
create unique index if not exists recipe_access_requests_email on public.recipe_access_requests (lower(email));
alter table public.recipe_access_requests enable row level security;
-- Inga policies: tabellen nås bara via funktionerna nedan.

-- Vem som helst (även utloggad) kan skicka en förfrågan
create or replace function public.recipe_request_access(p_email text, p_name text, p_message text)
returns text language plpgsql security definer set search_path = public as $$
declare e text := lower(trim(p_email));
begin
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(e) > 200 then raise exception 'Ogiltig e-postadress'; end if;
  if exists (select 1 from recipe_users where email = e) then return 'har_tillgang'; end if;
  if (select count(*) from recipe_access_requests where created_at > now() - interval '1 hour') >= 20 then
    raise exception 'För många förfrågningar just nu, försök senare';
  end if;
  insert into recipe_access_requests (email, name, message)
  values (e, left(nullif(trim(p_name), ''), 80), left(nullif(trim(p_message), ''), 500))
  on conflict ((lower(email))) do update set name = excluded.name, message = excluded.message, created_at = now();
  return 'skickad';
end $$;

create or replace function public.recipe_admin_list_requests()
returns table (id bigint, email text, name text, message text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.recipe_my_role() is distinct from 'admin' then raise exception 'Endast superanvändare'; end if;
  return query select r.id, r.email, r.name, r.message, r.created_at from recipe_access_requests r order by r.created_at;
end $$;

-- Godkänn (med roll) eller avvisa (p_role = null)
create or replace function public.recipe_admin_resolve_request(p_id bigint, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare r recipe_access_requests;
begin
  if public.recipe_my_role() is distinct from 'admin' then raise exception 'Endast superanvändare'; end if;
  select * into r from recipe_access_requests where id = p_id;
  if r.id is null then return; end if;
  if p_role is not null then
    if p_role not in ('viewer','contributor','admin') then raise exception 'Ogiltig roll'; end if;
    insert into recipe_users (email, name, role) values (lower(r.email), r.name, p_role)
    on conflict (email) do update set role = excluded.role, name = coalesce(recipe_users.name, excluded.name);
  end if;
  delete from recipe_access_requests where id = p_id;
end $$;

revoke all on function public.recipe_request_access(text, text, text) from public;
grant execute on function public.recipe_request_access(text, text, text) to anon, authenticated;
revoke all on function public.recipe_admin_list_requests() from public, anon;
revoke all on function public.recipe_admin_resolve_request(bigint, text) from public, anon;
grant execute on function public.recipe_admin_list_requests() to authenticated;
grant execute on function public.recipe_admin_resolve_request(bigint, text) to authenticated;
