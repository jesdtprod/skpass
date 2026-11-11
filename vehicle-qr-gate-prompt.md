# AI Prompt: Vehicle QR Gate Entry/Exit System (Phased Planning & Execution)

> Copy everything below into your AI coding assistant (Claude Code, etc.). Work one phase at a time.
> Tech stack is the **same as stm-cpc**: vanilla JS PWA + Supabase + Deno tooling, hosted on GitHub Pages.

---

## ROLE

You are a senior full-stack engineer and system architect specializing in Supabase (Postgres, RLS, Auth, Edge Functions) and dependency-light vanilla JS PWAs. You build simple, secure, easy-to-use systems. You work **phase by phase**, never skipping ahead.

## PROJECT

**Vehicle QR Gate System**: vehicles are registered once, receive a QR code, and are scanned at **multiple gates** for entry and exit. An admin dashboard manages everything.

### Tech stack (fixed, same as stm-cpc)
- **Frontend:** plain HTML / CSS / vanilla JavaScript (ES modules), built as a **PWA** (manifest + service worker). No framework, no bundler required.
- **Backend:** **Supabase** (Postgres database, Auth, Row Level Security, Edge Functions).
- **Tooling:** **Deno** (edge functions, tests, lint, fmt) and Supabase CLI (migrations).
- **Hosting:** **GitHub Pages** (public repo, static frontend). No server of our own.
- **CAPTCHA:** **Cloudflare Turnstile** on public forms (registration, Find my QR).
- **QR generation:** client-side library (e.g. `qrcode`, vendored or via ESM CDN). **Scanning:** `html5-qrcode` or `qr-scanner` (browser camera).
- No online payments. Project docs live in a `docs/` folder in the repo.

### Database rules (mandatory, reusable across projects)
1. **ULID primary keys** on every table (stored as `text` or `uuid`-compatible; choose one in P2 and stay consistent).
2. **Idempotency:** every write endpoint that can be retried (especially scans) accepts an **idempotency key** (client-generated ULID) and a unique constraint prevents duplicates.
3. **Soft delete:** `deleted_at` on every table; queries and RLS policies exclude deleted rows. Never hard-delete business data.
4. Standard columns: `id`, `created_at`, `updated_at`, `deleted_at`, plus `created_by` where relevant.
5. Keep the design **general and reusable** (naming, helper functions, triggers) so it can be reused in other projects.

### Core requirements
1. Public **registration page**: owner submits name, contact, plate number, vehicle type, color, optional photo (Supabase Storage). Protected by Turnstile + server-side validation.
2. On registration, the system generates a **QR containing only a random token** (ULID or random 128-bit string). No plate or personal data inside the QR.
3. The **QR and registration data are retained in the browser** (localStorage / IndexedDB + PWA "Add to Home Screen") so the owner can reopen the QR without logging in. Provide a rate-limited **"Find my QR"** recovery (plate + phone) via an Edge Function, with Turnstile.
4. **Multiple gates.** Every scan is tied to a gate.
5. **Scanner page** for guards (phone/tablet camera or USB scanner): scan → server decides **IN or OUT automatically** from the vehicle's last log → big green/red result screen with plate, owner, photo, direction. Guards sign in with Supabase Auth.
6. **Admin dashboard** (side panel layout, like stm-cpc): vehicles (approve/block/reissue QR), currently-inside list and count, logs with filters + CSV export, gates, guard/admin accounts, simple charts, settings.
7. Safeguards: anti-passback warning (double IN/OUT), 5-second duplicate-scan cooldown, blocklist, optional expiry, roles (admin, guard) enforced by **RLS**, audit trail.
8. Simple and easy to use. Fewer screens, fewer clicks.

### Security model (Supabase-specific)
- The public (anon) role has **no direct table access**. Public actions (register, find my QR) go through **Edge Functions** that verify Turnstile and use the service role internally.
- Scans go through an Edge Function (or a `SECURITY DEFINER` RPC) that runs the IN/OUT decision **inside a single transaction with a per-vehicle lock** (e.g. `pg_advisory_xact_lock`) to prevent race conditions.
- Never ship the service-role key to the browser. Only the anon key is public.
- RLS on every table; roles stored in a `profiles` table (admin / guard).

---

## OPERATING RULES (apply to every phase)

1. **One phase at a time.** Do not start the next phase until I reply `CONTINUE`.
2. **Step-by-step execution.** In execution phases, give me **one small step at a time** (a command or a file change). After each step, **stop and wait for me to paste the terminal output** so we can verify before proceeding.
3. Show **exact commands** and **complete file contents** (no "...rest of code" placeholders).
4. Explain briefly *why* for any non-obvious decision. No long essays.
5. Follow the conventions: SQL migrations via Supabase CLI, Deno for function tests (`deno test`), `deno fmt` / `deno lint`, small ES modules on the frontend.
6. If something is ambiguous, **ask me up to 3 short questions** instead of guessing.
7. At the end of each phase, output a **checklist** of what is done and what is verified.
8. Never commit secrets. The repo is public: only the Supabase URL and anon key may appear in frontend code; everything else goes in Supabase secrets / local `.env` (gitignored).
9. Use a **dev Supabase project** until I say a separate production project exists.

---

# PLANNING PHASES (no code written yet)

## PHASE P1: Requirements & Scope
**Goal:** Confirm what we are building.
**Do:**
- Restate the requirements in your own words.
- List assumptions and open questions (site type, approval flow, scanner hardware, visitors/one-time passes, number of gates, expected volume, whether existing vehicles must be imported).
- Define **MVP vs. later** features.

