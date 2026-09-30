-- Run after 0007. Safe to re-run. Backs the dashboard's Companies, Preferences, Settings, Activity and
-- Applications pages, and stores the review rounds of each tailored resume.

-- the rounds each resume went through: build (analysis), hiring manager and VP reviews, fix-up; ATS each
alter table public.tailorings add column if not exists rounds jsonb;

-- Preferences and Settings: one row, read by the bot at the start of every run ----------------------
create table if not exists public.user_settings (
  id int primary key default 1 check (id = 1),
  preferences jsonb not null default '{}'::jsonb,  -- target level/roles, emphasis, tracks, cities, salary floor
  settings jsonb not null default '{}'::jsonb,     -- AI provider, ATS bar, review rounds, per-run limits
  updated_at timestamptz not null default now()
);
insert into public.user_settings (id) values (1) on conflict (id) do nothing;

-- Companies: salary brackets, career boards to scan, targets ----------------------------------------
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  salary_min_lpa numeric check (salary_min_lpa >= 0),
  salary_max_lpa numeric check (salary_max_lpa >= salary_min_lpa),
  salary_source text,
  careers_url text,
  board text check (board in ('greenhouse', 'lever', 'ashby')),
  board_slug text,
  target boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((board is null) = (board_slug is null))
);
create unique index if not exists companies_name_key on public.companies (lower(name));

-- Activity: every status change of a job, and jobs you saved yourself --------------------------------
create table if not exists public.job_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null check (kind in ('saved', 'status')),
  from_status public.job_status,
  to_status public.job_status
);
create index if not exists job_events_job_idx on public.job_events (job_id);
create index if not exists job_events_at_idx on public.job_events (at desc);

create or replace function public.log_job_event() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.captured_by <> 'bot' then
      insert into public.job_events (job_id, kind, to_status) values (new.id, 'saved', new.status);
    end if;
  elsif new.status is distinct from old.status then
    insert into public.job_events (job_id, kind, from_status, to_status) values (new.id, 'status', old.status, new.status);
  end if;
  return null;
end $$;
revoke execute on function public.log_job_event() from public, anon, authenticated;
drop trigger if exists jobs_log_event on public.jobs;
create trigger jobs_log_event after insert or update of status on public.jobs
  for each row execute function public.log_job_event();

-- Owner-only access, one policy per action, as in 0003 --------------------------------------------------
alter table public.user_settings enable row level security;
alter table public.companies enable row level security;
alter table public.job_events enable row level security;

do $$
declare t text;
begin
  foreach t in array array['user_settings', 'companies', 'job_events'] loop
    execute format('drop policy if exists owner_read on public.%I', t);
    execute format('create policy owner_read on public.%I for select to authenticated '
                   'using ((select public.is_owner()))', t);
    execute format('drop policy if exists owner_insert on public.%I', t);
    execute format('create policy owner_insert on public.%I for insert to authenticated '
                   'with check ((select public.is_owner()))', t);
  end loop;
  foreach t in array array['user_settings', 'companies'] loop
    execute format('drop policy if exists owner_update on public.%I', t);
    execute format('create policy owner_update on public.%I for update to authenticated '
                   'using ((select public.is_owner())) with check ((select public.is_owner()))', t);
  end loop;
  drop policy if exists owner_delete on public.companies;
  create policy owner_delete on public.companies for delete to authenticated using ((select public.is_owner()));
end $$;

grant select, insert, update on public.user_settings to authenticated;
grant select, insert, update, delete on public.companies to authenticated;
grant select, insert on public.job_events to authenticated;

drop trigger if exists companies_touch on public.companies;
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;
create trigger companies_touch before update on public.companies
  for each row execute function public.touch_updated_at();
drop trigger if exists user_settings_touch on public.user_settings;
create trigger user_settings_touch before update on public.user_settings
  for each row execute function public.touch_updated_at();

