# SKPass docs

- [runbook.md](runbook.md) – day-to-day operation, offline behaviour, secrets, deploying, known
  limits.
- [backup-plan.md](backup-plan.md) – what to back up, how, how to restore, restore drill.

Source of truth for behaviour is the code and the SQL tests:

- `supabase/migrations/` – schema, RLS, RPCs (`scan_vehicle`, admin actions, `admin_stats`…)
- `supabase/tests_rls.sql`, `supabase/tests_scan.sql` – run in a rolled-back transaction:
  `npx supabase db query --remote --yes -f supabase/tests_scan.sql` (expect `no failures`)
- `deno task check` – format, lint and all unit tests