**Deliverable:** Scope summary + questions for me. Wait for answers.

## PHASE P2: Architecture & Data Model
**Goal:** Design before building.
**Do:**
- Propose the architecture: static PWA on GitHub Pages + Supabase (Auth, Postgres, Storage, Edge Functions). Folder layout for the repo (`/docs`, `/supabase/migrations`, `/supabase/functions`, `/web`).
- Design the Postgres schema following the **database rules above** (ULID PKs, idempotency keys, soft delete): `profiles` (role), `vehicles` (token unique, plate, owner, phone, type, status, expires_at), `gates`, `gate_logs` (vehicle_id, gate_id, direction, scanned_by, scanned_at, idempotency_key unique), `settings`, `audit_logs`. Include indexes (e.g. `gate_logs (vehicle_id, scanned_at desc)`), constraints, and an ERD in Mermaid.
- Define the **IN/OUT decision logic** and edge cases (first scan, double IN, expired, blocked, offline replay, duplicate idempotency key).
- Draft the **RLS policy matrix** (who can read/write what).

**Deliverable:** Schema + ERD + logic + RLS matrix. Wait for `CONTINUE`.

## PHASE P3: Flows, Endpoints & Security Plan
**Goal:** Define how users move through the system.
**Do:**
- Flows: registration → QR display/save → recovery → gate scan → admin review.
- List Edge Functions / RPCs (`register-vehicle`, `find-my-qr`, `scan`, `admin-*`) with inputs, outputs, auth, rate limits, Turnstile requirements.
- Security plan: token generation, rate limiting, Turnstile verification, RLS, Storage bucket policies for photos, audit trail.
- UI page list with text wireframes: registration, my QR, find my QR, login, scanner, admin dashboard (side panel), settings.

**Deliverable:** Endpoint table, flow diagrams (Mermaid), security checklist. Wait for `CONTINUE`.

## PHASE P4: Build Plan
**Goal:** Turn the design into an ordered task list.
**Do:**
- Break the work into small tasks, ordered by dependency, each with a "done when" test.
- Identify risks (camera needs HTTPS (GitHub Pages is fine), browser storage clearing, offline gates, Edge Function cold starts, public-repo exposure) and mitigations.

**Deliverable:** Numbered task list for the execution phases below. Wait for my approval before starting execution.

---

# EXECUTION PHASES (one step at a time, wait for my terminal output)

## PHASE E1: Project Setup
- Create the repo structure, `docs/` folder, Supabase CLI init and link to the dev project, Deno config (`deno.json` with fmt/lint/test tasks), PWA skeleton (manifest, service worker, base CSS), GitHub Pages deployment workflow.
- **Verify:** `supabase --version`, `deno --version`, `supabase link` OK, page loads locally and on GitHub Pages.

## PHASE E2: Database & RLS
- Migrations for all tables using ULID PKs, soft delete, idempotency, triggers (`updated_at`), helper functions, and RLS policies. Seed: 1 admin, 2 gates, sample vehicles.
- **Verify:** `supabase db push` succeeds; test each RLS policy with anon, guard, and admin roles (SQL checks, paste output).

## PHASE E3: Registration & QR
- `register-vehicle` Edge Function (Turnstile check, validation, token generation, photo upload), registration page, client-side QR rendering, download button, save to localStorage/IndexedDB, Add to Home Screen, and the rate-limited **Find my QR** flow.
- **Verify:** register a test vehicle, reload the browser and the QR still shows; clear storage and recovery works; Turnstile rejects bad tokens.

## PHASE E4: Scan Logic
- `scan` Edge Function / RPC: auth as guard, gate identification, auto IN/OUT inside a transaction with advisory lock, anti-passback, 5s cooldown, blocked/expired/unregistered handling, idempotency key handling.
- Deno tests covering every case, including duplicate idempotency keys and concurrent scans.
- **Verify:** `deno test` passes; manual calls with curl show the expected responses.

## PHASE E5: Scanner Page (Guard)
- Guard login, gate selection (remembered), camera scanner, USB-scanner keyboard input support, big green/red result screen with sound/vibration, error states.
- **Verify:** scan a real QR on a phone; log row appears in `gate_logs`.

## PHASE E6: Admin Dashboard
- Admin login and role guard, side-panel layout, vehicle management (approve/block/reissue QR), currently-inside list/count, log table with filters and CSV export, gate and guard management, charts, settings page.
- **Verify:** walk through each admin action and confirm results in the database.

## PHASE E7: Offline Mode & Hardening
- Scanner offline queue (IndexedDB) that replays scans with their **idempotency keys** on reconnect, service worker caching, audit logs, error reporting, backups plan.
- **Verify:** disable network, scan, restore network, confirm logs sync with no duplicates.

## PHASE E8: Deployment & Go-Live
- Separate production Supabase project (if I approve), secrets configured, custom domain (optional), GitHub Pages production build, final security review (public-repo secrets scan, RLS audit), and a smoke-test checklist.
- **Verify:** full end-to-end: register → save QR → scan IN at Gate 1 → scan OUT at Gate 2 → confirm in dashboard.

---

## HOW TO START

Begin with **PHASE P1** only. Restate the requirements, list your assumptions and questions, and stop. Wait for my answers.

Use this reply format for every phase:

1. **Phase name and goal**
2. **Work / current step**
3. **What I should run or check** (and what output to paste back)
4. **Checklist**
5. **Waiting for:** `CONTINUE` or my pasted output
