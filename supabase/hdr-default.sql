-- Alla befintliga recept (inte drinkar eller inställningsrader) markeras "Till sidhuvudet".
-- Kör i Supabase SQL Editor. Ångra: byt 'true' mot 'false' i update-satsen (eller ta bort nyckeln).

-- 1. Kolla först hur många som ändras
select count(*) as andras
from public.recipes
where id not like '\_%'
  and coalesce(data->'tags', '[]'::jsonb) @> '["dryck"]'::jsonb is not true
  and coalesce((data->>'hdr')::boolean, false) = false;

-- 2. Ändra
update public.recipes
set data = jsonb_set(data, '{hdr}', 'true'::jsonb, true)
where id not like '\_%'
  and coalesce(data->'tags', '[]'::jsonb) @> '["dryck"]'::jsonb is not true
  and coalesce((data->>'hdr')::boolean, false) = false;
