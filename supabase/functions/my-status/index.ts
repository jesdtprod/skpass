// Lets a vehicle owner (no login) see their registration status using the claim secret that
// their browser saved at registration. Returns the QR token only once an admin approved it.
import { createClient } from "npm:@supabase/supabase-js@2";
import { sha256Hex, timingSafeEqual } from "../_shared/crypto.ts";
import { clientIp, corsHeaders, json } from "../_shared/http.ts";
import { ownerStatus } from "../_shared/status.ts";

export async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(origin) });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" }, origin);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json(500, { error: "server_misconfigured" }, origin);
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  let body: { vehicle_id?: unknown; claim_secret?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "bad_request" }, origin);
  }
  const vehicleId = typeof body.vehicle_id === "string" ? body.vehicle_id : "";
  const secret = typeof body.claim_secret === "string" ? body.claim_secret : "";
  if (!/^[0-9A-Z]{26}$/.test(vehicleId) || secret.length < 20 || secret.length > 100) {
    return json(400, { error: "bad_request" }, origin);
  }

  // Rate limits: per IP and per vehicle (throttles guessing).
  const ip = clientIp(req);
  for (const [key, limit] of [[`status-ip:${ip}`, 60], [`status-v:${vehicleId}`, 30]] as const) {
    const { data: ok, error } = await db.rpc("check_rate_limit", {
      p_key: key,
      p_limit: limit,
      p_window_seconds: 3600,
    });
    if (error) return json(500, { error: "server_error" }, origin);
    if (!ok) return json(429, { error: "rate_limited" }, origin);
  }

  const { data: v } = await db.from("vehicles").select(
    "status, category, plate, owner_name, token, valid_from, valid_to, reject_reason, claim_hash, vehicle_type, color, office, position, agency, host_name, purpose, created_at",
  ).eq("id", vehicleId).is("deleted_at", null).maybeSingle();

  // Always hash, so "unknown vehicle" and "wrong secret" take the same time and look identical.
  const given = await sha256Hex(secret);
  if (!v || !v.claim_hash || !timingSafeEqual(given, v.claim_hash)) {
    return json(404, { error: "not_found" }, origin);
  }

  return json(200, ownerStatus(v, new Date().toISOString().slice(0, 10)), origin);
}

if (import.meta.main) Deno.serve(handler);
