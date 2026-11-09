-- Receptboken: pushnotiser till superanvändare när någon begär tillgång.
-- Körs en gång (efter access-requests.sql): Supabase -> SQL Editor -> New query -> klistra in -> Run.

create table if not exists public.recipe_push_subs (
  endpoint text primary key,
  email text not null,
  sub jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.recipe_push_subs enable row level security;
-- Inga policies: nås bara via funktionerna nedan.

-- Superanvändare sparar/tar bort sin egen enhet
create or replace function public.recipe_push_save(p_sub jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.recipe_my_role() is distinct from 'admin' then raise exception 'Endast superanvändare'; end if;
  if coalesce(p_sub ->> 'endpoint', '') !~ '^https://' then raise exception 'Ogiltig prenumeration'; end if;
  insert into recipe_push_subs (endpoint, email, sub) values (p_sub ->> 'endpoint', lower(auth.jwt() ->> 'email'), p_sub)
  on conflict (endpoint) do update set email = excluded.email, sub = excluded.sub, created_at = now();
end $$;

create or replace function public.recipe_push_delete(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from recipe_push_subs where endpoint = p_endpoint;
$$;

-- Servern hämtar mottagare, men bara precis efter att en förfrågan kommit in
create or replace function public.recipe_push_targets()
returns setof jsonb language sql stable security definer set search_path = public as $$
  select s.sub from recipe_push_subs s
  join recipe_users u on u.email = s.email and u.role = 'admin'
  where exists (select 1 from recipe_access_requests r where r.created_at > now() - interval '2 minutes');
$$;

revoke all on function public.recipe_push_save(jsonb) from public, anon;
grant execute on function public.recipe_push_save(jsonb) to authenticated;
revoke all on function public.recipe_push_delete(text) from public;
grant execute on function public.recipe_push_delete(text) to anon, authenticated;
revoke all on function public.recipe_push_targets() from public;
grant execute on function public.recipe_push_targets() to anon, authenticated;