-- Seed: the salary brackets (LPA, India) from hey.aanchal's Instagram post "Everyone is chasing FAANG.
-- Meanwhile, these companies are quietly paying 30+ LPA in India." Compensation varies with role,
-- experience, location and skills. Existing rows (and your edits to them) are left alone.
insert into public.companies (name, category, salary_min_lpa, salary_max_lpa, salary_source) values
  ('Atlassian', 'Dev tools & SaaS', 40, 70, 'hey.aanchal (Instagram)'),
  ('Postman', 'Dev tools & SaaS', 35, 60, 'hey.aanchal (Instagram)'),
  ('BrowserStack', 'Dev tools & SaaS', 30, 50, 'hey.aanchal (Instagram)'),
  ('Chargebee', 'Dev tools & SaaS', 30, 45, 'hey.aanchal (Instagram)'),
  ('Salesforce', 'Enterprise software', 30, 60, 'hey.aanchal (Instagram)'),
  ('ServiceNow', 'Enterprise software', 30, 55, 'hey.aanchal (Instagram)'),
  ('SAP', 'Enterprise software', 30, 50, 'hey.aanchal (Instagram)'),
  ('Workday', 'Enterprise software', 30, 50, 'hey.aanchal (Instagram)'),
  ('Walmart Global Tech', 'Retail tech', 30, 50, 'hey.aanchal (Instagram)'),
  ('Target', 'Retail tech', 30, 50, 'hey.aanchal (Instagram)'),
  ('JPMorgan Chase', 'Banking & finance', 35, 60, 'hey.aanchal (Instagram)'),
  ('Goldman Sachs', 'Banking & finance', 40, 70, 'hey.aanchal (Instagram)'),
  ('Razorpay', 'Fintech', 30, 45, 'hey.aanchal (Instagram)'),
  ('Juspay', 'Fintech', 30, 50, 'hey.aanchal (Instagram)'),
  ('Groww', 'Fintech', 30, 45, 'hey.aanchal (Instagram)'),
  ('CRED', 'Fintech', 30, 50, 'hey.aanchal (Instagram)'),
  ('Adobe', 'Enterprise software', 30, 55, 'hey.aanchal (Instagram)'),
  ('Intuit', 'Enterprise software', 30, 50, 'hey.aanchal (Instagram)'),
  ('Nutanix', 'Enterprise software', 30, 50, 'hey.aanchal (Instagram)'),
  ('VMware', 'Enterprise software', 30, 50, 'hey.aanchal (Instagram)'),
  ('Morgan Stanley', 'Banking & finance', 35, 60, 'hey.aanchal (Instagram)'),
  ('American Express', 'Banking & finance', 30, 50, 'hey.aanchal (Instagram)'),
  ('HSBC', 'Banking & finance', 30, 45, 'hey.aanchal (Instagram)'),
  ('BlackRock', 'Banking & finance', 35, 60, 'hey.aanchal (Instagram)'),
  ('Snowflake', 'Data & infrastructure', 50, 90, 'hey.aanchal (Instagram)'),
  ('Databricks', 'Data & infrastructure', 45, 80, 'hey.aanchal (Instagram)'),
  ('Confluent', 'Data & infrastructure', 40, 70, 'hey.aanchal (Instagram)'),
  ('NVIDIA', 'Semiconductors', 40, 80, 'hey.aanchal (Instagram)'),
  ('AMD', 'Semiconductors', 35, 60, 'hey.aanchal (Instagram)'),
  ('Qualcomm', 'Semiconductors', 30, 50, 'hey.aanchal (Instagram)'),
  ('Intel', 'Semiconductors', 30, 45, 'hey.aanchal (Instagram)'),
  ('Turnitin', 'Dev tools & SaaS', 30, 45, 'hey.aanchal (Instagram)'),
  ('UiPath', 'Dev tools & SaaS', 30, 50, 'hey.aanchal (Instagram)'),
  ('Dropbox', 'Dev tools & SaaS', 30, 50, 'hey.aanchal (Instagram)'),
  ('Canva', 'Dev tools & SaaS', 30, 50, 'hey.aanchal (Instagram)'),
  ('Twilio', 'Dev tools & SaaS', 30, 50, 'hey.aanchal (Instagram)'),
  ('Okta', 'Security', 25, 45, 'hey.aanchal (Instagram)'),
  ('Elastic', 'Data & infrastructure', 30, 50, 'hey.aanchal (Instagram)'),
  ('Palantir', 'Data & infrastructure', 35, 60, 'hey.aanchal (Instagram)'),
  ('CrowdStrike', 'Security', 30, 55, 'hey.aanchal (Instagram)'),
  ('Figma', 'Dev tools & SaaS', 30, 50, 'hey.aanchal (Instagram)'),
  ('Microsoft', 'Big tech', 30, 60, 'hey.aanchal (Instagram)'),
  ('Google', 'Big tech', 30, 60, 'hey.aanchal (Instagram)'),
  ('Amazon', 'Big tech', 30, 50, 'hey.aanchal (Instagram)'),
  ('Apple', 'Big tech', 30, 50, 'hey.aanchal (Instagram)'),
  ('Uber', 'Big tech', 30, 50, 'hey.aanchal (Instagram)'),
  ('Airbnb', 'Big tech', 30, 50, 'hey.aanchal (Instagram)'),
  ('Checkout.com', 'Fintech', 30, 50, 'hey.aanchal (Instagram)'),
  ('Dunzo', 'Consumer internet', 30, 45, 'hey.aanchal (Instagram)'),
  ('Zepto', 'Consumer internet', 30, 45, 'hey.aanchal (Instagram)'),
  ('Swiggy', 'Consumer internet', 30, 45, 'hey.aanchal (Instagram)'),
  ('Zomato', 'Consumer internet', 30, 45, 'hey.aanchal (Instagram)'),
  ('Blinkit', 'Consumer internet', 30, 45, 'hey.aanchal (Instagram)'),
  ('Brex', 'Fintech', 30, 55, 'hey.aanchal (Instagram)'),
  ('Plaid', 'Fintech', 30, 55, 'hey.aanchal (Instagram)'),
  ('Stripe', 'Fintech', 35, 60, 'hey.aanchal (Instagram)'),
  ('Coinbase', 'Fintech', 30, 55, 'hey.aanchal (Instagram)'),
  ('PhonePe', 'Fintech', 30, 45, 'hey.aanchal (Instagram)'),
  ('Paytm', 'Fintech', 30, 45, 'hey.aanchal (Instagram)'),
  ('Flipkart', 'Consumer internet', 30, 45, 'hey.aanchal (Instagram)'),
  ('Meesho', 'Consumer internet', 30, 45, 'hey.aanchal (Instagram)'),
  ('LTIMindtree', 'IT services & consulting', 30, 45, 'hey.aanchal (Instagram)'),
  ('Thoughtworks', 'IT services & consulting', 30, 45, 'hey.aanchal (Instagram)'),
  ('Publicis Sapient', 'IT services & consulting', 30, 45, 'hey.aanchal (Instagram)'),
  ('EPAM Systems', 'IT services & consulting', 30, 45, 'hey.aanchal (Instagram)')
on conflict ((lower(name))) do nothing;

-- Remote's Greenhouse board (also in config/companies.yaml), so it shows on the Companies page
insert into public.companies (name, category, careers_url, board, board_slug)
values ('Remote', 'Remote-first', 'https://job-boards.greenhouse.io/remotecom', 'greenhouse', 'remotecom')
on conflict ((lower(name))) do nothing;
