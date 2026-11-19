-- Sparade AI-svar så att samma nätsökning eller samma recept från nätet inte kostar igen.
-- Kör i Supabase SQL Editor. Appen fungerar även utan tabellen (då sparas inget).

create table if not exists public.recipe_ai_cache (
  key        text primary key,          -- t.ex. "web:torsk kapris rödbetor" eller "page:https://..."
  data       jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.recipe_ai_cache enable row level security;

-- Alla inloggade med tillgång till appen får läsa; de som får använda AI får spara
drop policy if exists ai_cache_sel on public.recipe_ai_cache;
create policy ai_cache_sel on public.recipe_ai_cache for select
  using (public.recipe_role_at_least('viewer'));

drop policy if exists ai_cache_ins on public.recipe_ai_cache;
create policy ai_cache_ins on public.recipe_ai_cache for insert
  with check (public.recipe_role_at_least('contributor'));

drop policy if exists ai_cache_upd on public.recipe_ai_cache;
create policy ai_cache_upd on public.recipe_ai_cache for update
  using (public.recipe_role_at_least('contributor'))
  with check (public.recipe_role_at_least('contributor'));

-- Städa bort gamla svar (äldre än 60 dagar) en gång per natt
do $$ begin
  perform cron.unschedule('recept-ai-cache-clean');
exception when others then null; end $$;
select cron.schedule('recept-ai-cache-clean', '17 3 * * *',
  $$delete from public.recipe_ai_cache where created_at < now() - interval '60 days'$$);
