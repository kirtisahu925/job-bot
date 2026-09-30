-- "No longer accepting applications": the posting stopped taking applicants (LinkedIn shows this on closed
-- jobs). Separate from rejected (they said no) and skipped (you said no).
alter type public.job_status add value if not exists 'expired' after 'offer';
