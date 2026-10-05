-- Career pages for the companies on the Companies page. Workday joins Greenhouse, Lever and Ashby as a
-- board the scan reads (stored as "tenant/wdN/site"), and the scan records when it last looked for a
-- company's board: it finds them by itself (jobbot/sources/discover.py) and checks misses again after
-- two weeks.
alter table public.companies drop constraint if exists companies_board_check;
alter table public.companies add constraint companies_board_check
  check (board in ('greenhouse', 'lever', 'ashby', 'workday'));
alter table public.companies add column if not exists board_checked_at timestamptz;
