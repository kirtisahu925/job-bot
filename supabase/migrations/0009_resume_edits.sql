-- Run after 0008. Safe to re-run. Resumes edited by hand in the dashboard's LaTeX editor: the edited source
-- waits here until the Tailor workflow (started by Tailor now, or the next scheduled scan) compiles and scores
-- it and saves it as the job's newest resume; if it does not compile, the LaTeX error is kept here to show.
create table if not exists public.resume_edits (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  base_tailoring_id uuid references public.tailorings(id) on delete set null,
  tex text not null check (length(tex) between 1 and 200000),
  status text not null default 'queued' check (status in ('queued', 'compiling', 'done', 'failed')),
  error text,
  result_tailoring_id uuid references public.tailorings(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists resume_edits_job_idx on public.resume_edits (job_id, created_at desc);
create index if not exists resume_edits_queued_idx on public.resume_edits (created_at) where status = 'queued';
create index if not exists resume_edits_base_idx on public.resume_edits (base_tailoring_id);
create index if not exists resume_edits_result_idx on public.resume_edits (result_tailoring_id);

-- the owner writes edits and reads their status; only the bot (service role) compiles and updates them
alter table public.resume_edits enable row level security;
drop policy if exists owner_read on public.resume_edits;
create policy owner_read on public.resume_edits for select to authenticated using ((select public.is_owner()));
drop policy if exists owner_insert on public.resume_edits;
create policy owner_insert on public.resume_edits for insert to authenticated
  with check ((select public.is_owner()) and status = 'queued' and error is null and result_tailoring_id is null);
revoke all on public.resume_edits from anon, authenticated;
grant select, insert on public.resume_edits to authenticated;
