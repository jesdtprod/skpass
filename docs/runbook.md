# SKPass operations runbook

For the people running the system day to day. Backups and disaster recovery are in
[backup-plan.md](backup-plan.md).

## Everyday tasks

| Task                                                                 | Where                                                                          |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Approve or reject a registration                                     | Admin → **Approvals** (a QR exists only after approval)                        |
| Issue a pass for a visitor, event or official                        | Admin → **Vehicles** → **+ Add pass**                                          |
| Block a vehicle / issue a new QR / delete                            | Admin → **Vehicles** → click the row                                           |
| Add a gate (any number)                                              | Admin → **Gates**. Use _Entry only_ / _Exit only_ for one-way lanes            |
| Add a guard or administrator                                         | Admin → **Staff** → **+ Add staff**                                            |
| Reset a staff password                                               | Admin → **Staff** → **Set password**, or the login page's **Forgot password?** |
| See who is inside right now                                          | Admin → **Inside now**                                                         |
| Export movements                                                     | Admin → **Logs** → set dates → **Export CSV** (up to 10,000 rows)              |
| Change rules (cooldown, double-entry, visitor length, offline limit) | Admin → **Settings**                                                           |
| Check for problems                                                   | Admin → **System health**                                                      |

## How the guard scanner behaves offline

- The scanner **opens and keeps working with no signal** once it has been opened online on that
  phone at least once (the app files, the gate list and the guard's profile are saved on the phone).
- A scan made offline is shown as an amber **SAVED OFFLINE – not verified** screen. The guard must
  check the vehicle by eye: **nothing is checked against the database while offline**, so a blocked
  or expired pass would not be caught until the scan is sent.
- Saved scans are sent automatically, oldest first, when the connection returns. A scan is never
  recorded twice, even if the connection drops mid-send.
- If any sent scan turns out to be **not allowed** (blocked, expired, unknown…) the guard gets a red
  **CHECK OFFLINE SCANS** screen listing the plate and the reason, and must tap it. Follow up with
  the security supervisor: that vehicle already went through.
- Scans keep their real time if they sync within **72 hours** (Settings → _Offline scan age limit_).
  Older ones are recorded with the sync time instead.
- A guard who signs out with unsent scans is warned. The scans stay on the phone and are sent after
  the same person signs in again. **Scans are tied to the guard who made them.**
- If a phone is lost, its unsent scans are lost with it.

## Notifications and alert sounds

**Admins** (Admin dashboard → the 🔔 bell, bottom-left):

- While the dashboard is **open**, a new registration appears **within seconds**: a toast, the
  badge, the list refreshes, and a **loud alert that plays 3 times**. It works in a background tab
  too.
- **Turn on notifications** on a device to also be told when the dashboard is **closed** (a system
  notification that stays until you act on it, with a 3-buzz vibration on Android). Use **Send a
  test notification** to check a device. Each admin can register up to 10 devices.
- The first time, tap anywhere on the page once so the browser allows sound.

**Vehicle owners** (My QR page): while a registration is pending, the page offers **Notify me when
it's decided**. When an administrator approves or rejects it, the owner's device is notified (even
if the page is closed), and an open page shows a green/red banner with a different 3× sound for
approved and rejected. Owners need no account: a device is tied to the vehicle with its claim
secret. One phone can follow several vehicles.

**Limits you should know about**

- **Sound is only custom while a SKPass page is open.** When it is closed, the phone/computer plays
  its **own** notification sound at its own volume. Web pages cannot choose, loop or boost that
  sound. Nothing can be louder than the device volume.
- **iPhone/iPad:** notifications only work after the person adds SKPass to the Home Screen (Share →
  Add to Home Screen) and opens it from there (iOS 16.4 or later).
- Browsers delete push permission if the user clears site data; the person must turn it on again.
- The owner is notified when an **admin approves/rejects in the dashboard**. A change made directly
  in the database does not notify anyone.
- A push is encrypted end to end, but passes through Google/Apple/Mozilla's push services. It
  contains only the plate and the decision.
- Notifications are not a delivery guarantee: a phone that is off or offline gets them (or not,
  depending on the push service's time limit of 24 h) later. My QR always shows the true status.

**Keys.** `VAPID_PRIVATE_KEY` (and `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`) are Supabase secrets; the
public key is also in `web/js/config.js`. If the private key is ever replaced, every device must
turn notifications on again (old subscriptions are bound to the old key).

## Things to watch

- **System health → App errors.** A burst of errors usually means a bad deploy or a phone/browser
  problem. The detail row shows the page and stack.
- **Denied scans (24 h).** A spike can mean a revoked QR being reused, or a gate scanning the wrong
  thing.
- **Pending approvals badge** in the side panel.

## Secrets and keys

| Item                                                  | Where it lives                      | Notes                                                                                               |
| ----------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------- |
| Supabase URL, publishable key, Turnstile **site** key | `web/js/config.js` (public)         | Safe to be public                                                                                   |
| `CLAIM_PEPPER`, `TURNSTILE_SECRET_KEY`                | Supabase → Edge Functions → Secrets | Never in Git. Changing the pepper invalidates owners' saved claim secrets (QR recovery still works) |
| Service-role / secret API keys                        | Supabase dashboard only             | Never in the browser or Git                                                                         |
| Staff passwords                                       | Supabase Auth (hashed)              | Minimum 10 characters, letters and numbers                                                          |

## Deploying a change

1. `deno task check` (format, lint and tests) must pass; the GitHub workflow runs it too.
2. Push to `main`. GitHub Pages publishes `web/`.
3. Database changes are migrations in `supabase/migrations/`: `npx supabase db push --remote`.
4. Function changes: `npx supabase functions deploy <name> --use-api`.
5. If you change files the scanner needs offline, bump `CACHE` in `web/sw.js` so phones refresh
   their saved copy.

## Known limits (be aware, decide, or schedule)

- **Log retention is a setting only.** Nothing deletes old logs yet. Decide the policy with the
  data-protection officer; the number in Settings is a record of intent.
- **Plate + phone is weak proof** for "Find my QR". Mitigations: captcha, rate limits and an audit
  entry per recovery.
- **No Content-Security-Policy header** (GitHub Pages cannot set headers). Keep third-party scripts
  to a minimum on the public pages.
- Offline mode does not validate passes offline (see above) and attributes a replayed scan to the
  guard who made it.
