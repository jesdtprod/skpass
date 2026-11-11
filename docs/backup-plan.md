# SKPass backup and recovery plan

> **Status: written, not yet exercised.** Nothing in this file has been run against the production
> database (it needs the database password, which only the administrator holds). Do the **restore
> drill** below once before go-live and record the date at the bottom.

## 1. What must be protected

| Data                                                           | Where                                     | Sensitivity                   |
| -------------------------------------------------------------- | ----------------------------------------- | ----------------------------- |
| Vehicles, owners, phone numbers, plates                        | Postgres `public.vehicles`                | **Personal data**             |
| Movements (`gate_logs`), audit trail, settings, staff profiles | Postgres `public`                         | Personal / security           |
| Staff logins (emails, password hashes)                         | Postgres `auth` schema (Supabase Auth)    | **Secret**                    |
| Vehicle photos                                                 | Storage bucket `vehicle-photos` (private) | **Personal data**             |
| Edge Function code, migrations, web app                        | This Git repository                       | Public                        |
| Secrets (`CLAIM_PEPPER`, Turnstile secret)                     | Supabase secrets                          | **Secret, not in any backup** |

The code and schema are fully reproducible from Git. The **data** and the **secrets** are not, so
they are what the backups are for.

> **`CLAIM_PEPPER` matters.** Owners' claim secrets are derived from it. If it is lost or changed,
> every owner's saved registration can no longer check its status (the QR of approved vehicles still
> works, and owners can recover it with "Find my QR"). Store its value in the organisation's
> password manager, separately from the data backups.

## 2. Targets (proposed; confirm with the data owner)

- **RPO** (acceptable data loss): 24 hours.
- **RTO** (time to be back up): 4 hours.
- **Retention:** 30 daily backups, 12 monthly.

## 3. Layers

1. **Supabase's own backups.** Check Dashboard → Database → Backups. What is included depends on the
   project's plan (the free plan has none; paid plans keep daily backups for a limited time and
   offer point-in-time recovery as an add-on). _Confirm which applies to this project._
2. **Your own off-site export** (this document's script), because a provider backup that sits in the
   same account does not protect against account loss or a bad admin action.
3. **Git** for everything that is not data.

## 4. Taking a backup

Prerequisites on the machine that runs it: Node.js, the Supabase CLI via `npx`, and either Docker
(used by `supabase db dump`) or PostgreSQL client tools (`pg_dump`). The connection string comes
from Dashboard → Project Settings → Database → _Connection string_.

```powershell
$env:SUPABASE_DB_URL = "postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres"
.\scripts\backup.ps1 -DryRun        # shows exactly what it would do
.\scripts\backup.ps1                # writes .\backups\<timestamp>\
```

It produces, in `backups/<UTC timestamp>/`:

- `schema.sql`, `data-public.sql`, `data-auth.sql` (staff accounts)
- `photos/` (the `vehicle-photos` bucket)
- `SHA256SUMS.txt`

`backups/` is in `.gitignore`. **Never commit a backup:** it contains personal data and password
hashes, and this repository is public.

### After the backup

1. **Encrypt it** before it leaves the machine (for example 7-Zip with AES-256 and a long
   passphrase, or `age`). Keep the passphrase in the password manager.
2. **Copy it off-site** to an organisation-controlled location with access limited to the
   administrators.
3. Delete local copies once the off-site copy is verified.
4. Keep to the retention above.

## 5. Restoring (disaster recovery)

1. Create a new Supabase project (or reset the broken one).
2. Link the CLI: `npx supabase link --project-ref <new-ref>`.
3. Apply the schema from Git: `npx supabase db push` (runs every migration in order).
4. Load the data: `psql "<new connection string>" -f data-auth.sql` then `-f data-public.sql`. Load
   `auth` first so staff profiles have their users.
5. Re-upload `photos/` to the `vehicle-photos` bucket.
6. Set the secrets: `CLAIM_PEPPER` (the **original** value), `TURNSTILE_SECRET_KEY`.
7. Redeploy the Edge Functions: `register-vehicle`, `my-status`, `find-my-qr`, `create-staff`,
   `report-error`.
8. Update `web/js/config.js` with the new project URL and publishable key, commit, deploy.
9. In Supabase → Authentication → URL Configuration, set the Site URL and redirect URLs.
10. Smoke test (section 7).

## 6. Restore drill (do before go-live, then every quarter)

Restore the latest backup into a **separate scratch project**, run the smoke test against it, then
delete the scratch project. Record the result below.

## 7. Smoke test after any restore

- [ ] Admin can sign in; dashboard numbers look right.
- [ ] A known approved vehicle's QR is still accepted at the scanner.
- [ ] A vehicle photo loads on the vehicle detail panel.
- [ ] "Find my QR" works for a known vehicle.
- [ ] A new registration can be submitted and appears under Approvals.
- [ ] System health page loads.

## 8. Other things that can go wrong

| Problem                                       | What to do                                                                                                                                         |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| A phone with unsent offline scans is lost     | Those scans are lost (they only exist on that phone). In Supabase → Authentication, revoke that guard's sessions and disable the account in Staff. |
| A guard's account is compromised              | Staff → Disable, then Set password. Sessions expire with the access token (about 1 hour).                                                          |
| Wrong approvals or blocks                     | Every admin change is in the audit log (Supabase table `audit_logs`).                                                                              |
| QR token leaked                               | Vehicles → open the vehicle → Reissue QR. The old QR stops working at once.                                                                        |
| `CLAIM_PEPPER` or the Turnstile secret leaked | Set a new one in Supabase secrets and redeploy the functions (a new pepper invalidates owners' saved claim secrets; see section 1).                |

## 9. Drill log

| Date                | Who | Backup used | Result |
| ------------------- | --- | ----------- | ------ |
| _not yet performed_ |     |             |        |
