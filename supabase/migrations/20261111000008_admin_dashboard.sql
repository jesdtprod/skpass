-- Migration 8: admin dashboard support.

-- Staff list needs a readable identity (Auth emails are not visible to RLS-bound clients).
alter table public.profiles add column if not exists email text;
update public.profiles p set email = u.email from auth.users u where u.id = p.id and p.email is null;

-- Dashboard numbers in one round trip (admin only). Days are bucketed in the site's timezone.
create or replace function public.admin_stats(p_days int default 14)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  tz text := coalesce(public._setting_text('timezone'), 'Asia/Manila');
  today date;
  n int := greatest(1, least(coalesce(p_days, 14), 90));
begin
  perform public._require_admin();
  today := (now() at time zone tz)::date;

  return jsonb_build_object(
    'timezone', tz,
    'today', today,
    'inside', (select count(*) from public.v_vehicles_inside),
    'scans_today', (select count(*) from public.gate_logs
                     where deleted_at is null and (scanned_at at time zone tz)::date = today),
    'warnings_today', (select count(*) from public.gate_logs
                        where deleted_at is null and result = 'warning'
                          and (scanned_at at time zone tz)::date = today),
    'pending', (select count(*) from public.vehicles where deleted_at is null and status = 'pending'),
    'approved', (select count(*) from public.vehicles where deleted_at is null and status = 'approved'),
    'blocked', (select count(*) from public.vehicles where deleted_at is null and status = 'blocked'),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'day', d::date::text, 'in', coalesce(s.i, 0), 'out', coalesce(s.o, 0))
             order by d), '[]'::jsonb)
      from generate_series(today - (n - 1), today, interval '1 day') as d
      left join (
        select (scanned_at at time zone tz)::date as day,
               count(*) filter (where direction = 'IN') as i,
               count(*) filter (where direction = 'OUT') as o
        from public.gate_logs
        where deleted_at is null and scanned_at >= ((today - (n - 1))::timestamp at time zone tz)
        group by 1
      ) s on s.day = d::date
    ),
    'by_gate_today', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'gate', g.name, 'in', coalesce(x.i, 0), 'out', coalesce(x.o, 0))
             order by g.name), '[]'::jsonb)
      from public.gates g
      left join (
        select gate_id,
               count(*) filter (where direction = 'IN') as i,
               count(*) filter (where direction = 'OUT') as o
        from public.gate_logs
        where deleted_at is null and (scanned_at at time zone tz)::date = today
        group by gate_id
      ) x on x.gate_id = g.id
      where g.deleted_at is null
    )
  );
end;
$$;

revoke execute on function public.admin_stats(int) from public, anon;
grant execute on function public.admin_stats(int) to authenticated, service_role;
