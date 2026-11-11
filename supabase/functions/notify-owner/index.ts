// Called by the admin dashboard right after an approval or rejection: pushes the decision to the
// owner's registered devices. The status is read from the database, never trusted from the caller.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/http.ts";
import { notifyOwner, supabaseStore, vapidFromEnv } from "../_shared/notify.ts";
import { decisionMessage } from "../_shared/push-messages.ts";

export async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(origin) });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" }, origin);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const vapid = vapidFromEnv();
  if (!url || !serviceKey || !vapid) return json(500, { error: "server_misconfigured" }, origin);
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Admin only.
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json(401, { error: "unauthorized" }, origin);
  const { data: u, error: uErr } = await db.auth.getUser(jwt);
  if (uErr || !u.user) return json(401, { error: "unauthorized" }, origin);
  const { data: me } = await db.from("profiles").select("role, active").eq("id", u.user.id)
    .is("deleted_at", null).maybeSingle();
  if (!me || me.role !== "admin" || !me.active) return json(403, { error: "forbidden" }, origin);

  let body: { vehicle_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "bad_request" }, origin);
  }
  const id = typeof body.vehicle_id === "string" ? body.vehicle_id : "";
  if (!/^[0-9A-Z]{26}$/.test(id)) return json(400, { error: "bad_request" }, origin);

  for (
    const [key, limit] of [[`notify-admin:${u.user.id}`, 200], [`notify-vehicle:${id}`, 6]] as const
  ) {
    const { data: ok } = await db.rpc("check_rate_limit", {
      p_key: key,
      p_limit: limit,
      p_window_seconds: 3600,
    });
    if (!ok) return json(429, { error: "rate_limited" }, origin);
  }

  const { data: v } = await db.from("vehicles").select("id, status, plate").eq("id", id)
    .is("deleted_at", null).maybeSingle();
  if (!v) return json(404, { error: "not_found" }, origin);
  const msg = decisionMessage(v);
  if (!msg) return json(409, { error: "not_decided" }, origin); // pending / blocked: nothing to announce

  const report = await notifyOwner(supabaseStore(db), id, msg, vapid);
  return json(200, { ok: true, status: v.status, ...report }, origin);
}

if (import.meta.main) Deno.serve(handler);
