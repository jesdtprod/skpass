-- Migration 2: tables, constraints, indexes, triggers, view, default settings.
-- Conventions: ULID text PK (profiles uses the auth uuid), created_at / updated_at /
-- deleted_at on every table. RLS is enabled here (deny by default); policies come in migration 3.

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null,
  role        text not null check (role in ('admin', 'guard')),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  created_by  uuid
);

-- ---------------------------------------------------------------- vehicles
create table public.vehicles (
  id               text primary key default public.gen_ulid(),
  category         text not null check (category in ('employee', 'official', 'visitor')),
  status           text not null default 'pending'
                   check (status in ('pending', 'approved', 'rejected', 'blocked')),
  token            text,
  plate            text not null,
  plate_norm       text not null,
  owner_name       text not null,
  phone            text not null,
  phone_norm       text not null,
  vehicle_type     text not null,
  color            text,
  photo_path       text,
  valid_from       date,
  valid_to         date,
  -- category-specific details
  office           text,
  id_number        text,
  position         text,
  agency           text,
  host_name        text,
  purpose          text,
  -- registration / approval workflow
  claim_hash       text,
  registered_via   text not null default 'public' check (registered_via in ('public', 'admin')),
  reject_reason    text,
  blocked_reason   text,
  approved_by      uuid references public.profiles (id),
  approved_at      timestamptz,
  idempotency_key  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  created_by       uuid,
  constraint vehicles_visitor_dates check (
    category <> 'visitor'
    or (valid_from is not null and valid_to is not null and valid_to >= valid_from)
  ),
  constraint vehicles_date_order check (
    valid_from is null or valid_to is null or valid_to >= valid_from
  ),
  constraint vehicles_approved_has_token check (status <> 'approved' or token is not null)
);

create unique index vehicles_token_key on public.vehicles (token) where token is not null;
create unique index vehicles_idem_key on public.vehicles (idempotency_key)
  where idempotency_key is not null;
create unique index vehicles_active_plate_key on public.vehicles (plate_norm)
  where deleted_at is null and status in ('pending', 'approved', 'blocked');
create index vehicles_recovery_idx on public.vehicles (plate_norm, phone_norm);
create index vehicles_status_idx on public.vehicles (status) where deleted_at is null;

-- Keep the normalized columns in sync with the raw ones.
create or replace function public.vehicles_normalize()
returns trigger
language plpgsql
as $$
begin
  new.plate_norm := public.norm_plate(new.plate);
  new.phone_norm := public.norm_phone(new.phone);
  return new;
end;
$$;

create trigger trg_vehicles_normalize
  before insert or update of plate, phone on public.vehicles
  for each row execute function public.vehicles_normalize();

-- ------------------------------------------------------------------- gates
create table public.gates (
  id          text primary key default public.gen_ulid(),
  code        text not null,
  name        text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  created_by  uuid
);

create unique index gates_code_key on public.gates (lower(code)) where deleted_at is null;

-- ---------------------------------------------------------------- gate_logs
create table public.gate_logs (
  id               text primary key default public.gen_ulid(),
  vehicle_id       text not null references public.vehicles (id),
  gate_id          text not null references public.gates (id),
  direction        text not null check (direction in ('IN', 'OUT')),
  result           text not null default 'ok' check (result in ('ok', 'warning')),
  warning          text,
  scanned_by       uuid not null references public.profiles (id),
  scanned_at       timestamptz not null default now(),
  idempotency_key  text not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  created_by       uuid,
  constraint gate_logs_idem_key unique (idempotency_key)
);

create index gate_logs_vehicle_idx on public.gate_logs (vehicle_id, scanned_at desc);
create index gate_logs_gate_idx on public.gate_logs (gate_id, scanned_at desc);
create index gate_logs_time_idx on public.gate_logs (scanned_at desc);

-- ---------------------------------------------------------------- settings
create table public.settings (
  id          text primary key default public.gen_ulid(),
  key         text not null unique,
  value       jsonb not null,
  is_public   boolean not null default false,  -- readable by guards
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  created_by  uuid
);

insert into public.settings (key, value, is_public) values
  ('org_name', '"Provincial Government"', true),
  ('cooldown_seconds', '5', true),
  ('anti_passback_mode', '"warn"', true),       -- 'warn' | 'block'
  ('visitor_max_days', '30', false),
  ('log_retention_days', '365', false)
on conflict (key) do nothing;

-- -------------------------------------------------------------- audit_logs
create table public.audit_logs (
  id          text primary key default public.gen_ulid(),
  actor_id    uuid,
  action      text not null,
  entity      text not null,
  entity_id   text,
  before      jsonb,
  after       jsonb,
  ip          text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  created_by  uuid
);

create index audit_logs_entity_idx on public.audit_logs (entity, entity_id, created_at desc);
create index audit_logs_time_idx on public.audit_logs (created_at desc);

-- ------------------------------------------------------------- rate_limits
create table public.rate_limits (
  id            text primary key default public.gen_ulid(),
  key           text not null,
  window_start  timestamptz not null,
  count         int not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  created_by    uuid,
  constraint rate_limits_key_window unique (key, window_start)
);

-- -------------------------------------------------- updated_at triggers + RLS
do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'vehicles', 'gates', 'gate_logs', 'settings', 'audit_logs', 'rate_limits'
  ] loop
    execute format(
      'create trigger trg_%1$s_updated_at before update on public.%1$s
         for each row execute function public.set_updated_at()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- ------------------------------------------------- currently inside (derived)
create view public.v_vehicles_inside
with (security_invoker = true) as
select
  v.id            as vehicle_id,
  v.plate,
  v.owner_name,
  v.category,
  v.vehicle_type,
  v.color,
  v.photo_path,
  l.gate_id,
  l.scanned_at    as entered_at
from public.vehicles v
join lateral (
  select gl.gate_id, gl.direction, gl.scanned_at
  from public.gate_logs gl
  where gl.vehicle_id = v.id and gl.deleted_at is null
  order by gl.scanned_at desc
  limit 1
) l on true
where v.deleted_at is null and l.direction = 'IN';

revoke all on public.v_vehicles_inside from anon;
