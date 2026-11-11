-- Migration 6: fixed-window rate limiter used by Edge Functions (service role only).
-- Returns true while the caller is within the limit, false once exceeded.

create or replace function public.check_rate_limit(
  p_key text,
  p_limit int,
  p_window_seconds int
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  w timestamptz := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );
  c int;
begin
  insert into public.rate_limits (key, window_start, count)
  values (p_key, w, 1)
  on conflict (key, window_start)
  do update set count = public.rate_limits.count + 1
  returning count into c;

  -- Housekeeping: counters are operational data, not business data, so old windows are purged.
  if random() < 0.02 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;

  return c <= p_limit;
end;
$$;

revoke execute on function public.check_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, int, int) to service_role;
