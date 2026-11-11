// Public vehicle registration. Anonymous callers never touch tables directly:
// this function verifies Turnstile, rate-limits, validates, stores the photo and inserts a
// PENDING vehicle (no QR token until an admin approves it) using the service role.
import { createClient } from "npm:@supabase/supabase-js@2";
import { claimSecretFor, sha256Hex } from "../_shared/crypto.ts";
import { clientIp, corsHeaders, json } from "../_shared/http.ts";
import { verifyTurnstile } from "../_shared/turnstile.ts";
import {
  PHOTO_TYPES,
  sniffImageType,
  validatePhoto,
  validateRegistration,
} from "../_shared/validate.ts";

const PHOTO_BUCKET = "vehicle-photos";

function normPlate(p: string): string {
  return p.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(origin) });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" }, origin);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const turnstileSecret = Deno.env.get("TURNSTILE_SECRET_KEY");
  const pepper = Deno.env.get("CLAIM_PEPPER");
  if (!url || !serviceKey || !turnstileSecret || !pepper) {
    console.error("register-vehicle: missing server configuration");
    return json(500, { error: "server_misconfigured" }, origin);
  }
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  const ip = clientIp(req);

  // 1. Rate limit (5 registrations per hour per IP)
  const { data: allowed, error: rlErr } = await db.rpc("check_rate_limit", {
    p_key: `register:${ip}`,
    p_limit: 5,
    p_window_seconds: 3600,
  });
  if (rlErr) {
    console.error("rate limit error", rlErr.message);
    return json(500, { error: "server_error" }, origin);
  }
  if (!allowed) return json(429, { error: "rate_limited" }, origin);

  // 2. Parse body
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json(400, { error: "bad_request" }, origin);
  }

  // 3. Turnstile
  const token = String(form.get("turnstile_token") ?? "");
  if (!(await verifyTurnstile(token, turnstileSecret, ip))) {
    return json(400, { error: "captcha_failed" }, origin);
  }

  // 4. Validate
  const { data: setting } = await db.from("settings").select("value")
    .eq("key", "visitor_max_days").is("deleted_at", null).maybeSingle();
  const maxDays = Number(setting?.value ?? 30) || 30;
  const raw = Object.fromEntries(
    [...form.entries()].filter(([, v]) => typeof v === "string"),
  );
  const today = new Date().toISOString().slice(0, 10);
  const result = validateRegistration(raw, today, maxDays);
  if (!result.ok) return json(422, { error: "validation_failed", fields: result.errors }, origin);
  const v = result.value;

  // 5. Replay of the same request (e.g. the response was lost): return the same claim secret.
  const claimSecret = await claimSecretFor(pepper, v.idempotency_key);
  const { data: existing } = await db.from("vehicles").select("id, plate_norm, status")
    .eq("idempotency_key", v.idempotency_key).maybeSingle();
  if (existing) {
    if (existing.plate_norm !== normPlate(v.plate)) {
      return json(409, { error: "request_key_conflict" }, origin);
    }
    return json(200, {
      vehicle_id: existing.id,
      claim_secret: claimSecret,
      status: existing.status,
      replayed: true,
    }, origin);
  }

  // 6. Optional photo (type from magic bytes, size-limited)
  let photoPath: string | null = null;
  const photo = form.get("photo");
  if (photo instanceof File && photo.size > 0) {
    const bytes = new Uint8Array(await photo.arrayBuffer());
    const sniffed = sniffImageType(bytes);
    const problem = sniffed ? validatePhoto(sniffed, bytes.length) : validatePhoto("", 0);
    if (problem || !sniffed) {
      return json(422, { error: "validation_failed", fields: { photo: problem } }, origin);
    }
    photoPath = `${crypto.randomUUID()}.${PHOTO_TYPES[sniffed]}`;
    const { error: upErr } = await db.storage.from(PHOTO_BUCKET)
      .upload(photoPath, bytes, { contentType: sniffed, upsert: false });
    if (upErr) {
      console.error("photo upload failed", upErr.message);
      return json(500, { error: "photo_upload_failed" }, origin);
    }
  }

  // 7. Insert PENDING vehicle (no token until approved)
  const { data: row, error: insErr } = await db.from("vehicles").insert({
    category: v.category,
    status: "pending",
    plate: v.plate,
    owner_name: v.owner_name,
    phone: v.phone,
    vehicle_type: v.vehicle_type,
    color: v.color,
    photo_path: photoPath,
    office: v.office,
    id_number: v.id_number,
    position: v.position,
    agency: v.agency,
    host_name: v.host_name,
    purpose: v.purpose,
    valid_from: v.valid_from,
    valid_to: v.valid_to,
    claim_hash: await sha256Hex(claimSecret),
    registered_via: "public",
    idempotency_key: v.idempotency_key,
  }).select("id, status").single();

  if (insErr || !row) {
    if (photoPath) await db.storage.from(PHOTO_BUCKET).remove([photoPath]);
    if (insErr?.code === "23505") {
      if (insErr.message.includes("vehicles_idem_key")) {
        // Lost a race with an identical concurrent request: ask the client to retry.
        return json(409, { error: "retry" }, origin);
      }
      return json(409, { error: "plate_already_registered" }, origin);
    }
    console.error("insert failed", insErr?.message);
    return json(500, { error: "server_error" }, origin);
  }

  return json(201, { vehicle_id: row.id, claim_secret: claimSecret, status: row.status }, origin);
}

if (import.meta.main) Deno.serve(handler);
