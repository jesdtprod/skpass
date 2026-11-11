-- Migration 4: admin RPCs. All are SECURITY DEFINER and refuse non-admins.
-- Row changes are audited by the triggers from migration 3 (auth.uid() = the calling admin).

create or replace function public._require_admin()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end;
$$;

-- Approve a pending (or previously rejected) vehicle and issue its QR token.
create or replace function public.approve_vehicle(
  p_vehicle_id text,
  p_valid_from date default null,
  p_valid_to date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.vehicles;
  max_days int;
begin
  perform public._require_admin();
  select * into v from public.vehicles where id = p_vehicle_id and deleted_at is null for update;
  if not found then raise exception 'not_found'; end if;
  if v.status not in ('pending', 'rejected') then
    raise exception 'invalid_state: cannot approve a % vehicle', v.status;
  end if;

  v.valid_from := coalesce(p_valid_from, v.valid_from);
  v.valid_to := coalesce(p_valid_to, v.valid_to);

  if v.category = 'visitor' then
    select (value #>> '{}')::int into max_days from public.settings
      where key = 'visitor_max_days' and deleted_at is null;
    if v.valid_from is null or v.valid_to is null then
      raise exception 'visitor passes need valid_from and valid_to';
    end if;
    if max_days is not null and (v.valid_to - v.valid_from) > max_days then
      raise exception 'visitor pass longer than % days', max_days;
    end if;
  end if;

  update public.vehicles
     set status = 'approved',
         token = coalesce(token, public.gen_token()),
         valid_from = v.valid_from,
         valid_to = v.valid_to,
         approved_by = auth.uid(),
         approved_at = now(),
         reject_reason = null
   where id = p_vehicle_id
   returning * into v;

  return jsonb_build_object('id', v.id, 'status', v.status, 'token', v.token);
end;
$$;

create or replace function public.reject_vehicle(p_vehicle_id text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v public.vehicles;
begin
  perform public._require_admin();
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a reason is required';
  end if;
  update public.vehicles
     set status = 'rejected', reject_reason = btrim(p_reason), token = null
   where id = p_vehicle_id and deleted_at is null and status = 'pending'
   returning * into v;
  if not found then raise exception 'not_found_or_not_pending'; end if;
  return jsonb_build_object('id', v.id, 'status', v.status);
end;
$$;

create or replace function public.block_vehicle(p_vehicle_id text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v public.vehicles;
begin
  perform public._require_admin();
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a reason is required';
  end if;
  update public.vehicles
     set status = 'blocked', blocked_reason = btrim(p_reason)
   where id = p_vehicle_id and deleted_at is null and status = 'approved'
   returning * into v;
  if not found then raise exception 'not_found_or_not_approved'; end if;
  return jsonb_build_object('id', v.id, 'status', v.status);
end;
$$;

create or replace function public.unblock_vehicle(p_vehicle_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v public.vehicles;
begin
  perform public._require_admin();
  update public.vehicles
     set status = 'approved', blocked_reason = null
   where id = p_vehicle_id and deleted_at is null and status = 'blocked'
   returning * into v;
  if not found then raise exception 'not_found_or_not_blocked'; end if;
  return jsonb_build_object('id', v.id, 'status', v.status);
end;
$$;

-- New token; the old QR stops working immediately.
create or replace function public.reissue_token(p_vehicle_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v public.vehicles;
begin
  perform public._require_admin();
  update public.vehicles
     set token = public.gen_token()
   where id = p_vehicle_id and deleted_at is null and status in ('approved', 'blocked')
   returning * into v;
  if not found then raise exception 'not_found_or_no_token'; end if;
  return jsonb_build_object('id', v.id, 'status', v.status, 'token', v.token);
end;
$$;

-- Admin-created, pre-approved pass (e.g. visitor or event pass). Idempotent on p->>'idempotency_key'.
create or replace function public.admin_create_vehicle(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.vehicles;
  idem text := nullif(p ->> 'idempotency_key', '');
  max_days int;
begin
  perform public._require_admin();

  if idem is not null then
    select * into v from public.vehicles where idempotency_key = idem;
    if found then
      return jsonb_build_object('id', v.id, 'status', v.status, 'token', v.token, 'replayed', true);
    end if;
  end if;

  if (p ->> 'category') = 'visitor' then
    select (value #>> '{}')::int into max_days from public.settings
      where key = 'visitor_max_days' and deleted_at is null;
    if max_days is not null
       and ((p ->> 'valid_to')::date - (p ->> 'valid_from')::date) > max_days then
      raise exception 'visitor pass longer than % days', max_days;
    end if;
  end if;

  insert into public.vehicles (
    category, status, token, plate, owner_name, phone, vehicle_type, color,
    valid_from, valid_to, office, id_number, position, agency, host_name, purpose,
    registered_via, approved_by, approved_at, idempotency_key, created_by
  ) values (
    p ->> 'category', 'approved', public.gen_token(), p ->> 'plate', p ->> 'owner_name',
    p ->> 'phone', p ->> 'vehicle_type', p ->> 'color',
    (p ->> 'valid_from')::date, (p ->> 'valid_to')::date,
    p ->> 'office', p ->> 'id_number', p ->> 'position', p ->> 'agency',
    p ->> 'host_name', p ->> 'purpose',
    'admin', auth.uid(), now(), idem, auth.uid()
  )
  returning * into v;

  return jsonb_build_object('id', v.id, 'status', v.status, 'token', v.token, 'replayed', false);
end;
$$;

-- Soft delete (the only way to "delete"). Whitelisted tables only.
create or replace function public.soft_delete(p_table text, p_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if p_table not in ('vehicles', 'gates') then
    raise exception 'soft_delete not allowed on %', p_table;
  end if;
  execute format(
    'update public.%I set deleted_at = now() where id = $1 and deleted_at is null', p_table
  ) using p_id;
  if not found then raise exception 'not_found'; end if;
end;
$$;

-- Privileges: signed-in users only (each function re-checks admin inside).
revoke execute on function
  public._require_admin(), public.approve_vehicle(text, date, date),
  public.reject_vehicle(text, text), public.block_vehicle(text, text),
  public.unblock_vehicle(text), public.reissue_token(text),
  public.admin_create_vehicle(jsonb), public.soft_delete(text, text)
from public, anon;
grant execute on function
  public._require_admin(), public.approve_vehicle(text, date, date),
  public.reject_vehicle(text, text), public.block_vehicle(text, text),
  public.unblock_vehicle(text), public.reissue_token(text),
  public.admin_create_vehicle(jsonb), public.soft_delete(text, text)
to authenticated, service_role;
