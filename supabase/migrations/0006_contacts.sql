-- Contacts: HR, recruiter and hiring-manager contacts by company, and every follow-up with each.
--
-- A per-account add-on. Unlike the job tables (one owner, is_owner()), these rows belong to the signed-in
-- user (owner = auth.uid()) and are visible only while that account holds the 'contacts' feature grant.
-- Grants are written only from the SQL editor or with the service role, so an account gets the module only
-- when you grant it (for example after a separate payment). The owner account is granted it below.

create table if not exists public.feature_grants (
  user_id uuid not null references auth.users (id) on delete cascade,
  feature text not null,
  granted_at timestamptz not null default now(),
  note text,
  primary key (user_id, feature)
);
alter table public.feature_grants enable row level security;
drop policy if exists self_read on public.feature_grants;
create policy self_read on public.feature_grants for select to authenticated using (user_id = (select auth.uid()));
grant select on public.feature_grants to authenticated;

create or replace function public.has_feature(f text) returns boolean
language sql stable security invoker set search_path = public as $$
  select exists (select 1 from public.feature_grants where user_id = (select auth.uid()) and feature = f)
$$;
revoke execute on function public.has_feature(text) from public, anon;
grant execute on function public.has_feature(text) to authenticated;

create table if not exists public.contact_companies (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  linkedin_url text,
  website text,
  target boolean not null default false,  -- a company you are going after: reach its leaders too
  notes text,
  created_at timestamptz not null default now(),
  unique (owner, name)
);

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  company_id uuid references public.contact_companies (id) on delete set null,
  name text,
  role text not null default 'HR',
  kind text not null default 'hr' check (kind in ('hr', 'recruiter', 'consultant', 'leader')),
  location text,
  phones jsonb not null default '[]'::jsonb,  -- [{"number": "+919876543210", "whatsapp": true}]
  emails text[] not null default '{}',
  linkedin_url text,
  status text not null default 'new'
    check (status in ('new', 'reaching_out', 'in_touch', 'interviewing', 'closed', 'do_not_contact')),
  notes text,
  source text,  -- where the contact came from: "WhatsApp group, Sep 2026"
  labels text[] not null default '{}',  -- the names it was saved under, as received
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.contact_touches (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  channel text not null check (channel in ('linkedin', 'email', 'whatsapp', 'call')),
  outcome text not null check (outcome in
    ('sent', 'invite_sent', 'accepted', 'replied', 'no_answer', 'call_scheduled', 'interview', 'not_interested')),
  note text,
  at timestamptz not null default now()
);

create table if not exists public.outreach_settings (
  owner uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  my_name text,
  my_email text,
  my_phone text,
  my_linkedin text,
  headline text,
  pitch text,        -- one line used in every message
  target_role text,
  resume_url text,
  cadence_days int not null default 2 check (cadence_days between 1 and 7),
  updated_at timestamptz not null default now()
);

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists contacts_touch on public.contacts;
create trigger contacts_touch before update on public.contacts for each row execute function public.touch_updated_at();
drop trigger if exists outreach_settings_touch on public.outreach_settings;
create trigger outreach_settings_touch before update on public.outreach_settings
  for each row execute function public.touch_updated_at();

create index if not exists contacts_owner_idx on public.contacts (owner);
create index if not exists contacts_company_idx on public.contacts (company_id);
create index if not exists contact_touches_contact_idx on public.contact_touches (contact_id, at);
create index if not exists contact_touches_owner_idx on public.contact_touches (owner);

-- Your rows, and only while your account holds the Contacts add-on.
do $$
declare t text;
begin
  foreach t in array array['contact_companies', 'contacts', 'contact_touches', 'outreach_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists own_read on public.%I', t);
    execute format('drop policy if exists own_insert on public.%I', t);
    execute format('drop policy if exists own_update on public.%I', t);
    execute format('drop policy if exists own_delete on public.%I', t);
    execute format('create policy own_read on public.%I for select to authenticated '
                   'using (owner = (select auth.uid()) and (select public.has_feature(''contacts'')))', t);
    execute format('create policy own_insert on public.%I for insert to authenticated '
                   'with check (owner = (select auth.uid()) and (select public.has_feature(''contacts'')))', t);
    execute format('create policy own_update on public.%I for update to authenticated '
                   'using (owner = (select auth.uid()) and (select public.has_feature(''contacts''))) '
                   'with check (owner = (select auth.uid()) and (select public.has_feature(''contacts'')))', t);
    execute format('create policy own_delete on public.%I for delete to authenticated '
                   'using (owner = (select auth.uid()) and (select public.has_feature(''contacts'')))', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- The owner account gets the add-on.
insert into public.feature_grants (user_id, feature, note)
select u.id, 'contacts', 'owner account'
from auth.users u join public.app_owner o on lower(o.email) = lower(u.email)
on conflict do nothing;
