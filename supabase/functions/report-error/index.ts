// Receives error reports from the browser apps. Public (anonymous) on purpose, so it is strictly
// bounded: small bodies, per-IP rate limit, per-error dedupe, and everything is scrubbed
// (see _shared/errors.ts) before storage. It never reveals whether a report was stored.
import { createClient } from "npm:@supabase/supabase-js@2";
import { clientIp, corsHeaders } from "../_shared/http.ts";
import { fingerprint, scrub, validateReport } from "../_shared/errors.ts";

const MAX_BODY = 8192;

export async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  const quiet = (status: number) =>
    new Response(null, {
      status,
      headers: { ...corsHeaders(origin), "Cache-Control": "no-store" },
    });
  if (req.method === "OPTIONS") return quiet(204);
  if (req.method !== "POST") return quiet(405);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return quiet(500);
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  const ip = clientIp(req);

  // Sent as text/plain (a "simple" request, no CORS preflight), so parse the text ourselves.
  const body = await req.text();
  if (body.length > MAX_BODY) return quiet(413);
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return quiet(400);
  }
  const v = validateReport(raw);
  if (!v.ok) return quiet(204); // noise / junk: accept silently, store nothing

  const { data: allowed } = await db.rpc("check_rate_limit", {
    p_key: `err-ip:${ip}`,
    p_limit: 30,
    p_window_seconds: 3600,
  });
  if (!allowed) return quiet(429);

  // The same error from the same device is stored at most 3 times an hour.
  const fp = await fingerprint(v.value.app, v.value.message);
  const { data: fresh } = await db.rpc("check_rate_limit", {
    p_key: `err-dup:${ip}:${fp}`,
    p_limit: 3,
    p_window_seconds: 3600,
  });
  if (!fresh) return quiet(204);

  // Optional: attribute to a signed-in user if a valid session token came along.
  let userId: string | null = null;
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (jwt.split(".").length === 3) {
    const { data } = await db.auth.getUser(jwt);
    userId = data.user?.id ?? null;
  }

  await db.from("client_errors").insert({
    user_id: userId,
    app: v.value.app,
    message: v.value.message,
    stack: v.value.stack,
    url: v.value.url,
    user_agent: scrub(req.headers.get("user-agent"), 200),
    ip,
  });
  return quiet(204);
}

if (import.meta.main) Deno.serve(handler);
