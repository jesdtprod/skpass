// CORS + JSON response helpers shared by all public Edge Functions.

const DEFAULT_ORIGINS = [
  "https://jesdtprod.github.io",
  "http://localhost:8137",
  "http://localhost:9000",
];

export function allowedOrigins(): string[] {
  const env = Deno.env.get("ALLOWED_ORIGINS");
  return env ? env.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_ORIGINS;
}

export function corsHeaders(origin: string | null): Record<string, string> {
  const h: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (origin && allowedOrigins().includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

export function json(status: number, body: unknown, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export function clientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    "unknown";
}
