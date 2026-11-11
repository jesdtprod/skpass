create temp table res (n serial, name text, got text, expect text, pass boolean);
grant all on res to public;
grant usage, select on sequence res_n_seq to public;

create or replace function pg_temp.chk(p_name text, p_q text, p_expect text)
returns void language plpgsql as $$
declare r text;
begin
  begin
    execute p_q into r;
  exception when others then
    r := 'ERR: ' || sqlerrm;
  end;
  insert into res (name, got, expect, pass)
  values (p_name, r, p_expect, r ilike p_expect);
end;
$$;

do $$
declare
  adm uuid;
  grd uuid := gen_random_uuid();
  veh_pending text;
  veh_emp text;
  tok1 text;
  out text;
begin
  select id into adm from public.profiles where role = 'admin' limit 1;
  select id into veh_pending from public.vehicles where plate = 'SMP-4004';
  select id into veh_emp from public.vehicles where plate = 'SMP-1001';

  -- temp guard (rolled back at the end)
  insert into auth.users (id, email, aud, role) values (grd, 'guard-test@example.invalid', 'authenticated', 'authenticated');
  insert into public.profiles (id, full_name, role) values (grd, 'Test Guard', 'guard');

  ---------------------------------------------------------------- ANON
  set local role anon;
  perform pg_temp.chk('anon: select vehicles denied', 'select count(*)::text from public.vehicles', 'ERR:%permission denied%');
  perform pg_temp.chk('anon: select gates denied', 'select count(*)::text from public.gates', 'ERR:%permission denied%');
  perform pg_temp.chk('anon: select gate_logs denied', 'select count(*)::text from public.gate_logs', 'ERR:%permission denied%');
  perform pg_temp.chk('anon: rpc approve denied', format('select public.approve_vehicle(%L)::text', veh_pending), 'ERR:%permission denied%');
  perform pg_temp.chk('anon: rpc admin_create denied', 'select public.admin_create_vehicle(''{}'')::text', 'ERR:%permission denied%');
  reset role;

  ---------------------------------------------------------------- GUARD
  insert into public.staff_gates (profile_id, gate_id) select grd, id from public.gates where deleted_at is null and active limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', grd, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', grd::text, true);
  set local role authenticated;
  perform pg_temp.chk('guard: vehicles invisible', 'select count(*)::text from public.vehicles', '0');
  perform pg_temp.chk('guard: sees only the one gate assigned to them', 'select count(*)::text from public.gates', '1');
  perform pg_temp.chk('guard: sees only public settings', 'select count(*)::text from public.settings', '3');
  perform pg_temp.chk('guard: audit_logs invisible', 'select count(*)::text from public.audit_logs', '0');
  perform pg_temp.chk('guard: sees only own profile', 'select count(*)::text from public.profiles', '1');
  perform pg_temp.chk('guard: gate update affects 0 rows', 'with u as (update public.gates set name = ''x'' returning 1) select count(*)::text from u', '0');
  perform pg_temp.chk('guard: cannot insert vehicle', 'insert into public.vehicles (category, plate, owner_name, phone, vehicle_type) values (''employee'', ''ZZ-1'', ''x'', ''1'', ''car'')', 'ERR:%row-level security%');
  perform pg_temp.chk('guard: cannot insert gate_logs', 'insert into public.gate_logs (vehicle_id, gate_id, direction, scanned_by, idempotency_key) values (''a'', ''b'', ''IN'', ''00000000-0000-0000-0000-000000000000'', ''k'')', 'ERR:%permission denied%');
  perform pg_temp.chk('guard: rpc approve forbidden', format('select public.approve_vehicle(%L)::text', veh_pending), 'ERR:%forbidden%');
  perform pg_temp.chk('guard: rpc soft_delete forbidden', format('select public.soft_delete(''vehicles'', %L)::text', veh_emp), 'ERR:%forbidden%');
  perform pg_temp.chk('guard: inside view empty', 'select count(*)::text from public.v_vehicles_inside', '0');
  reset role;

  ---------------------------------------------------------------- ADMIN
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', adm::text, true);
  set local role authenticated;
  perform pg_temp.chk('admin: sees 4 vehicles', 'select count(*)::text from public.vehicles', '4');
  perform pg_temp.chk('admin: sees 2 gates', 'select count(*)::text from public.gates', '2');
  perform pg_temp.chk('admin: sees all 5 settings', 'select count(*)::text from public.settings', '5');
  perform pg_temp.chk('admin: sees audit rows', 'select (count(*) >= 7)::text from public.audit_logs', 'true');
  perform pg_temp.chk('admin: audit has no token or claim_hash', 'select count(*)::text from public.audit_logs where after ? ''token'' or after ? ''claim_hash''', '0');
  perform pg_temp.chk('admin: approve pending issues token', format('select (public.approve_vehicle(%L) ->> ''token'') is not null', veh_pending), 'true');
  perform pg_temp.chk('admin: approve again -> invalid_state', format('select public.approve_vehicle(%L)::text', veh_pending), 'ERR:%invalid_state%');
  perform pg_temp.chk('admin: reject approved -> refused', format('select public.reject_vehicle(%L, ''x'')::text', veh_pending), 'ERR:%not_found_or_not_pending%');
  perform pg_temp.chk('admin: block needs reason', format('select public.block_vehicle(%L, '' '')::text', veh_emp), 'ERR:%reason is required%');
  perform pg_temp.chk('admin: block ok', format('select public.block_vehicle(%L, ''test'') ->> ''status''', veh_emp), 'blocked');
  perform pg_temp.chk('admin: unblock ok', format('select public.unblock_vehicle(%L) ->> ''status''', veh_emp), 'approved');
  select token into tok1 from public.vehicles where id = veh_emp;
  perform pg_temp.chk('admin: reissue changes token', format('select ((public.reissue_token(%L) ->> ''token'') <> %L)::text', veh_emp, tok1), 'true');
  perform pg_temp.chk('admin: visitor over max days refused', 'select public.admin_create_vehicle(''{"category":"visitor","plate":"V-1","owner_name":"v","phone":"1","vehicle_type":"car","valid_from":"2026-11-11","valid_to":"2027-03-01"}'')::text', 'ERR:%longer than%');
  perform pg_temp.chk('admin: visitor w/o dates refused', 'select public.admin_create_vehicle(''{"category":"visitor","plate":"V-2","owner_name":"v","phone":"1","vehicle_type":"car"}'')::text', 'ERR:%');
  perform pg_temp.chk('admin: create pass ok', 'select public.admin_create_vehicle(''{"category":"visitor","plate":"V-3","owner_name":"v","phone":"1","vehicle_type":"car","valid_from":"2026-11-11","valid_to":"2026-11-12","idempotency_key":"idem-1"}'') ->> ''replayed''', 'false');
  perform pg_temp.chk('admin: create pass replay is idempotent', 'select public.admin_create_vehicle(''{"category":"visitor","plate":"V-3","owner_name":"v","phone":"1","vehicle_type":"car","valid_from":"2026-11-11","valid_to":"2026-11-12","idempotency_key":"idem-1"}'') ->> ''replayed''', 'true');
  perform pg_temp.chk('admin: duplicate active plate refused', 'select public.admin_create_vehicle(''{"category":"employee","plate":"smp 1001","owner_name":"v","phone":"1","vehicle_type":"car"}'')::text', 'ERR:%duplicate key%');
  perform pg_temp.chk('admin: hard DELETE denied', 'with d as (delete from public.vehicles returning 1) select count(*)::text from d', 'ERR:%permission denied%');
  perform pg_temp.chk('admin: direct soft-delete blocked by RLS', format('update public.vehicles set deleted_at = now() where id = %L', veh_emp), 'ERR:%row-level security%');
  perform pg_temp.chk('admin: soft_delete via RPC works', format('select public.soft_delete(''vehicles'', %L)::text', veh_emp), '');
  perform pg_temp.chk('admin: soft-deleted vehicle hidden', format('select count(*)::text from public.vehicles where id = %L', veh_emp), '0');
  perform pg_temp.chk('admin: audit_logs not writable', 'with u as (update public.audit_logs set action = ''x'' returning 1) select count(*)::text from u', 'ERR:%permission denied%');
  reset role;

  ------------------------------------------------- as table owner (constraints)
  perform pg_temp.chk('db: audit_logs append-only trigger', 'with u as (update public.audit_logs set action = ''x'' returning 1) select count(*)::text from u', 'ERR:%append-only%');
  perform pg_temp.chk('db: visitor needs dates (check)', 'insert into public.vehicles (category, plate, owner_name, phone, vehicle_type) values (''visitor'', ''Q-1'', ''x'', ''1'', ''car'')', 'ERR:%vehicles_visitor_dates%');
  perform pg_temp.chk('db: approved needs token (check)', 'insert into public.vehicles (category, status, plate, owner_name, phone, vehicle_type) values (''employee'', ''approved'', ''Q-2'', ''x'', ''1'', ''car'')', 'ERR:%vehicles_approved_has_token%');
  perform pg_temp.chk('db: normalized columns filled', 'select plate_norm || ''/'' || phone_norm from public.vehicles where plate = ''SMP-3003''', 'SMP3003/09170000003');

  select string_agg(format('FAIL [%s] %s -> got: %s', n, name, left(got, 90)), ' ;; ' order by n)
    filter (where not pass) into out from res;
  raise exception E'RESULTS (rolled back) % PASS=% FAIL=%', coalesce(out, 'no failures'),
    (select count(*) from res where pass), (select count(*) from res where not pass);
end;
$$;
