-- Jobs saved in bulk from a job site's search page with the extension ("Save N jobs from this page"),
-- for sites that block the bot (Naukri). The extension reads them from your own browser; the bot takes
-- them at the next scan as one more source, so they pass the same filters, de-duplication and scoring
-- as scanned jobs. Nothing here costs AI until then.
create table if not exists public.job_inbox (
  id uuid primary key default gen_random_uuid(),
  source text not null check (length(source) between 1 and 40),
  url text not null check (length(url) between 1 and 2000),
  url_key text not null check (length(url_key) between 1 and 300),
  title text not null check (length(title) between 1 and 300),
  company text not null check (length(company) between 1 and 200),
  location text check (length(location) <= 300),
  description text check (length(description) <= 60000),
  experience_text text check (length(experience_text) <= 120),
  job_type text check (length(job_type) <= 80),
  posted_at timestamptz,
  captured_at timestamptz not null default now(),
  processed_at timestamptz
);
-- the same posting saved twice is kept once (the extension inserts with on conflict do nothing)
create unique index if not exists job_inbox_url_key on public.job_inbox (url_key);
create index if not exists job_inbox_waiting on public.job_inbox (captured_at) where processed_at is null;

alter table public.job_inbox enable row level security;
drop policy if exists owner_read on public.job_inbox;
create policy owner_read on public.job_inbox for select to authenticated using ((select public.is_owner()));
drop policy if exists owner_insert on public.job_inbox;
create policy owner_insert on public.job_inbox for insert to authenticated
  with check ((select public.is_owner()) and processed_at is null);
-- the bot marks rows processed with the service role; signed-in users can only add and read
revoke all on public.job_inbox from anon, authenticated;
grant select, insert on public.job_inbox to authenticated;
