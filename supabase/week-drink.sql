-- Veckans drink (nov 2026): Matilda (Haiku med webbsökning) väljer en drink ur baren varje måndag kl. 06.
-- Hon tittar på drinktrender på nätet och på vad familjen gjort senaste veckan (blandat, gillat, frågat henne).
-- Samma drink väljs inte två veckor i rad (de senaste fyra veckornas val hoppas över om det går).
-- Kräver timers.sql (cron_secret, push_url) och ai_cache.sql. Kör hela filen i Supabase SQL Editor.

-- Underlag till servern: drinkarna med veckans aktivitet + tidigare val
create or replace function public.recipe_week_drink_input(p_secret text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  if p_secret is null or p_secret is distinct from (select value from recipe_settings where key = 'cron_secret') then
    raise exception 'Nekad';
  end if;
  select jsonb_build_object(
    'drinks', coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id,
      'title', r.data->>'title',
      'ingredients', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select x from jsonb_array_elements_text(coalesce(r.data->'ingredients', '[]'::jsonb)) x where x not like '#%' limit 6) s),
      'likes', coalesce(jsonb_array_length(case when jsonb_typeof(r.data->'favBy') = 'array' then r.data->'favBy' end), 0),
      'timesMixed', coalesce((r.data->>'timesCooked')::int, 0),
      'mixedWeek', (select count(*) from recipe_log l where l.recipe_id = r.id and l.kind = 'cook_done' and l.at > now() - interval '7 days'),
      'likedWeek', (select count(*) from recipe_log l where l.recipe_id = r.id and l.kind = 'fav' and l.at > now() - interval '7 days'),
      'matildaWeek', (select count(*) from jsonb_array_elements_text(case when jsonb_typeof(r.data->'matHits') = 'array' then r.data->'matHits' else '[]'::jsonb end) t where t::timestamptz > now() - interval '7 days')
    )), '[]'::jsonb),
    'history', coalesce((select data from recipe_ai_cache where key = 'weekdrink:history'), '[]'::jsonb)
  ) into res
  from recipes r where r.data->'tags' ? 'dryck';
  return res;
end $$;

-- Spara veckans val (och historiken, högst 12 veckor)
create or replace function public.recipe_week_drink_save(p_secret text, p_pick jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare hist jsonb;
begin
  if p_secret is null or p_secret is distinct from (select value from recipe_settings where key = 'cron_secret') then
    raise exception 'Nekad';
  end if;
  insert into recipe_ai_cache (key, data, created_at) values ('weekdrink:current', p_pick, now())
  on conflict (key) do update set data = excluded.data, created_at = now();
  select coalesce(data, '[]'::jsonb) into hist from recipe_ai_cache where key = 'weekdrink:history';
  hist := coalesce(hist, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('id', p_pick->>'id', 'at', now()));
  while jsonb_array_length(hist) > 12 loop hist := hist - 0; end loop;
  insert into recipe_ai_cache (key, data, created_at) values ('weekdrink:history', hist, now())
  on conflict (key) do update set data = excluded.data, created_at = now();
end $$;

revoke all on function public.recipe_week_drink_input(text) from public;
revoke all on function public.recipe_week_drink_save(text, jsonb) from public;
grant execute on function public.recipe_week_drink_input(text) to anon, authenticated;
grant execute on function public.recipe_week_drink_save(text, jsonb) to anon, authenticated;

-- Varje måndag kl. 05 UTC (06 vintertid, 07 sommartid i Sverige)
select cron.unschedule('recept-veckans-drink') where exists (select 1 from cron.job where jobname = 'recept-veckans-drink');
select cron.schedule('recept-veckans-drink', '0 5 * * 1', $job$
  select net.http_post(
    url := replace((select value from public.recipe_settings where key = 'push_url'), 'push-due', 'week-drink'),
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', (select value from public.recipe_settings where key = 'cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
$job$);

-- Välj den första veckans drink direkt
select net.http_post(
  url := replace((select value from public.recipe_settings where key = 'push_url'), 'push-due', 'week-drink'),
  headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', (select value from public.recipe_settings where key = 'cron_secret')),
  body := '{}'::jsonb,
  timeout_milliseconds := 60000);
