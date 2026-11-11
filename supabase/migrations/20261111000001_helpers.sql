-- Migration 1: extensions and reusable helper functions (project-agnostic).

create extension if not exists pgcrypto with schema extensions;

-- ULID: 48-bit ms timestamp + 80 random bits, Crockford base32, 26 chars, sortable.
create or replace function public.gen_ulid()
returns text
language plpgsql
volatile
set search_path = public, extensions
as $$
declare
  encoding constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  ts bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  rnd bytea := gen_random_bytes(10);
  out text := '';
  v int;
  i int;
  j int;
begin
  for i in 1..10 loop
    out := substr(encoding, (ts % 32)::int + 1, 1) || out;
    ts := ts / 32;
  end loop;
  for i in 0..15 loop
    v := 0;
    for j in 0..4 loop
      v := v * 2 + get_bit(rnd, i * 5 + j);
    end loop;
    out := out || substr(encoding, v + 1, 1);
  end loop;
  return out;
end;
$$;

-- Random 128-bit URL-safe token (used as the QR payload).
create or replace function public.gen_token()
returns text
language sql
volatile
set search_path = public, extensions
as $$
  select translate(rtrim(encode(gen_random_bytes(16), 'base64'), '='), '+/', '-_');
$$;

-- Generic updated_at trigger function.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Normalizers used for matching plates and phone numbers.
create or replace function public.norm_plate(p text)
returns text
language sql
immutable
as $$
  select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

create or replace function public.norm_phone(p text)
returns text
language sql
immutable
as $$
  select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g');
$$;
