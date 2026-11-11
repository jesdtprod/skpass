// Admin-only staff account management. Creating an Auth user needs the service role, which must
// never reach the browser, so it lives here. The caller must present a valid admin session JWT.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/http.ts";
import { validateCreateStaff, validatePassword } from "../_shared/staff.ts";

export async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(origin) });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" }, origin);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json(500, { error: "server_misconfigured" }, origin);
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  // 1. Who is calling? Must be an active admin.
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json(401, { error: "unauthorized" }, origin);
  const { data: u, error: uErr } = await db.auth.getUser(jwt);
  if (uErr || !u.user) return json(401, { error: "unauthorized" }, origin);
  const { data: me } = await db.from("profiles").select("role, active")
    .eq("id", u.user.id).is("deleted_at", null).maybeSingle();
  if (!me || me.role !== "admin" || !me.active) return json(403, { error: "forbidden" }, origin);

  const { data: allowed } = await db.rpc("check_rate_limit", {
    p_key: `staff:${u.user.id}`,
    p_limit: 30,
    p_window_seconds: 3600,
  });
  if (!allowed) return json(429, { error: "rate_limited" }, origin);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "bad_request" }, origin);
  }

  const audit = (action: string, entityId: string, after: unknown) =>
    db.from("audit_logs").insert({
      actor_id: u.user.id,
      action,
      entity: "profiles",
      entity_id: entityId,
      after,
    });

  // 2a. Create a staff user + profile
  if (body.action === "create") {
    const v = validateCreateStaff(body);
    if (!v.ok) return json(422, { error: "validation_failed", message: v.error }, origin);
    const { data: created, error } = await db.auth.admin.createUser({
      email: v.value.email,
      password: v.value.password,
      email_confirm: true,
    });
    if (error || !created.user) {
      const exists = /already|registered|exists/i.test(error?.message ?? "");
      return json(exists ? 409 : 500, { error: exists ? "email_exists" : "server_error" }, origin);
    }
    const { error: pErr } = await db.from("profiles").insert({
      id: created.user.id,
      full_name: v.value.full_name,
      role: v.value.role,
      email: v.value.email,
      created_by: u.user.id,
    });
    if (pErr) {
      await db.auth.admin.deleteUser(created.user.id); // never leave a login without a profile
      return json(500, { error: "server_error" }, origin);
    }
    await audit("staff_created", created.user.id, { role: v.value.role, email: v.value.email });
    return json(201, { id: created.user.id, email: v.value.email, role: v.value.role }, origin);
  }

  // 2b. Set a new password for an existing staff member
  if (body.action === "set_password") {
    const id = typeof body.user_id === "string" ? body.user_id : "";
    const pwErr = validatePassword(body.password);
    if (!/^[0-9a-f-]{36}$/.test(id)) return json(400, { error: "bad_request" }, origin);
    if (pwErr) return json(422, { error: "validation_failed", message: pwErr }, origin);
    const { data: target } = await db.from("profiles").select("id").eq("id", id)
      .is("deleted_at", null).maybeSingle();
    if (!target) return json(404, { error: "not_found" }, origin);
    const { error } = await db.auth.admin.updateUserById(id, { password: body.password as string });
    if (error) return json(500, { error: "server_error" }, origin);
    await audit("staff_password_reset", id, null);
    return json(200, { ok: true }, origin);
  }

  return json(400, { error: "bad_request" }, origin);
}

if (import.meta.main) Deno.serve(handler);
