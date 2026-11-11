// Registers (or removes) a browser for push notifications.
//   admin: proves identity with a signed-in admin session.
//   owner: proves ownership of one vehicle with its claim secret (same proof as my-status).
// Also lets an admin send themselves a test notification.
import { createClient } from "npm:@supabase/supabase-js@2";
import { sha256Hex, timingSafeEqual } from "../_shared/crypto.ts";
import { clientIp, corsHeaders, json } from "../_shared/http.ts";
import { deliver, supabaseStore, vapidFromEnv } from "../_shared/notify.ts";
import { testMessage } from "../_shared/push-messages.ts";
import { isAllowedEndpoint, validKeys } from "../_shared/webpush.ts";
import { scrub } from "../_shared/errors.ts";

const MAX_PER_VEHICLE = 5;
const MAX_PER_ADMIN = 10;

export async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(origin) });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" }, origin);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json(500, { error: "server_misconfigured" }, origin);
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  const ip = clientIp(req);

  const { data: ok, error: rlErr } = await db.rpc("check_rate_limit", {
    p_key: `push-sub:${ip}`,
    p_limit: 40,
    p_window_seconds: 3600,
  });
  if (rlErr) return json(500, { error: "server_error" }, origin);
  if (!ok) return json(429, { error: "rate_limited" }, origin);

  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return json(400, { error: "bad_request" }, origin);
  }
  const action = b.action;
  const audience = b.audience;
  if (
    (action !== "subscribe" && action !== "unsubscribe" && action !== "test") ||
    (audience !== "admin" && audience !== "owner")
  ) {
    return json(400, { error: "bad_request" }, origin);
  }

  // ---- who is asking?
  let userId: string | null = null;
  let vehicleId: string | null = null;
  if (audience === "admin") {
    const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json(401, { error: "unauthorized" }, origin);
    const { data: u, error } = await db.auth.getUser(jwt);
    if (error || !u.user) return json(401, { error: "unauthorized" }, origin);
    const { data: me } = await db.from("profiles").select("role, active").eq("id", u.user.id)
      .is("deleted_at", null).maybeSingle();
    if (!me || me.role !== "admin" || !me.active) return json(403, { error: "forbidden" }, origin);
    userId = u.user.id;
  } else {
    const id = typeof b.vehicle_id === "string" ? b.vehicle_id : "";
    const secret = typeof b.claim_secret === "string" ? b.claim_secret : "";
    if (!/^[0-9A-Z]{26}$/.test(id) || secret.length < 20 || secret.length > 100) {
      return json(400, { error: "bad_request" }, origin);
    }
    const { data: v } = await db.from("vehicles").select("id, claim_hash").eq("id", id)
      .is("deleted_at", null).maybeSingle();
    const given = await sha256Hex(secret); // always hash: unknown vehicle and wrong secret look alike
    if (!v || !v.claim_hash || !timingSafeEqual(given, v.claim_hash)) {
      return json(404, { error: "not_found" }, origin);
    }
    vehicleId = id;
  }

  // ---- test notification (admin only)
  if (action === "test") {
    if (audience !== "admin") return json(400, { error: "bad_request" }, origin);
    const vapid = vapidFromEnv();
    if (!vapid) return json(500, { error: "push_not_configured" }, origin);
    const store = supabaseStore(db);
    const subs = await store.list({ audience: "admin", userId: userId! });
    const report = await deliver(store, subs, testMessage(), vapid);
    return json(200, { ok: true, ...report }, origin);
  }

  // ---- validate the browser's subscription
  const sub = (b.subscription ?? {}) as { endpoint?: unknown; keys?: unknown };
  if (!isAllowedEndpoint(sub.endpoint)) {
    return json(422, { error: "unsupported_push_service" }, origin);
  }
  const endpoint = sub.endpoint as string;

  if (action === "unsubscribe") {
    let q = db.from("push_subscriptions").update({ deleted_at: new Date().toISOString() })
      .eq("endpoint", endpoint).eq("audience", audience).is("deleted_at", null);
    q = audience === "admin" ? q.eq("user_id", userId!) : q.eq("vehicle_id", vehicleId!);
    const { error } = await q;
    return error ? json(500, { error: "server_error" }, origin) : json(200, { ok: true }, origin);
  }

  if (!validKeys(sub.keys)) return json(422, { error: "bad_subscription" }, origin);
  const keys = sub.keys;

  // Replace an earlier row for the SAME endpoint AND the same target (re-subscribing). Other
  // vehicles/users that share this browser keep their own rows.
  let same = db.from("push_subscriptions").update({ deleted_at: new Date().toISOString() })
    .eq("endpoint", endpoint).eq("audience", audience).is("deleted_at", null);
  same = audience === "admin" ? same.eq("user_id", userId!) : same.eq("vehicle_id", vehicleId!);
  await same;

  // Cap how many devices one vehicle / one admin can register (oldest are dropped).
  const cap = audience === "admin" ? MAX_PER_ADMIN : MAX_PER_VEHICLE;
  let existing = db.from("push_subscriptions").select("id").eq("audience", audience)
    .is("deleted_at", null).order("created_at", { ascending: true });
  existing = audience === "admin"
    ? existing.eq("user_id", userId!)
    : existing.eq("vehicle_id", vehicleId!);
  const { data: old } = await existing;
  if (old && old.length >= cap) {
    const drop = old.slice(0, old.length - cap + 1).map((r: { id: string }) => r.id);
    await db.from("push_subscriptions").update({ deleted_at: new Date().toISOString() }).in(
      "id",
      drop,
    );
  }

  const { error } = await db.from("push_subscriptions").insert({
    endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
    audience,
    user_id: userId,
    vehicle_id: vehicleId,
    user_agent: scrub(req.headers.get("user-agent"), 200),
    created_by: userId,
  });
  if (error) {
    console.error("push-subscribe insert failed", error.message);
    return json(500, { error: "server_error" }, origin);
  }
  return json(201, { ok: true }, origin);
}

if (import.meta.main) Deno.serve(handler);
