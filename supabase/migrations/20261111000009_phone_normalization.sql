-- Migration 9: treat the common Philippine mobile formats as the same number.
--   +63 912 345 6789  ->  9123456789
--   0912 345 6789     ->  9123456789
--   912 345 6789      ->  9123456789
-- Other numbers are just stripped to digits, as before. Used for registration matching,
-- "Find my QR" recovery and admin search.

create or replace function public.norm_phone(p text)
returns text
language sql
immutable
as $$
  select case
    when d ~ '^63[0-9]{10}$' then substr(d, 3)
    when d ~ '^0[0-9]{10}$' then substr(d, 2)
    else d
  end
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) s
$$;

-- Re-normalise existing rows without flooding the audit trail with no-op "updates".
alter table public.vehicles disable trigger trg_vehicles_audit;
update public.vehicles set phone_norm = public.norm_phone(phone)
 where phone_norm is distinct from public.norm_phone(phone);
alter table public.vehicles enable trigger trg_vehicles_audit;
