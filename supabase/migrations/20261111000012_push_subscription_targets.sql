-- Migration 12: one browser may follow SEVERAL vehicles (an owner with two registrations on one
-- phone) and one admin per browser. Uniqueness is therefore (endpoint, audience, target), not
-- just the endpoint.

drop index if exists public.push_subscriptions_endpoint_key;

create unique index push_subscriptions_target_key on public.push_subscriptions
  (endpoint, audience, (coalesce(vehicle_id, user_id::text)))
  where deleted_at is null;
