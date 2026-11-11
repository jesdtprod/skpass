-- Sample DEV data only (no personal data). Safe to re-run.
-- The admin/guard profiles are created separately (seed.local.sql, gitignored) because
-- they need real Auth users and real emails.

insert into public.gates (code, name)
select v.code, v.name
from (values ('G1', 'Main Gate'), ('G2', 'Back Gate')) as v (code, name)
where not exists (
  select 1 from public.gates g where lower(g.code) = lower(v.code) and g.deleted_at is null
);

insert into public.vehicles (
  category, status, token, plate, owner_name, phone, vehicle_type, color,
  valid_from, valid_to, office, position, agency, host_name, purpose,
  registered_via, approved_at
)
select * from (values
  ('employee', 'approved', public.gen_token(), 'SMP-1001', 'Sample Employee', '09170000001',
   'car', 'white', null::date, null::date, 'Records Office', null, null, null, null,
   'admin', now()),
  ('official', 'approved', public.gen_token(), 'SMP-2002', 'Sample Official', '09170000002',
   'suv', 'black', null, null, null, 'Director', 'Sample Agency', null, null,
   'admin', now()),
  ('visitor', 'approved', public.gen_token(), 'SMP-3003', 'Sample Visitor', '09170000003',
   'motorcycle', 'red', current_date, current_date + 7, null, null, null,
   'Sample Employee', 'Meeting', 'admin', now()),
  ('employee', 'pending', null, 'SMP-4004', 'Pending Employee', '09170000004',
   'car', 'blue', null, null, 'Budget Office', null, null, null, null,
   'public', null)
) as v (category, status, token, plate, owner_name, phone, vehicle_type, color,
        valid_from, valid_to, office, position, agency, host_name, purpose,
        registered_via, approved_at)
where not exists (
  select 1 from public.vehicles x
  where x.plate_norm = public.norm_plate(v.plate) and x.deleted_at is null
);
