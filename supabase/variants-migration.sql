-- Receptboken: gör om "Min version" till riktiga varianter.
-- Recept där ingredienser, steg eller portioner skiljer sig från originalet delas i två:
--   * grundreceptet återställs till originalet (behåller bild, betyg, favoriter, tillagningar och historik)
--   * en ny variant skapas med dina ändringar (döps automatiskt när du öppnar receptet)
-- En säkerhetskopia av hela tabellen sparas först i recipes_backup_20261110.
-- Körs en gång: Supabase -> SQL Editor -> New query -> klistra in -> Run.

create table if not exists public.recipes_backup_20261110 as table public.recipes;
alter table public.recipes_backup_20261110 enable row level security;  -- inte läsbar utifrån

with mod as (
  select id, data
  from public.recipes
  where data ? 'original'
    and jsonb_typeof(data -> 'original') = 'object'
    and coalesce(data ->> 'variantOf', '') = ''
    and (
      coalesce(data -> 'ingredients', '[]'::jsonb) is distinct from coalesce(data -> 'original' -> 'ingredients', '[]'::jsonb)
      or coalesce(data -> 'steps', '[]'::jsonb) is distinct from coalesce(data -> 'original' -> 'steps', '[]'::jsonb)
    )
    and jsonb_array_length(coalesce(data -> 'original' -> 'ingredients', '[]'::jsonb)) + jsonb_array_length(coalesce(data -> 'original' -> 'steps', '[]'::jsonb)) > 0
),
ins as (
  insert into public.recipes (id, data)
  select
    m.id || '-v1',
    (m.data - 'history' - 'cookLog' - 'favBy' - 'favorite' - 'rating' - 'timesCooked' - 'lastCooked' - 'original' - 'createdAt' - 'variantName' - 'variantNameAuto')
      || jsonb_build_object(
        'variantOf', m.id,
        'addedBy', coalesce(m.data ->> 'addedBy', 'nicklas.sivander@gmail.com'),
        'createdAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'updatedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'original', jsonb_build_object(
          'servings', m.data -> 'original' -> 'servings',
          'ingredients', coalesce(m.data -> 'original' -> 'ingredients', '[]'::jsonb),
          'steps', coalesce(m.data -> 'original' -> 'steps', '[]'::jsonb)))
  from mod m
  where not exists (select 1 from public.recipes x where x.id = m.id || '-v1')
  returning id
)
update public.recipes r
set data = (r.data - 'original' - 'myChanges')
  || jsonb_build_object(
    'ingredients', coalesce(r.data -> 'original' -> 'ingredients', '[]'::jsonb),
    'steps', coalesce(r.data -> 'original' -> 'steps', '[]'::jsonb),
    'servings', coalesce(nullif(r.data -> 'original' -> 'servings', 'null'::jsonb), r.data -> 'servings')),
  updated_at = now()
from mod m
where r.id = m.id;

-- Kvarvarande "original" på grundrecept behövs inte längre (inga ändringar, eller ett tomt original)
update public.recipes
set data = data - 'original', updated_at = now()
where data ? 'original'
  and coalesce(data ->> 'variantOf', '') = '';

-- Grundrecept med bara en text under "Mina ändringar": flytta texten till anteckningarna
update public.recipes
set data = (data - 'myChanges') || jsonb_build_object('notes', trim(both e'\n' from coalesce(data ->> 'notes', '') || e'\n\n' || (data ->> 'myChanges'))),
    updated_at = now()
where coalesce(data ->> 'variantOf', '') = ''
  and coalesce(data ->> 'myChanges', '') <> '';

-- Visa resultatet
select id, data ->> 'title' as titel, data ->> 'variantOf' as variant_av
from public.recipes
where data ->> 'variantOf' is not null
order by id;
