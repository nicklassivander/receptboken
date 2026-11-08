-- Receptboken: bara den som lagt till ett recept (eller en superanvändare) får ändra och radera det.
-- Andra får fortfarande sätta favorit, betygsätta och logga tillagningar.
-- Körs en gång: Supabase -> SQL Editor -> New query -> klistra in -> Run.

create or replace function public.recipe_is_owner(d jsonb)
returns boolean language sql stable security definer set search_path = public as $$
  select public.recipe_my_role() = 'admin'
      or lower(coalesce(d ->> 'addedBy', 'nicklas.sivander@gmail.com')) = lower(coalesce(auth.jwt() ->> 'email', ''));
$$;
revoke all on function public.recipe_is_owner(jsonb) from public, anon;
grant execute on function public.recipe_is_owner(jsonb) to authenticated;

drop policy if exists recipes_update on public.recipes;
drop policy if exists recipes_delete on public.recipes;
create policy recipes_update on public.recipes for update to authenticated
  using (public.recipe_role_at_least('contributor') and public.recipe_is_owner(data))
  with check (public.recipe_role_at_least('contributor') and public.recipe_is_owner(data));
create policy recipes_delete on public.recipes for delete to authenticated
  using (public.recipe_role_at_least('contributor') and public.recipe_is_owner(data));

-- Delvisa ändringar: ägaren får ändra allt, andra bara sina personliga fält
create or replace function public.patch_recipe(p_id text, p_patch jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare d jsonb;
begin
  if not public.recipe_role_at_least('contributor') then raise exception 'Ingen behörighet'; end if;
  select data into d from recipes where id = p_id;
  if d is null then return; end if;
  if not public.recipe_is_owner(d) and exists (
    select 1 from jsonb_object_keys(p_patch) k
    where k not in ('favBy', 'cookLog', 'history', 'timesCooked', 'lastCooked', 'rating')
  ) then
    raise exception 'Bara den som lagt till receptet kan ändra det';
  end if;
  update recipes set data = data || p_patch, updated_at = now() where id = p_id;
end $$;
revoke all on function public.patch_recipe(text, jsonb) from public, anon;
grant execute on function public.patch_recipe(text, jsonb) to authenticated;
