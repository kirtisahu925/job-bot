-- The weighted fit behind each job's match score: required skills, experience, domain, seniority, similar
-- work and education, each with its weight, value (0-1) and the reason. Written by the scoring step.
alter table public.jobs add column if not exists fit jsonb;
