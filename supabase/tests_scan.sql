-- Scan logic tests. Runs inside one transaction that ALWAYS rolls back (it ends by raising).
-- Run:  npx supabase db query --remote --yes -f supabase/tests_scan.sql
-- Expect the final error message to read "no failures".

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
  g1 text; g_in text; g_out text;
  veh text; tok text;      -- SMP-1001 (employee)
  veh2 text; tok2 text;    -- SMP-2002 (official)
  tok3 text;               -- SMP-3003 (visitor)
  base timestamptz := date_trunc('minute', now()) - interval '1 day';
  -- direction / result / code, with '-' for nulls
  q text := 'select coalesce(x->>''direction'',''-'')||''/''||(x->>''result'')||''/''||(x->>''code'') from (select public.scan_vehicle(%L,%L,%L,%L) x) s';
  qr text := 'select (x->>''replayed'')||''/''||coalesce(x->>''direction'',''-'') from (select public.scan_vehicle(%L,%L,%L,%L) x) s';
  out text;
begin
  select id into adm from public.profiles where role = 'admin' limit 1;
  select id, token into veh, tok from public.vehicles where plate = 'SMP-1001';
  select id, token into veh2, tok2 from public.vehicles where plate = 'SMP-2002';
  select token into tok3 from public.vehicles where plate = 'SMP-3003';
  select id into g1 from public.gates where code = 'G1';

  insert into auth.users (id, email, aud, role) values (grd, 'guard-scan@example.invalid', 'authenticated', 'authenticated');
  insert into public.profiles (id, full_name, role) values (grd, 'Scan Guard', 'guard');
  insert into public.gates (code, name, direction_mode) values ('T-IN', 'Test entry lane', 'in') returning id into g_in;
  insert into public.gates (code, name, direction_mode) values ('T-OUT', 'Test exit lane', 'out') returning id into g_out;

  ------------------------------------------------------------------ anon
  set local role anon;
  perform pg_temp.chk('anon cannot call scan_vehicle', format(q, tok, g1, 'anon-key-000000000001', null), 'ERR:%permission denied%');
  reset role;

  ------------------------------------------------------------------ guard
  perform set_config('request.jwt.claims', json_build_object('sub', grd, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', grd::text, true);
  set local role authenticated;

  perform pg_temp.chk('bad idempotency key rejected', format(q, tok, g1, 'short', null), 'ERR:%invalid idempotency%');
  perform pg_temp.chk('invalid gate denied', format(q, tok, 'NOPE', 'key-badgate-00000001', null), '-/denied/invalid_gate');
  perform pg_temp.chk('unknown token denied', format(q, 'not-a-real-token', g1, 'key-unknown-0000001', null), '-/denied/unregistered');
  perform pg_temp.chk('null token denied', format(q, null, g1, 'key-nulltok-00000001', null), '-/denied/unregistered');

  -- toggle at a both-way gate
  perform pg_temp.chk('first scan is IN', format(q, tok, g1, 'key-in-0000000000001', base + interval '1 hour'), 'IN/ok/ok');
  perform pg_temp.chk('same key replays original (no new row)', format(qr, tok, g1, 'key-in-0000000000001', base + interval '1 hour'), 'true/IN');
  perform pg_temp.chk('scan 2s later is a cooldown duplicate', format(q, tok, g1, 'key-dup-0000000000002', base + interval '1 hour 2 seconds'), 'IN/duplicate/cooldown');
  perform pg_temp.chk('next scan is OUT', format(q, tok, g1, 'key-out-000000000003', base + interval '2 hours'), 'OUT/ok/ok');
  perform pg_temp.chk('next scan is IN again', format(q, tok, g1, 'key-in-0000000000004', base + interval '3 hours'), 'IN/ok/ok');
  perform pg_temp.chk('exactly 3 movements recorded (duplicate + replay wrote nothing)', format('select count(*)::text from public.gate_logs where vehicle_id = %L', veh), '3');

  -- anti-passback: entry-only lane while already inside
  perform pg_temp.chk('entry lane while inside -> IN with double_in warning', format(q, tok, g_in, 'key-apin-000000000005', base + interval '4 hours'), 'IN/warning/double_in');

  reset role;
  update public.settings set value = '"block"' where key = 'anti_passback_mode';
  set local role authenticated;
  perform pg_temp.chk('block mode: double_in is denied', format(q, tok, g_in, 'key-apin-000000000006', base + interval '5 hours'), '-/denied/double_in');
  perform pg_temp.chk('block mode: denial wrote no movement', format('select count(*)::text from public.gate_logs where vehicle_id = %L', veh), '4');
  reset role;
  update public.settings set value = '"warn"' where key = 'anti_passback_mode';
  set local role authenticated;

  perform pg_temp.chk('exit lane while inside -> OUT ok', format(q, tok, g_out, 'key-xout-00000000007', base + interval '6 hours'), 'OUT/ok/ok');
  perform pg_temp.chk('exit lane while already out -> double_out warning', format(q, tok, g_out, 'key-xout-00000000008', base + interval '7 hours'), 'OUT/warning/double_out');
  perform pg_temp.chk('exit lane, never entered -> no_entry_record warning', format(q, tok2, g_out, 'key-noent-00000000009', base + interval '7 hours'), 'OUT/warning/no_entry_record');

  perform pg_temp.chk('result screen never exposes phone', format('select ((public.scan_vehicle(%L,%L,%L,%L)) -> ''vehicle'' ? ''phone'')::text', tok, g1, 'key-priv-00000000010', base + interval '8 hours'), 'false');

  -- client-supplied time outside the allowed window falls back to the server clock
  perform pg_temp.chk('far-future client time is ignored', format('select ((x->>''scanned_at'')::timestamptz < now() + interval ''1 hour'')::text from (select public.scan_vehicle(%L,%L,%L,%L) x) s', tok3, g1, 'key-future-0000000011', now() + interval '1 day'), 'true');
  perform pg_temp.chk('very old client time is ignored', format('select ((x->>''scanned_at'')::timestamptz > now() - interval ''1 hour'')::text from (select public.scan_vehicle(%L,%L,%L,%L) x) s', tok2, g1, 'key-old-00000000000012', now() - interval '30 days'), 'true');

  ------------------------------------------------------ vehicle states
  reset role;
  update public.vehicles set status = 'blocked', blocked_reason = 't' where id = veh2;
  set local role authenticated;
  perform pg_temp.chk('blocked vehicle denied', format(q, tok2, g1, 'key-blk-000000000013', null), '-/denied/blocked');

  reset role;
  update public.vehicles set status = 'pending' where id = veh2;
  set local role authenticated;
  perform pg_temp.chk('pending vehicle denied', format(q, tok2, g1, 'key-pnd-000000000014', null), '-/denied/pending');

  reset role;
  update public.vehicles set status = 'rejected' where id = veh2;
  set local role authenticated;
  perform pg_temp.chk('rejected vehicle denied', format(q, tok2, g1, 'key-rej-000000000015', null), '-/denied/rejected');

  reset role;
  update public.vehicles set status = 'approved', valid_to = current_date - 1 where id = veh2;
  set local role authenticated;
  perform pg_temp.chk('expired pass denied', format(q, tok2, g1, 'key-exp-000000000016', null), '-/denied/expired');

  reset role;
  update public.vehicles set valid_to = null, valid_from = current_date + 2 where id = veh2;
  set local role authenticated;
  perform pg_temp.chk('not-yet-valid pass denied', format(q, tok2, g1, 'key-nyv-000000000017', null), '-/denied/not_yet_valid');

  reset role;
  update public.vehicles set valid_from = null, deleted_at = now() where id = veh2;
  set local role authenticated;
  perform pg_temp.chk('soft-deleted vehicle token denied', format(q, tok2, g1, 'key-del-000000000018', null), '-/denied/unregistered');

  reset role;
  update public.gates set active = false where id = g1;
  set local role authenticated;
  perform pg_temp.chk('deactivated gate denied', format(q, tok, g1, 'key-gate-00000000019', null), '-/denied/invalid_gate');

  ------------------------------------------------------------ guard visibility
  perform pg_temp.chk('guard sees own movements', 'select (count(*) >= 6)::text from public.gate_logs', 'true');
  reset role;

  ------------------------------------------------------------------ admin
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', adm::text, true);
  set local role authenticated;
  perform pg_temp.chk('admin may replay a guard key', format(qr, tok, g1, 'key-in-0000000000001', null), 'true/IN');
  perform pg_temp.chk('denials are in the audit log', 'select (count(*) >= 8)::text from public.audit_logs where action = ''scan_denied''', 'true');
  perform pg_temp.chk('visitor shows in inside-now view', 'select count(*)::text from public.v_vehicles_inside where plate = ''SMP-3003''', '1');
  reset role;

  -- a different guard may not replay someone else's key
  declare g2 uuid := gen_random_uuid();
  begin
    insert into auth.users (id, email, aud, role) values (g2, 'guard2-scan@example.invalid', 'authenticated', 'authenticated');
    insert into public.profiles (id, full_name, role) values (g2, 'Other Guard', 'guard');
    perform set_config('request.jwt.claims', json_build_object('sub', g2, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', g2::text, true);
    set local role authenticated;
    perform pg_temp.chk('other guard cannot replay my key', format(q, tok, g1, 'key-in-0000000000001', null), 'ERR:%idempotency_conflict%');
    reset role;
  end;

  select string_agg(format('FAIL [%s] %s -> got: %s', n, name, left(got, 90)), ' ;; ' order by n)
    filter (where not pass) into out from res;
  raise exception E'RESULTS (rolled back) % PASS=% FAIL=%', coalesce(out, 'no failures'),
    (select count(*) from res where pass), (select count(*) from res where not pass);
end;
$$;
