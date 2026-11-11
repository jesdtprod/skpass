-- Migration 14: live gate movements.
-- The admin dashboard refreshes itself when a guard records a scan. Realtime honours RLS, so only
-- people who may read gate_logs (admins; a guard only sees their own recent rows) receive events.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'gate_logs'
  ) then
    alter publication supabase_realtime add table public.gate_logs;
  end if;
end $$;
