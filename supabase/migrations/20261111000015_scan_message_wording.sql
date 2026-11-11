-- Migration 15: capitalise the movement confirmation shown on the scanner (Entry Recorded / Exit Recorded).

create or replace function public._scan_message(p_code text, p_result text, p_dir text)
returns text
language sql
immutable
as $$
  select case p_code
    when 'ok' then case p_dir when 'IN' then 'Entry Recorded' else 'Exit Recorded' end
    when 'cooldown' then 'Already scanned a moment ago'
    when 'double_in' then case p_result when 'warning'
      then 'Entry Recorded, but the vehicle was already inside' else 'Vehicle is already inside' end
    when 'double_out' then case p_result when 'warning'
      then 'Exit Recorded, but the vehicle was already outside' else 'Vehicle is already outside' end
    when 'no_entry_record' then case p_result when 'warning'
      then 'Exit Recorded, but no entry was found' else 'No entry record for this vehicle' end
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
