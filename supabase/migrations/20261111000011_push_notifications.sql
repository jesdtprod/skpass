-- Migration 11: live updates + Web Push.
--  * Realtime on vehicles so an open admin dashboard learns about new registrations instantly.
--    (Realtime honours RLS: only admins, who may read vehicles, receive these events.)
--  * push_subscriptions: browser push endpoints for admins and for vehicle owners.
--    Written and read ONLY by Edge Functions (service role). No client can list endpoints.

alter publication supabase_realtime add table public.vehicles;

create table public.push_subscriptions (
  id               text primary key default public.gen_ulid(),
  endpoint         text not null,
  p256dh           text not null,
  auth             text not null,
  audience         text not null check (audience in ('admin', 'owner')),
  user_id          uuid references public.profiles (id),   -- admins
  vehicle_id       text references public.vehicles (id),   -- owners
  user_agent       text,
  last_success_at  timestamptz,
  fail_count       int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  created_by       uuid,
  constraint push_audience_target check (
    (audience = 'admin' and user_id is not null and vehicle_id is null)
    or (audience = 'owner' and vehicle_id is not null and user_id is null)
  )
);

-- One row per browser endpoint (re-subscribing replaces it).
create unique index push_subscriptions_endpoint_key on public.push_subscriptions (endpoint)
  where deleted_at is null;
create index push_subscriptions_admin_idx on public.push_subscriptions (audience)
  where deleted_at is null;
create index push_subscriptions_vehicle_idx on public.push_subscriptions (vehicle_id)
  where deleted_at is null;

create trigger trg_push_subscriptions_updated_at before update on public.push_subscriptions
  for each row execute function public.set_updated_at();

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
-- no policies and no grants: service role (Edge Functions) only.
