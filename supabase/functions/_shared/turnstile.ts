// Cloudflare Turnstile server-side verification.

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstile(
  token: string,
  secret: string,
  ip: string | null,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  if (!token || token.length > 2048 || !secret) return false;
  const body = new URLSearchParams({ secret, response: token });
  if (ip && ip !== "unknown") body.set("remoteip", ip);
  try {
    const res = await fetchFn(VERIFY_URL, { method: "POST", body });
    if (!res.ok) return false;
    const data = await res.json();
    return data?.success === true;
  } catch {
    return false; // fail closed
  }
}
