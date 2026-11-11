-- Migration 7: scan logic.
-- scan_vehicle() decides IN/OUT inside one transaction, serialized per vehicle by an advisory lock.
-- Gates get a direction_mode so anti-passback (double IN / double OUT) is meaningful:
--   'both' = auto toggle, 'in' = entry-only lane, 'out' = exit-only lane.

alter table public.gates
  add column direction_mode text not null default 'both'
  check (direction_mode in ('both', 'in', 'out'));

insert into public.settings (key, value, is_public)
values ('timezone', '"Asia/Manila"', true)
on conflict (key) do nothing;

-- ------------------------------------------------------------------ helpers
create or replace function public._setting_text(p_key text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select value #>> '{}' from public.settings where key = p_key and deleted_at is null
$$;

create or replace function public._scan_message(p_code text, p_result text, p_dir text)
returns text
language sql
immutable
as $$
  select case p_code
    when 'ok' then case p_dir when 'IN' then 'Entry recorded' else 'Exit recorded' end
    when 'cooldown' then 'Already scanned a moment ago'
    when 'double_in' then case p_result when 'warning'
      then 'Entry recorded, but the vehicle was already inside' else 'Vehicle is already inside' end
    when 'double_out' then case p_result when 'warning'
      then 'Exit recorded, but the vehicle was already outside' else 'Vehicle is already outside' end
    when 'no_entry_record' then case p_result when 'warning'
      then 'Exit recorded, but no entry was found' else 'No entry record for this vehicle' end
    when 'unregistered' then 'QR code not recognised'
    when 'invalid_gate' then 'This gate is not available'
    when 'pending' then 'Registration not approved yet'
    when 'rejected' then 'Registration was rejected'
    when 'blocked' then 'Vehicle is blocked'
    when 'expired' then 'Pass has expired'
    when 'not_yet_valid' then 'Pass is not valid yet'
    else 'Not allowed'
  end
$$;

-- The guard's result screen. Deliberately excludes phone and claim data.
create or replace function public._scan_payload(
  p_result text, p_code text, p_vehicle public.vehicles, p_gate public.gates,
  p_direction text, p_warning text, p_scanned_at timestamptz, p_log_id text,
  p_replayed boolean default false
)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'result', p_result,
    'code', p_code,
    'message', public._scan_message(p_code, p_result, p_direction),
    'direction', p_direction,
    'warning', p_warning,
    'scanned_at', p_scanned_at,
    'log_id', p_log_id,
    'replayed', p_replayed,
    'gate', case when p_gate.id is null then null else jsonb_build_object(
      'id', p_gate.id, 'code', p_gate.code, 'name', p_gate.name) end,
    'vehicle', case when p_vehicle.id is null then null else jsonb_build_object(
      'id', p_vehicle.id, 'plate', p_vehicle.plate, 'owner_name', p_vehicle.owner_name,
      'category', p_vehicle.category, 'vehicle_type', p_vehicle.vehicle_type,
      'color', p_vehicle.color, 'photo_path', p_vehicle.photo_path,
      'host_name', p_vehicle.host_name, 'valid_from', p_vehicle.valid_from,
      'valid_to', p_vehicle.valid_to) end
  )
$$;

-- Denied scans are not gate_logs rows (nothing passed); they go to the audit trail.
create or replace function public._scan_denied(
  p_code text, p_vehicle public.vehicles, p_gate public.gates
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs (actor_id, action, entity, entity_id, after)
  values (
    auth.uid(), 'scan_denied',
    case when p_vehicle.id is null then 'scan' else 'vehicles' end,
    p_vehicle.id,
    jsonb_build_object('code', p_code, 'gate_id', p_gate.id)
  );
  return public._scan_payload('denied', p_code, p_vehicle, p_gate, null, null, null, null);
end;
$$;

-- ---------------------------------------------------------------- scan_vehicle
create or replace function public.scan_vehicle(
  p_token text,
  p_gate_id text,
  p_idempotency_key text,
  p_scanned_at timestamptz default null   -- only for offline replay; bounded, see below
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
    return public._scan_denied('invalid_gate', null::public.vehicles, null::public.gates);
  end if;

  -- 3. Vehicle by token
  select * into v from public.vehicles where token = p_token and deleted_at is null;
  if not found then
    return public._scan_denied('unregistered', null::public.vehicles, g);
  end if;

  -- 4. Serialize all scans of this vehicle, then re-read it under the lock.
  perform pg_advisory_xact_lock(hashtextextended(v.id, 0));
  select * into v from public.vehicles where id = v.id;
  if v.deleted_at is not null or v.token is distinct from p_token then
    return public._scan_denied('unregistered', null::public.vehicles, g);
  end if;

  if v.status <> 'approved' then
    return public._scan_denied(v.status, v, g);   -- pending | rejected | blocked
  end if;

  -- 5. Effective time. A client-supplied time (offline replay) is accepted only within a
  --    bounded window; otherwise the server clock is used.
  v_time := case
    when p_scanned_at is not null
         and p_scanned_at between clock_timestamp() - interval '3 days'
                              and clock_timestamp() + interval '2 minutes'
    then p_scanned_at
    else clock_timestamp()
  end;

  -- 6. Validity window (in the site's timezone)
  v_tz := coalesce(public._setting_text('timezone'), 'Asia/Manila');
  v_day := (v_time at time zone v_tz)::date;
  if v.valid_to is not null and v.valid_to < v_day then
    return public._scan_denied('expired', v, g);
  end if;
  if v.valid_from is not null and v.valid_from > v_day then
    return public._scan_denied('not_yet_valid', v, g);
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
    return public._scan_denied(v_warn, v, g);
  end if;

  -- 9. Record the movement (the unique idempotency key guards against concurrent duplicates)
  begin
    insert into public.gate_logs (
      vehicle_id, gate_id, direction, result, warning, scanned_by, scanned_at,
      idempotency_key, created_by
    ) values (
      v.id, g.id, v_dir, case when v_warn is null then 'ok' else 'warning' end, v_warn,
      auth.uid(), v_time, p_idempotency_key, auth.uid()
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

-- Privileges: signed-in staff only; internal helpers are not callable by clients.
revoke execute on function
  public._setting_text(text), public._scan_message(text, text, text),
  public._scan_payload(text, text, public.vehicles, public.gates, text, text, timestamptz, text, boolean),
  public._scan_denied(text, public.vehicles, public.gates),
  public.scan_vehicle(text, text, text, timestamptz)
from public, anon, authenticated;
grant execute on function public.scan_vehicle(text, text, text, timestamptz)
  to authenticated, service_role;
grant execute on function
  public._setting_text(text), public._scan_message(text, text, text),
  public._scan_payload(text, text, public.vehicles, public.gates, text, text, timestamptz, text, boolean),
  public._scan_denied(text, public.vehicles, public.gates)
to service_role;
