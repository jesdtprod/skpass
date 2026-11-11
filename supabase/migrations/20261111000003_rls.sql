-- Migration 3: role helpers, grants, RLS policies, audit triggers, private photo bucket.
-- Rules: anon has NO access. No DELETE policy anywhere (soft delete only, via RPC in migration 4).
-- Guards never read vehicles directly; the scan RPC (SECURITY DEFINER) returns what they need.

-- ------------------------------------------------------------ role helpers
create or replace function public.current_role_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid() and p.active and p.deleted_at is null
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_role_name() = 'admin', false)
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_role_name() in ('admin', 'guard'), false)
$$;

-- --------------------------------------------------- function privileges
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;

-- ------------------------------------------------------------------ grants
-- (RLS policies below do the real filtering; no DELETE grant for anyone.)
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.vehicles to authenticated;
grant select, insert, update on public.gates to authenticated;
grant select on public.gate_logs to authenticated;
grant select, insert, update on public.settings to authenticated;
grant select on public.audit_logs to authenticated;
grant select on public.v_vehicles_inside to authenticated;
-- rate_limits: service role only (no grant to authenticated)

-- ------------------------------------------------------------------ profiles
create policy profiles_select on public.profiles for select to authenticated
  using (deleted_at is null and (id = auth.uid() or public.is_admin()));
create policy profiles_insert on public.profiles for insert to authenticated
  with check (public.is_admin());
create policy profiles_update on public.profiles for update to authenticated
  using (deleted_at is null and public.is_admin())
  with check (deleted_at is null and public.is_admin());

-- ------------------------------------------------------------------ vehicles
create policy vehicles_select on public.vehicles for select to authenticated
  using (deleted_at is null and public.is_admin());
create policy vehicles_insert on public.vehicles for insert to authenticated
  with check (public.is_admin());
create policy vehicles_update on public.vehicles for update to authenticated
  using (deleted_at is null and public.is_admin())
  with check (deleted_at is null and public.is_admin());

-- --------------------------------------------------------------------- gates
create policy gates_select on public.gates for select to authenticated
  using (deleted_at is null and (public.is_admin() or (public.is_staff() and active)));
create policy gates_insert on public.gates for insert to authenticated
  with check (public.is_admin());
create policy gates_update on public.gates for update to authenticated
  using (deleted_at is null and public.is_admin())
  with check (deleted_at is null and public.is_admin());

-- ---------------------------------------------------------------- gate_logs
-- No insert/update policy: rows are written only by scan_vehicle (SECURITY DEFINER).
create policy gate_logs_select on public.gate_logs for select to authenticated
  using (
    deleted_at is null and (
      public.is_admin()
      or (public.is_staff() and scanned_by = auth.uid() and scanned_at > now() - interval '1 day')
    )
  );

-- ----------------------------------------------------------------- settings
create policy settings_select on public.settings for select to authenticated
  using (deleted_at is null and (public.is_admin() or (public.is_staff() and is_public)));
create policy settings_insert on public.settings for insert to authenticated
  with check (public.is_admin());
create policy settings_update on public.settings for update to authenticated
  using (deleted_at is null and public.is_admin())
  with check (deleted_at is null and public.is_admin());

-- --------------------------------------------------------------- audit_logs
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (deleted_at is null and public.is_admin());
-- (writes only via triggers / SECURITY DEFINER functions)

-- ------------------------------------------------------------ audit trigger
-- Never copies secrets (token, claim_hash) into the audit trail.
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  b jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) - 'token' - 'claim_hash' end;
  a jsonb := to_jsonb(new) - 'token' - 'claim_hash';
begin
  insert into public.audit_logs (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), lower(tg_op), tg_table_name, new.id::text, b, a);
  return new;
end;
$$;

create trigger trg_vehicles_audit after insert or update on public.vehicles
  for each row execute function public.audit_row_change();
create trigger trg_gates_audit after insert or update on public.gates
  for each row execute function public.audit_row_change();
create trigger trg_settings_audit after insert or update on public.settings
  for each row execute function public.audit_row_change();
create trigger trg_profiles_audit after insert or update on public.profiles
  for each row execute function public.audit_row_change();

-- Audit log is append-only: block UPDATE and DELETE for everyone, including admins.
create or replace function public.audit_logs_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_logs is append-only';
end;
$$;

create trigger trg_audit_logs_immutable before update or delete on public.audit_logs
  for each row execute function public.audit_logs_immutable();

-- ------------------------------------------------------------ photo storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vehicle-photos', 'vehicle-photos', false, 2097152,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Staff can read (to create signed URLs); only admins can write. Public uploads go through the
-- register-vehicle Edge Function using the service role.
create policy vehicle_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'vehicle-photos' and public.is_staff());
create policy vehicle_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'vehicle-photos' and public.is_admin());
create policy vehicle_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'vehicle-photos' and public.is_admin());
