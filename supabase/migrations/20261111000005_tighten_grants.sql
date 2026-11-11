-- Migration 5: make table privileges match the design exactly (defence in depth on top of RLS).
-- Supabase's default privileges grant authenticated full DML on new tables; remove that and
-- re-grant only what the policies in migration 3 intend.

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.vehicles to authenticated;
grant select, insert, update on public.gates to authenticated;
grant select on public.gate_logs to authenticated;            -- written only by scan RPC
grant select, insert, update on public.settings to authenticated;
grant select on public.audit_logs to authenticated;           -- written only by triggers
grant select on public.v_vehicles_inside to authenticated;
-- rate_limits: service role only
