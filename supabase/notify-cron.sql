-- Aviseringar: låt utskicket gå även när det finns aviseringar i kön (inte bara när en timer ringer).
-- Kör en gång i Supabase -> SQL Editor -> Run.

-- Gamla aviseringar som blivit liggande markeras som skickade, så att familjen inte får en hög gamla på en gång.
update public.recipe_notify_queue set sent_at = now() where sent_at is null and at < now() - interval '10 minutes';

select cron.unschedule('recept-timers') where exists (select 1 from cron.job where jobname = 'recept-timers');
select cron.schedule('recept-timers', '15 seconds', $job$
  select net.http_post(
    url := (select value from public.recipe_settings where key = 'push_url'),
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', (select value from public.recipe_settings where key = 'cron_secret')),
    body := '{}'::jsonb)
  where exists (select 1 from public.recipe_timers where fire_at <= now() + interval '3 seconds')
     or exists (select 1 from public.recipe_notify_queue where sent_at is null);
$job$);
