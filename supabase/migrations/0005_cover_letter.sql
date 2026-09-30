-- A short cover letter saved with each tailored resume, written from that resume's own facts.
alter table public.tailorings add column if not exists cover_letter text;

comment on column public.tailorings.cover_letter is
  'cover letter for this job, from the tailored resume; sentences citing unsupported facts are removed';
