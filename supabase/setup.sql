-- Receptboken – databas, behörigheter och bildlagring
-- Körs en gång i samma Supabase-projekt som Munkholmsvägen:
-- SQL Editor -> New query -> klistra in hela filen -> Run.
-- Inloggningen delas med huset, men receptappen har en egen lista över vilka som får använda den.

-- 1. Vilka som får använda Receptboken, och med vilken behörighet
-- viewer = Läsa, contributor = Lägga till och ändra, editor = Full behörighet, admin = Superanvändare
create table if not exists public.recipe_users (
  email text primary key,
  name text,
  role text not null default 'contributor' check (role in ('viewer','contributor','editor','admin')),
  created_at timestamptz not null default now()
);
alter table public.recipe_users enable row level security;
-- (inga policies: listan nås bara via funktionerna nedan)

insert into public.recipe_users (email, name, role) values
  ('nicklas.sivander@gmail.com', 'Nicklas', 'admin'),
  ('annsofiesivander@gmail.com', 'Ann-Sofie', 'editor')
on conflict (email) do nothing;

create or replace function public.recipe_my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from recipe_users where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

create or replace function public.recipe_role_at_least(r text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(array_position(array['viewer','contributor','editor','admin'], public.recipe_my_role()), 0)
      >= array_position(array['viewer','contributor','editor','admin'], r);
$$;

revoke all on function public.recipe_my_role() from public, anon;
revoke all on function public.recipe_role_at_least(text) from public, anon;
grant execute on function public.recipe_my_role() to authenticated;
grant execute on function public.recipe_role_at_least(text) to authenticated;

-- 2. Recepten
create table if not exists public.recipes (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.recipes enable row level security;

drop policy if exists recipes_read on public.recipes;
drop policy if exists recipes_insert on public.recipes;
drop policy if exists recipes_update on public.recipes;
drop policy if exists recipes_delete on public.recipes;
create policy recipes_read   on public.recipes for select to authenticated using (public.recipe_role_at_least('viewer'));
create policy recipes_insert on public.recipes for insert to authenticated with check (public.recipe_role_at_least('contributor'));
create policy recipes_update on public.recipes for update to authenticated using (public.recipe_role_at_least('contributor')) with check (public.recipe_role_at_least('contributor'));
create policy recipes_delete on public.recipes for delete to authenticated using (public.recipe_role_at_least('editor'));

-- Ändrar bara de fält som skickas med, så att två personer kan jobba samtidigt
create or replace function public.patch_recipe(p_id text, p_patch jsonb)
returns void language sql security invoker set search_path = public as $$
  update recipes set data = data || p_patch, updated_at = now() where id = p_id;
$$;
revoke all on function public.patch_recipe(text, jsonb) from public, anon;
grant execute on function public.patch_recipe(text, jsonb) to authenticated;

-- Realtid: ändringar syns direkt på andra enheter
do $$ begin
  begin alter publication supabase_realtime add table public.recipes; exception when duplicate_object then null; end;
end $$;

-- 3. Bilder på rätterna
insert into storage.buckets (id, name, public)
values ('recipe-photos', 'recipe-photos', true)
on conflict (id) do nothing;

drop policy if exists recipe_photos_insert on storage.objects;
drop policy if exists recipe_photos_update on storage.objects;
drop policy if exists recipe_photos_delete on storage.objects;
create policy recipe_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'recipe-photos' and public.recipe_role_at_least('contributor'));
create policy recipe_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'recipe-photos' and public.recipe_role_at_least('contributor'));
create policy recipe_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'recipe-photos' and public.recipe_role_at_least('editor'));

-- 4. Användarhantering, bara för superanvändare
create or replace function public.recipe_admin_list_users()
returns table (email text, name text, role text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.recipe_my_role() is distinct from 'admin' then raise exception 'Endast superanvändare'; end if;
  return query select u.email, u.name, u.role, u.created_at from recipe_users u order by u.created_at, u.email;
end $$;

create or replace function public.recipe_admin_upsert_user(p_email text, p_name text, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare e text := lower(trim(p_email));
begin
  if public.recipe_my_role() is distinct from 'admin' then raise exception 'Endast superanvändare'; end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Ogiltig e-postadress'; end if;
  if p_role not in ('viewer','contributor','editor','admin') then raise exception 'Ogiltig roll'; end if;
  if e = lower(auth.jwt() ->> 'email') and p_role <> 'admin' then raise exception 'Du kan inte ta bort din egen superbehörighet'; end if;
  insert into recipe_users (email, name, role) values (e, nullif(trim(p_name),''), p_role)
  on conflict (email) do update set name = excluded.name, role = excluded.role;
end $$;

create or replace function public.recipe_admin_delete_user(p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare e text := lower(trim(p_email));
begin
  if public.recipe_my_role() is distinct from 'admin' then raise exception 'Endast superanvändare'; end if;
  if e = lower(auth.jwt() ->> 'email') then raise exception 'Du kan inte ta bort dig själv'; end if;
  delete from recipe_users where lower(email) = e;
end $$;

revoke all on function public.recipe_admin_list_users() from public, anon;
revoke all on function public.recipe_admin_upsert_user(text, text, text) from public, anon;
revoke all on function public.recipe_admin_delete_user(text) from public, anon;
grant execute on function public.recipe_admin_list_users() to authenticated;
grant execute on function public.recipe_admin_upsert_user(text, text, text) to authenticated;
grant execute on function public.recipe_admin_delete_user(text) to authenticated;

select email, name, role from public.recipe_users order by created_at;
