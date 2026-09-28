-- Run after 0001_init.sql. Safe to re-run.
-- Adds: the owner's email, ATS scores, "Tailor now" bookkeeping, and the Skills tab (profile snapshot,
-- your per-skill choices, and demand for each skill across scanned jobs).

-- owner: only this login can read or change anything through the dashboard / extension
insert into public.app_owner (email) values ('ankitshilarkar2504@gmail.com') on conflict do nothing;

-- Functions are callable by signed-in users only (Supabase grants new functions to anon by default).
revoke execute on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;
revoke execute on function public.capture_job(text, text, text, text, text, text, text, boolean) from public, anon;
alter function public.touch_job() set search_path = public;

-- ATS -------------------------------------------------------------------------------
alter table public.jobs
  add column if not exists jd_keywords jsonb,           -- {required: [...], preferred: [...], degree_required}
  add column if not exists ats_score int,               -- latest tailored resume's ATS score
  add column if not exists tailor_requested_at timestamptz;

alter table public.tailorings
  add column if not exists ats_score int,
  add column if not exists ats jsonb;                    -- breakdown, matched, fixable, gaps, rounds, max_achievable

-- Skills tab ---------------------------------------------------------------------------
create table if not exists public.profile_snapshot (
  id int primary key default 1 check (id = 1),
  headline text,
  years_experience numeric,
  skills jsonb not null default '[]'::jsonb,           -- canonical skill names you can claim
  categories jsonb,                                      -- skills by category, as on your resume
  updated_at timestamptz not null default now()
);

create table if not exists public.skill_status (
  skill text primary key,                                -- canonical name, e.g. "Kafka"
  status text not null check (status in ('to_learn', 'learning', 'known', 'ignore')),
  note text,
  updated_at timestamptz not null default now()
);

-- How often each skill appears in scanned jobs (required vs preferred), with example jobs.
create or replace view public.skill_demand with (security_invoker = true) as
with kw as (
  select j.id, j.track, j.llm_score, s.value as skill, 'required' as kind
  from public.jobs j, jsonb_array_elements_text(coalesce(j.jd_keywords -> 'required', '[]'::jsonb)) s(value)
  where j.status <> 'archived'
  union all
  select j.id, j.track, j.llm_score, s.value, 'preferred'
  from public.jobs j, jsonb_array_elements_text(coalesce(j.jd_keywords -> 'preferred', '[]'::jsonb)) s(value)
  where j.status <> 'archived'
)
select
  lower(skill) as skill_key,
  min(skill) as skill,
  count(distinct id) filter (where kind = 'required') as required_by,
  count(distinct id) filter (where kind = 'preferred') as preferred_by,
  count(distinct id) as jobs,
  round(avg(llm_score))::int as avg_job_score,
  array_remove(array_agg(distinct track), null) as tracks,
  (array_agg(id order by llm_score desc nulls last))[1:5] as example_job_ids
from kw
group by lower(skill);

-- Number of jobs that have extracted keywords (the denominator for "required by N of M jobs").
create or replace view public.skill_demand_total with (security_invoker = true) as
select count(*)::int as jobs_with_keywords
from public.jobs
where jd_keywords is not null and status <> 'archived';

alter table public.profile_snapshot enable row level security;
alter table public.skill_status enable row level security;

drop policy if exists owner_read on public.profile_snapshot;
create policy owner_read on public.profile_snapshot for select to authenticated using (public.is_owner());
drop policy if exists owner_read on public.skill_status;
create policy owner_read on public.skill_status for select to authenticated using (public.is_owner());
drop policy if exists owner_write on public.skill_status;
create policy owner_write on public.skill_status for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

grant select on public.profile_snapshot, public.skill_demand, public.skill_demand_total to authenticated;
grant select, insert, update, delete on public.skill_status to authenticated;
