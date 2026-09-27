-- jobbot schema: jobs, links, tailored resumes, usage ledger, balances, top-ups.
-- Run once in the Supabase SQL editor (or `supabase db push`). Safe to re-run.
--
-- Access model
--   * The bot (GitHub Actions) uses the service_role key, which bypasses RLS.
--   * The dashboard and Chrome extension use the anon key + your login; RLS lets through only the
--     email stored in public.app_owner. After running this file:
--         insert into public.app_owner (email) values ('you@example.com');
--     and turn off "Allow new users to sign up" in Authentication settings.

create extension if not exists pgcrypto;

-- owner ------------------------------------------------------------------------
create table if not exists public.app_owner (email text primary key);
alter table public.app_owner enable row level security;  -- no policies: only SQL editor / service role

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.app_owner where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- enums ------------------------------------------------------------------------
do $$ begin
  create type public.job_status as enum (
    'new', 'shortlisted', 'tailor_queued', 'tailored', 'applied', 'interviewing', 'offer', 'rejected',
    'skipped', 'archived'
  );
exception when duplicate_object then null; end $$;

-- runs -------------------------------------------------------------------------
create table if not exists public.runs (
  id uuid primary key default gen_random_uuid(),
  trigger text not null default 'manual',
  status text not null default 'running',
  summary jsonb,
  fetched int,
  new_jobs int,
  scored int,
  tailored int,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

-- jobs -------------------------------------------------------------------------
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,
  title text not null,
  company text not null,
  location text,
  city text,
  remote boolean not null default false,
  remote_region text,
  apply_url text,
  description text,
  salary_min numeric,
  salary_max numeric,
  currency text,
  posted_at timestamptz,
  track text,
  min_years int,
  prefilter_score real,
  llm_score int,
  score_reason text,
  missing_keywords jsonb not null default '[]'::jsonb,
  status public.job_status not null default 'new',
  captured_by text not null default 'bot',
  notes text,
  tags text[] not null default '{}',
  applied_at timestamptz,
  first_run_id uuid references public.runs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists jobs_status_idx on public.jobs (status);
create index if not exists jobs_score_idx on public.jobs (llm_score desc nulls last);
create index if not exists jobs_created_idx on public.jobs (created_at desc);

create table if not exists public.job_links (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  source text not null,
  url text not null,
  url_key text not null unique,
  source_job_id text,
  created_at timestamptz not null default now()
);
create index if not exists job_links_job_idx on public.job_links (job_id);

create or replace function public.touch_job() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.status = 'applied' and old.status is distinct from 'applied' and new.applied_at is null then
    new.applied_at := now();
  end if;
  return new;
end $$;
drop trigger if exists jobs_touch on public.jobs;
create trigger jobs_touch before update on public.jobs for each row execute function public.touch_job();

-- tailored resumes -------------------------------------------------------------
create table if not exists public.tailorings (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  created_at timestamptz not null default now(),
  provider text,
  model text,
  status text,                -- ok | needs_review
  diagnostics jsonb,          -- Phase 1: match score, missing keywords, red flags, section strategy
  verification jsonb,         -- Phase 3: ATS parser + hiring manager notes
  content jsonb,              -- Phase 2: rewritten summary, bullets, skills
  lint_issues jsonb,
  fixes jsonb,
  revisions int,
  pages int,
  fill_ratio real,
  layout_level int,
  tex_path text,
  pdf_path text
);
create index if not exists tailorings_job_idx on public.tailorings (job_id, created_at desc);

-- consumption ------------------------------------------------------------------
create table if not exists public.llm_usage (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.runs(id) on delete set null,
  ts timestamptz not null default now(),
  provider text not null,
  model text not null,
  purpose text not null,       -- score | tailor | revise
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  thinking_tokens int not null default 0,
  cached_tokens int not null default 0,
  latency_ms int not null default 0,
  status text not null,        -- ok | rate_limited | error | skipped_cap
  cost_usd numeric(12, 6) not null default 0,
  shadow_cost_usd numeric(12, 6) not null default 0,
  error text,
  job_id uuid references public.jobs(id) on delete set null
);
create index if not exists llm_usage_ts_idx on public.llm_usage (ts desc);

create table if not exists public.api_usage (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.runs(id) on delete set null,
  ts timestamptz not null default now(),
  source text not null,
  calls int not null default 0,
  results int not null default 0,
  status text not null,        -- ok | empty | blocked | broken | error | timeout | skipped
  cost_usd numeric(12, 6) not null default 0,
  remaining int,
  error text
);
create index if not exists api_usage_ts_idx on public.api_usage (ts desc);

create table if not exists public.balance_snapshots (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.runs(id) on delete set null,
  checked_at timestamptz not null default now(),
  provider text not null,
  kind text not null,          -- money | quota
  unit text not null,          -- USD | requests | calls
  used numeric not null,
  limit_value numeric,
  remaining numeric,
  period text not null,        -- day | month | lifetime
  method text not null,        -- live_api | ledger | manual
  note text
);
create index if not exists balance_snapshots_provider_idx on public.balance_snapshots (provider, checked_at desc);

create table if not exists public.credit_topups (
  id uuid primary key default gen_random_uuid(),
  provider text not null,      -- e.g. anthropic, gemini
  amount_usd numeric(12, 2) not null check (amount_usd > 0),
  purchased_at timestamptz not null default now(),
  note text,
  created_at timestamptz not null default now()
);

-- views (security_invoker so RLS of the caller applies) ---------------------------
create or replace view public.usage_daily with (security_invoker = true) as
select
  (date_trunc('day', ts at time zone 'Asia/Kolkata'))::date as day,
  provider, model, purpose,
  count(*) filter (where status <> 'skipped_cap') as requests,
  count(*) filter (where status in ('rate_limited', 'error')) as failed,
  sum(input_tokens) as input_tokens,
  sum(output_tokens) as output_tokens,
  sum(thinking_tokens) as thinking_tokens,
  sum(cached_tokens) as cached_tokens,
  sum(cost_usd) as cost_usd,
  sum(shadow_cost_usd) as shadow_cost_usd
from public.llm_usage
group by 1, 2, 3, 4;

create or replace view public.api_usage_daily with (security_invoker = true) as
select
  (date_trunc('day', ts at time zone 'Asia/Kolkata'))::date as day,
  source,
  sum(calls) as calls,
  sum(results) as results,
  sum(cost_usd) as cost_usd,
  count(*) filter (where status in ('blocked', 'broken', 'error', 'timeout')) as failures
from public.api_usage
group by 1, 2;

create or replace view public.latest_balances with (security_invoker = true) as
select distinct on (provider) *
from public.balance_snapshots
order by provider, checked_at desc;

-- Live credit balance for providers without a balance API: top-ups minus recorded spend since the
-- first top-up. Updates the moment a top-up is added, without waiting for the next run.
create or replace view public.credit_balance with (security_invoker = true) as
with t as (
  select provider, sum(amount_usd) as credit_usd, min(purchased_at) as since
  from public.credit_topups group by provider
)
select
  t.provider,
  t.credit_usd,
  coalesce((select sum(u.cost_usd) from public.llm_usage u where u.provider = t.provider and u.ts >= t.since), 0)
    as spent_usd,
  t.credit_usd - coalesce(
    (select sum(u.cost_usd) from public.llm_usage u where u.provider = t.provider and u.ts >= t.since), 0
  ) as balance_usd,
  t.since
from t;

-- extension capture ------------------------------------------------------------
-- Save a job seen while browsing. If any site already linked it, just queue it for tailoring.
create or replace function public.capture_job(
  p_title text, p_company text, p_location text, p_description text, p_url text, p_url_key text,
  p_source text, p_queue boolean default true
) returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid;
begin
  select job_id into v_id from public.job_links where url_key = p_url_key;
  if v_id is null then
    insert into public.jobs (fingerprint, title, company, location, apply_url, description, status, captured_by)
    values ('ext:' || p_url_key, p_title, p_company, p_location, p_url, p_description,
            case when p_queue then 'tailor_queued'::public.job_status else 'new'::public.job_status end, 'extension')
    on conflict (fingerprint) do update set description = excluded.description
    returning id into v_id;
    insert into public.job_links (job_id, source, url, url_key) values (v_id, p_source, p_url, p_url_key)
    on conflict (url_key) do nothing;
  else
    update public.jobs
      set status = case when p_queue and status in ('new', 'shortlisted') then 'tailor_queued' else status end,
          description = case when length(coalesce(description, '')) < length(coalesce(p_description, ''))
                             then p_description else description end
      where id = v_id;
  end if;
  return v_id;
end $$;

-- row level security -------------------------------------------------------------
alter table public.runs enable row level security;
alter table public.jobs enable row level security;
alter table public.job_links enable row level security;
alter table public.tailorings enable row level security;
alter table public.llm_usage enable row level security;
alter table public.api_usage enable row level security;
alter table public.balance_snapshots enable row level security;
alter table public.credit_topups enable row level security;

do $$
declare t text;
begin
  foreach t in array array['runs', 'jobs', 'job_links', 'tailorings', 'llm_usage', 'api_usage',
                           'balance_snapshots', 'credit_topups'] loop
    execute format('drop policy if exists owner_read on public.%I', t);
    execute format('create policy owner_read on public.%I for select to authenticated using (public.is_owner())', t);
  end loop;
  foreach t in array array['jobs', 'job_links', 'credit_topups'] loop
    execute format('drop policy if exists owner_write on public.%I', t);
    execute format('create policy owner_write on public.%I for all to authenticated '
                   'using (public.is_owner()) with check (public.is_owner())', t);
  end loop;
end $$;

grant execute on function public.capture_job(text, text, text, text, text, text, text, boolean) to authenticated;

-- storage: private bucket for .tex / .pdf ------------------------------------------
insert into storage.buckets (id, name, public) values ('resumes', 'resumes', false)
on conflict (id) do nothing;

drop policy if exists "owner reads resumes" on storage.objects;
create policy "owner reads resumes" on storage.objects for select to authenticated
  using (bucket_id = 'resumes' and public.is_owner());
