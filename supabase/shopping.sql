-- Receptboken: inköpslistor
-- Körs en gång efter notify.sql: Supabase -> SQL Editor -> New query -> klistra in -> Run.
-- Varje person har egna listor. Ägaren kan dela en lista med valda personer, som då kan se, bocka av och lägga till.

create table if not exists public.recipe_lists (
  id uuid primary key default gen_random_uuid(),
  owner text not null,
  name text not null default 'Inköpslista',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.recipe_list_members (
  list_id uuid not null references public.recipe_lists(id) on delete cascade,
  email text not null,
  primary key (list_id, email)
);
create table if not exists public.recipe_list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.recipe_lists(id) on delete cascade,
  text text not null,
  section text not null default 'Övrigt',
  recipe_id text,
  recipe_title text,
  added_by text not null,
  done boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists recipe_list_items_list on public.recipe_list_items (list_id);

alter table public.recipe_lists enable row level security;
alter table public.recipe_list_members enable row level security;
alter table public.recipe_list_items enable row level security;

create or replace function public.recipe_me() returns text language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

create or replace function public.recipe_list_can(p_list uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from recipe_lists l where l.id = p_list and lower(l.owner) = public.recipe_me())
      or exists (select 1 from recipe_list_members m where m.list_id = p_list and lower(m.email) = public.recipe_me());
$$;

drop policy if exists lists_sel on public.recipe_lists;
drop policy if exists lists_ins on public.recipe_lists;
drop policy if exists lists_upd on public.recipe_lists;
drop policy if exists lists_del on public.recipe_lists;
create policy lists_sel on public.recipe_lists for select using (lower(owner) = public.recipe_me() or public.recipe_list_can(id));
create policy lists_ins on public.recipe_lists for insert with check (lower(owner) = public.recipe_me() and public.recipe_role_at_least('viewer'));
create policy lists_upd on public.recipe_lists for update using (lower(owner) = public.recipe_me() or public.recipe_list_can(id)) with check (lower(owner) = public.recipe_me() or public.recipe_list_can(id));
create policy lists_del on public.recipe_lists for delete using (lower(owner) = public.recipe_me());

drop policy if exists members_sel on public.recipe_list_members;
drop policy if exists members_del on public.recipe_list_members;
create policy members_sel on public.recipe_list_members for select using (public.recipe_list_can(list_id));
-- ägaren tar bort vem som helst, en medlem kan lämna själv (läggs till via recipe_list_share)
create policy members_del on public.recipe_list_members for delete using (
  lower(email) = public.recipe_me() or exists (select 1 from recipe_lists l where l.id = list_id and lower(l.owner) = public.recipe_me()));

drop policy if exists items_all on public.recipe_list_items;
create policy items_all on public.recipe_list_items for all using (public.recipe_list_can(list_id)) with check (public.recipe_list_can(list_id));

-- Vilka man kan dela med: alla användare i receptappen (namn och e-post)
create or replace function public.recipe_list_people()
returns table (email text, name text) language sql stable security definer set search_path = public as $$
  select lower(ru.email), coalesce(nullif(ru.name, ''), '') from recipe_users ru
  where public.recipe_role_at_least('viewer') order by 2, 1;
$$;

-- Ägaren väljer exakt vilka listan delas med; nya personer får en avisering
create or replace function public.recipe_list_share(p_list uuid, p_emails text[])
returns void language plpgsql security definer set search_path = public as $$
declare v_me text := public.recipe_me(); v_name text; e text;
begin
  select name into v_name from recipe_lists where id = p_list and lower(owner) = v_me;
  if v_name is null then raise exception 'Bara ägaren kan dela listan'; end if;
  delete from recipe_list_members where list_id = p_list and not (lower(email) = any (select lower(x) from unnest(coalesce(p_emails, '{}')) x));
  foreach e in array coalesce(p_emails, '{}') loop
    if lower(e) <> v_me and exists (select 1 from recipe_users where lower(email) = lower(e))
       and not exists (select 1 from recipe_list_members where list_id = p_list and lower(email) = lower(e)) then
      insert into recipe_list_members (list_id, email) values (p_list, lower(e));
      begin
        insert into recipe_notify_queue (actor, kind, to_email, extra) values (v_me, 'list', lower(e), left(v_name, 40));
      exception when undefined_table then null;
      end;
    end if;
  end loop;
end $$;

grant select, insert, update, delete on public.recipe_lists, public.recipe_list_members, public.recipe_list_items to authenticated;
revoke all on function public.recipe_list_people() from public, anon;
revoke all on function public.recipe_list_share(uuid, text[]) from public, anon;
grant execute on function public.recipe_list_people() to authenticated;
grant execute on function public.recipe_list_share(uuid, text[]) to authenticated;
grant execute on function public.recipe_list_can(uuid) to authenticated;
grant execute on function public.recipe_me() to authenticated;

-- Ändringar syns direkt hos alla som delar listan
do $$ begin
  alter publication supabase_realtime add table public.recipe_list_items;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.recipe_lists;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.recipe_list_members;
exception when others then null; end $$;

-- Aviseringar: lägg till "delade en lista med dig" (ersätter funktionen från notify.sql)
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
       or (ev.kind in ('added', 'cooked') and lower(ru.email) <> ev.actor)
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
          when 'liked' then rc.actor_name || ' gillar ditt recept'
          when 'variant' then rc.actor_name || ' gjorde en variant av ditt recept'
          when 'list' then rc.actor_name || ' delade en inköpslista med dig'
          else 'Aviseringar fungerar' end,
      'body', case rc.kind
          when 'added' then rc.actor_name || ' lade till ett recept i receptboken'
          when 'cooked' then coalesce(nullif(rc.extra, '') || ' ', '') || 'Tryck för att se receptet'
          when 'liked' then coalesce(rc.rd ->> 'title', '') || ' blev favorit'
          when 'variant' then coalesce(rc.bd ->> 'title', rc.rd ->> 'title', '')
          when 'list' then coalesce(rc.extra, 'Inköpslista') || ' – tryck för att öppna'
          else 'Så här ser det ut när något händer i köket.' end)), '[]'::jsonb)
  into items
  from rcpt rc
  join recipe_push_subs s on lower(s.email) = rc.rcpt
  left join recipe_notify_prefs p on p.email = rc.rcpt
  where rc.kind in ('test', 'list') or coalesce(p.prefs ->> rc.kind, 'true') <> 'false';
  return jsonb_build_object('items', items);
end $$;
grant execute on function public.recipe_notify_due(text) to anon, authenticated;
