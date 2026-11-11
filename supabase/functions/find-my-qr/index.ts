// Recovery for owners who lost their browser data: plate + phone (+ Turnstile) returns the QR
// token of an APPROVED vehicle. Every miss returns the same generic answer (no enumeration).
import { createClient } from "npm:@supabase/supabase-js@2";
import { claimSecretFor, sha256Hex } from "../_shared/crypto.ts";
import { clientIp, corsHeaders, json } from "../_shared/http.ts";
import { ownerStatus } from "../_shared/status.ts";
import { verifyTurnstile } from "../_shared/turnstile.ts";
import { clean, normPhone, normPlate } from "../_shared/validate.ts";

const NOT_FOUND = { found: false };

export async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(origin) });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" }, origin);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const turnstileSecret = Deno.env.get("TURNSTILE_SECRET_KEY");
  const pepper = Deno.env.get("CLAIM_PEPPER");
  if (!url || !serviceKey || !turnstileSecret || !pepper) {
    return json(500, { error: "server_misconfigured" }, origin);
  }
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  const ip = clientIp(req);

  const limited = async (key: string, limit: number) => {
    const { data, error } = await db.rpc("check_rate_limit", {
      p_key: key,
      p_limit: limit,
      p_window_seconds: 3600,
    });
    return error ? "error" : data ? "ok" : "limited";
  };

  const ipCheck = await limited(`find-ip:${ip}`, 10);
  if (ipCheck === "error") return json(500, { error: "server_error" }, origin);
  if (ipCheck === "limited") return json(429, { error: "rate_limited" }, origin);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "bad_request" }, origin);
  }
  const plate = normPlate(clean(body.plate));
  const phone = normPhone(clean(body.phone));
  if (plate.length < 2 || plate.length > 15 || phone.length < 7 || phone.length > 15) {
    return json(400, { error: "bad_request" }, origin);
  }

  if (!(await verifyTurnstile(String(body.turnstile_token ?? ""), turnstileSecret, ip))) {
    return json(400, { error: "captcha_failed" }, origin);
  }

  // Throttle guessing of one plate across many IPs.
  const plateCheck = await limited(`find-plate:${plate}`, 5);
  if (plateCheck === "error") return json(500, { error: "server_error" }, origin);
  if (plateCheck === "limited") return json(429, { error: "rate_limited" }, origin);

  const { data: v } = await db.from("vehicles").select(
    "id, status, category, plate, owner_name, token, valid_from, valid_to, reject_reason, claim_hash, idempotency_key",
  ).eq("plate_norm", plate).eq("phone_norm", phone).eq("status", "approved")
    .is("deleted_at", null).maybeSingle();

  if (!v || !v.token) return json(200, NOT_FOUND, origin);

  // Give the device a working claim secret so the recovered pass can keep refreshing.
  // Public registrations: the original (derived) secret. Others: issue a fresh one.
  let claimSecret: string | null = null;
  if (v.idempotency_key && v.claim_hash) {
    const derived = await claimSecretFor(pepper, v.idempotency_key);
    if ((await sha256Hex(derived)) === v.claim_hash) claimSecret = derived;
  }
  if (!claimSecret) {
    claimSecret = await claimSecretFor(pepper, `recovery:${v.id}:${crypto.randomUUID()}`);
    const { error } = await db.from("vehicles")
      .update({ claim_hash: await sha256Hex(claimSecret) }).eq("id", v.id);
    if (error) return json(500, { error: "server_error" }, origin);
  }

  await db.from("audit_logs").insert({
    action: "recover_qr",
    entity: "vehicles",
    entity_id: v.id,
    ip,
  });

  return json(200, {
    found: true,
    vehicle_id: v.id,
    claim_secret: claimSecret,
    ...ownerStatus(v, new Date().toISOString().slice(0, 10)),
  }, origin);
}

if (import.meta.main) Deno.serve(handler);
