-- Run after 0002. Safe to re-run. Fixes what Supabase's database advisors reported on 0001 + 0002.

-- is_owner(): no longer SECURITY DEFINER. A signed-in user may read only their own app_owner row,
-- which is all the check needs.
drop policy if exists self_read on public.app_owner;
create policy self_read on public.app_owner for select to authenticated
  using (lower(email) = lower(coalesce((select auth.jwt()) ->> 'email', '')));
grant select on public.app_owner to authenticated;
alter function public.is_owner() security invoker;

-- One permissive policy per action (a FOR ALL write policy also applied to SELECT, so every read
-- evaluated two policies). (select is_owner()) runs once per statement instead of once per row.
do $$
declare t text;
begin
  foreach t in array array['runs', 'jobs', 'job_links', 'tailorings', 'llm_usage', 'api_usage',
                           'balance_snapshots', 'credit_topups', 'profile_snapshot', 'skill_status'] loop
    execute format('drop policy if exists owner_read on public.%I', t);
    execute format('create policy owner_read on public.%I for select to authenticated '
                   'using ((select public.is_owner()))', t);
  end loop;
  foreach t in array array['jobs', 'job_links', 'credit_topups', 'skill_status'] loop
    execute format('drop policy if exists owner_write on public.%I', t);
    execute format('drop policy if exists owner_insert on public.%I', t);
    execute format('drop policy if exists owner_update on public.%I', t);
    execute format('drop policy if exists owner_delete on public.%I', t);
    execute format('create policy owner_insert on public.%I for insert to authenticated '
                   'with check ((select public.is_owner()))', t);
    execute format('create policy owner_update on public.%I for update to authenticated '
                   'using ((select public.is_owner())) with check ((select public.is_owner()))', t);
    execute format('create policy owner_delete on public.%I for delete to authenticated '
                   'using ((select public.is_owner()))', t);
  end loop;
end $$;

drop policy if exists "owner reads resumes" on storage.objects;
create policy "owner reads resumes" on storage.objects for select to authenticated
  using (bucket_id = 'resumes' and (select public.is_owner()));

-- Indexes for foreign keys (deleting a run or job would otherwise scan these tables).
create index if not exists api_usage_run_idx on public.api_usage (run_id);
create index if not exists balance_snapshots_run_idx on public.balance_snapshots (run_id);
create index if not exists jobs_first_run_idx on public.jobs (first_run_id);
create index if not exists llm_usage_job_idx on public.llm_usage (job_id);
create index if not exists llm_usage_run_idx on public.llm_usage (run_id);
