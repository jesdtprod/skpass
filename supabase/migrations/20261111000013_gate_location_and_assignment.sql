-- Migration 13: gate locations and per-staff gate assignment.
--  * gates.location: where the gate is (shown to guards and in the admin lists).
--  * staff_gates: which gates each staff account may use (one or many). Written only through
--    set_staff_gates() (admin). Guards see and scan only their assigned gates; admins see all.
--  * scan_vehicle refuses a gate the guard is not assigned to (also when replayed offline).

alter table public.gates
  add column if not exists location text check (location is null or char_length(location) <= 120);

create table public.staff_gates (
  id          text primary key default public.gen_ulid(),
  profile_id  uuid not null references public.profiles (id),
  gate_id     text not null references public.gates (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  created_by  uuid
);
create unique index staff_gates_active_key on public.staff_gates (profile_id, gate_id)
  where deleted_at is null;
create index staff_gates_gate_idx on public.staff_gates (gate_id) where deleted_at is null;

create trigger trg_staff_gates_updated_at before update on public.staff_gates
  for each row execute function public.set_updated_at();
create trigger trg_staff_gates_audit after insert or update on public.staff_gates
  for each row execute function public.audit_row_change();

alter table public.staff_gates enable row level security;
revoke all on public.staff_gates from anon, authenticated;
grant select on public.staff_gates to authenticated;
create policy staff_gates_select on public.staff_gates for select to authenticated
  using (deleted_at is null and (public.is_admin() or profile_id = auth.uid()));

-- Guards only see the gates assigned to them (admins still see everything).
drop policy gates_select on public.gates;
create policy gates_select on public.gates for select to authenticated
  using (
    deleted_at is null and (
      public.is_admin() or (
        public.is_staff() and active and exists (
          select 1 from public.staff_gates sg
           where sg.profile_id = auth.uid() and sg.gate_id = gates.id and sg.deleted_at is null
        )
      )
    )
  );

-- Replace a staff member's gate list in one call (admin only).
create or replace function public.set_staff_gates(p_profile_id uuid, p_gate_ids text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ids text[] := coalesce((select array_agg(distinct x) from unnest(p_gate_ids) x), '{}');
  n int;
begin
  perform public._require_admin();
  if not exists (select 1 from public.profiles where id = p_profile_id and deleted_at is null) then
    raise exception 'staff_not_found';
  end if;
  select count(*) into n from public.gates where id = any(ids) and deleted_at is null;
  if n <> coalesce(array_length(ids, 1), 0) then
    raise exception 'unknown_gate';
  end if;
  update public.staff_gates
     set deleted_at = now()
   where profile_id = p_profile_id and deleted_at is null and gate_id <> all(ids);
  insert into public.staff_gates (profile_id, gate_id, created_by)
  select p_profile_id, x, auth.uid() from unnest(ids) x
   where not exists (
     select 1 from public.staff_gates s
      where s.profile_id = p_profile_id and s.gate_id = x and s.deleted_at is null
   );
  return jsonb_build_object('profile_id', p_profile_id, 'gates', to_jsonb(ids));
end;
$$;
revoke execute on function public.set_staff_gates(uuid, text[]) from public, anon;
grant execute on function public.set_staff_gates(uuid, text[]) to authenticated;

-- ------------------------------------------------- scan_vehicle (v3: gate assignment)
create or replace function public.scan_vehicle(
  p_token text,
  p_gate_id text,
  p_idempotency_key text,
  p_scanned_at timestamptz default null,  -- only for offline replay; bounded, see below
  p_offline boolean default false          -- true when replayed from a device's offline queue
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.vehicles;
  g public.gates;
  lg public.gate_logs;
  prev public.gate_logs;
  v_time timestamptz;
  v_dir text;
  v_warn text;
  v_cooldown int;
  v_tz text;
  v_day date;
  v_max_age interval;
begin
  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,64}$' then
    raise exception 'invalid idempotency key';
  end if;

  -- 1. Replay of a request we already processed: return the original result, write nothing.
  select * into lg from public.gate_logs where idempotency_key = p_idempotency_key;
  if found then
    if lg.scanned_by <> auth.uid() and not public.is_admin() then
      raise exception 'idempotency_conflict';
    end if;
    select * into v from public.vehicles where id = lg.vehicle_id;
    select * into g from public.gates where id = lg.gate_id;
    return public._scan_payload(
      case when lg.result = 'warning' then 'warning' else 'ok' end,
      coalesce(lg.warning, 'ok'), v, g, lg.direction, lg.warning, lg.scanned_at, lg.id, true);
  end if;

  -- 2. Gate
  select * into g from public.gates where id = p_gate_id and deleted_at is null and active;
  if not found then
    return public._scan_denied('invalid_gate', null::public.vehicles, null::public.gates, p_offline);
  end if;

  -- 2b. Guards may only scan at the gates an administrator assigned to them.
  if not public.is_admin() and not exists (
    select 1 from public.staff_gates sg
     where sg.profile_id = auth.uid() and sg.gate_id = g.id and sg.deleted_at is null
  ) then
    return public._scan_denied('invalid_gate', null::public.vehicles, g, p_offline);
  end if;

  -- 3. Vehicle by token
  select * into v from public.vehicles where token = p_token and deleted_at is null;
  if not found then
    return public._scan_denied('unregistered', null::public.vehicles, g, p_offline);
  end if;

  -- 4. Serialize all scans of this vehicle, then re-read it under the lock.
  perform pg_advisory_xact_lock(hashtextextended(v.id, 0));
  select * into v from public.vehicles where id = v.id;
  if v.deleted_at is not null or v.token is distinct from p_token then
    return public._scan_denied('unregistered', null::public.vehicles, g, p_offline);
  end if;

  if v.status <> 'approved' then
    return public._scan_denied(v.status, v, g, p_offline);   -- pending | rejected | blocked
  end if;

  -- 5. Effective time. A client-supplied time (offline replay) is accepted only inside a bounded
  --    window (setting offline_max_age_hours, default 72); otherwise the server clock is used.
  v_max_age := make_interval(hours => coalesce(public._setting_text('offline_max_age_hours')::int, 72));
  v_time := case
    when p_scanned_at is not null
         and p_scanned_at between clock_timestamp() - v_max_age
                              and clock_timestamp() + interval '2 minutes'
    then p_scanned_at
    else clock_timestamp()
  end;

  -- 6. Validity window (in the site's timezone), evaluated at the time of the scan
  v_tz := coalesce(public._setting_text('timezone'), 'Asia/Manila');
  v_day := (v_time at time zone v_tz)::date;
  if v.valid_to is not null and v.valid_to < v_day then
    return public._scan_denied('expired', v, g, p_offline);
  end if;
  if v.valid_from is not null and v.valid_from > v_day then
    return public._scan_denied('not_yet_valid', v, g, p_offline);
  end if;

  -- 7. Previous movement, cooldown
  select * into prev from public.gate_logs
   where vehicle_id = v.id and deleted_at is null and scanned_at <= v_time
   order by scanned_at desc limit 1;

  v_cooldown := coalesce(public._setting_text('cooldown_seconds')::int, 5);
  if prev.id is not null and extract(epoch from (v_time - prev.scanned_at)) < v_cooldown then
    return public._scan_payload('duplicate', 'cooldown', v, g, prev.direction, null,
                                prev.scanned_at, prev.id);
  end if;

  -- 8. Direction and anti-passback
  if g.direction_mode = 'in' then
    v_dir := 'IN';
    if prev.id is not null and prev.direction = 'IN' then v_warn := 'double_in'; end if;
  elsif g.direction_mode = 'out' then
    v_dir := 'OUT';
    if prev.id is null then v_warn := 'no_entry_record';
    elsif prev.direction = 'OUT' then v_warn := 'double_out';
    end if;
  else
    v_dir := case when prev.id is not null and prev.direction = 'IN' then 'OUT' else 'IN' end;
  end if;

  if v_warn is not null and coalesce(public._setting_text('anti_passback_mode'), 'warn') = 'block' then
    return public._scan_denied(v_warn, v, g, p_offline);
  end if;

  -- 9. Record the movement (the unique idempotency key guards against concurrent duplicates)
  begin
    insert into public.gate_logs (
      vehicle_id, gate_id, direction, result, warning, scanned_by, scanned_at,
      idempotency_key, created_by, source
    ) values (
      v.id, g.id, v_dir, case when v_warn is null then 'ok' else 'warning' end, v_warn,
      auth.uid(), v_time, p_idempotency_key, auth.uid(),
      case when p_offline then 'offline' else 'online' end
    ) returning * into lg;
  exception when unique_violation then
    select * into lg from public.gate_logs where idempotency_key = p_idempotency_key;
    if not found then raise; end if;
    return public._scan_payload(
      case when lg.result = 'warning' then 'warning' else 'ok' end,
      coalesce(lg.warning, 'ok'), v, g, lg.direction, lg.warning, lg.scanned_at, lg.id, true);
  end;

  return public._scan_payload(
    case when v_warn is null then 'ok' else 'warning' end,
    coalesce(v_warn, 'ok'), v, g, v_dir, v_warn, v_time, lg.id);
end;
$$;

revoke execute on function public.scan_vehicle(text, text, text, timestamptz, boolean)
  from public, anon;
grant execute on function public.scan_vehicle(text, text, text, timestamptz, boolean)
  to authenticated, service_role;
