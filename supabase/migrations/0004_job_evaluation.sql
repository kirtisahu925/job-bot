-- Career-ops style evaluation stored with each scored job: a do-not-apply verdict, and posting legitimacy
-- (is this a real, active opening?) kept separate from fit, with the observations and hard stops behind them.
alter table public.jobs
  add column if not exists verdict text check (verdict in ('apply', 'maybe', 'skip')),
  add column if not exists legitimacy text check (legitimacy in ('high', 'caution', 'suspicious')),
  add column if not exists legitimacy_signals jsonb not null default '[]'::jsonb,
  add column if not exists hard_stops jsonb not null default '[]'::jsonb;

comment on column public.jobs.verdict is 'apply / maybe / skip: whether to spend an application (skip = do not apply)';
comment on column public.jobs.legitimacy is 'high / caution / suspicious: likely a real, active opening, judged from the posting';
