-- AI-nivå per användare (nov 2026)
-- none   = Ingen AI (knapparna döljs, servern säger nej)
-- haiku  = Bas: all AI går till Haiku (billigast), ingen "Pappa, fundera lite till"
-- sonnet = Full: Haiku för enkla saker och Sonnet där det behövs (som förut)
-- Tomt värde = standard: Läsa → Ingen AI, övriga → Full. Superanvändare har alltid Full.
-- Kör hela filen i Supabase SQL Editor. Den går att köra flera gånger.

alter table public.recipe_users add column if not exists ai_level text;
alter table public.recipe_users drop constraint if exists recipe_users_ai_level_check;
alter table public.recipe_users add constraint recipe_users_ai_level_check check (ai_level is null or ai_level in ('none','haiku','sonnet'));

-- Min egen nivå (används av appen och av /api/ai)
create or replace function public.recipe_my_ai()
returns text language sql stable security definer set search_path = public as $$
  select case
    when u.role is null then null
    when u.role = 'admin' then 'sonnet'
    else coalesce(u.ai_level, case when u.role = 'viewer' then 'none' else 'sonnet' end)
  end
  from recipe_users u where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

-- Superanvändaren: se och ändra allas nivå
create or replace function public.recipe_admin_list_ai()
returns table (email text, ai_level text)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.recipe_my_role() is distinct from 'admin' then raise exception 'Endast superanvändare'; end if;
  return query select u.email,
    case when u.role = 'admin' then 'sonnet' else coalesce(u.ai_level, case when u.role = 'viewer' then 'none' else 'sonnet' end) end
  from recipe_users u;
end $$;

create or replace function public.recipe_admin_set_ai(p_email text, p_level text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.recipe_my_role() is distinct from 'admin' then raise exception 'Endast superanvändare'; end if;
  if p_level not in ('none','haiku','sonnet') then raise exception 'Ogiltig AI-nivå'; end if;
  update recipe_users set ai_level = p_level where lower(email) = lower(trim(p_email));
end $$;

revoke all on function public.recipe_my_ai() from public, anon;
revoke all on function public.recipe_admin_list_ai() from public, anon;
revoke all on function public.recipe_admin_set_ai(text, text) from public, anon;
grant execute on function public.recipe_my_ai() to authenticated;
grant execute on function public.recipe_admin_list_ai() to authenticated;
grant execute on function public.recipe_admin_set_ai(text, text) to authenticated;

select email, name, role, ai_level from public.recipe_users order by created_at;
