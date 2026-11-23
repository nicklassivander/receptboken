-- Din profil (nov 2026): varje användare får ändra sitt eget namn, inget annat.
-- Roll och AI-nivå ändras bara av superanvändaren (recipe_admin_upsert_user / recipe_admin_set_ai).
-- Kör hela filen i Supabase SQL Editor. Den går att köra flera gånger.

-- 1. Ändra mitt eget namn (bara kolumnen name, bara min egen rad)
create or replace function public.recipe_set_my_name(p_name text)
returns text language plpgsql security definer set search_path = public as $$
declare n text := nullif(left(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'), 40), '');
begin
  if public.recipe_my_role() is null then raise exception 'Du har inte behörighet'; end if;
  update recipe_users set name = n where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''));
  return n;
end $$;

revoke all on function public.recipe_set_my_name(text) from public, anon;
grant execute on function public.recipe_set_my_name(text) to authenticated;

-- 2. Extra spärr i databasen: roll och AI-nivå kan bara ändras av en superanvändare
--    (eller här i SQL Editor, där ingen användare är inloggad).
--    recipe_users har inga RLS-policies, så ingen kan ändra tabellen direkt – det här skyddar
--    även om en framtida funktion skulle råka ändra fel kolumn.
create or replace function public.recipe_users_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role or new.ai_level is distinct from old.ai_level)
     and auth.jwt() is not null
     and public.recipe_my_role() is distinct from 'admin' then
    raise exception 'Bara superanvändaren kan ändra behörighet och AI-nivå';
  end if;
  return new;
end $$;

drop trigger if exists recipe_users_guard on public.recipe_users;
create trigger recipe_users_guard before update on public.recipe_users
  for each row execute function public.recipe_users_guard();

-- 3. Alla användare ser varandras namn (för "Anna lagade …"). Finns redan om shopping.sql är körd.
create or replace function public.recipe_list_people()
returns table (email text, name text) language sql stable security definer set search_path = public as $$
  select lower(ru.email), coalesce(nullif(ru.name, ''), '') from recipe_users ru
  where public.recipe_role_at_least('viewer') order by 2, 1;
$$;
revoke all on function public.recipe_list_people() from public, anon;
grant execute on function public.recipe_list_people() to authenticated;

select email, name, role, ai_level from public.recipe_users order by created_at;
