// Small crypto helpers (Web Crypto only).

const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function toBase64Url(buf: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export async function sha256Hex(input: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(input)));
}

/** HMAC-SHA256(key, message) as base64url (43 chars). */
export async function hmacBase64Url(key: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toBase64Url(await crypto.subtle.sign("HMAC", k, enc.encode(message)));
}

/** Constant-time string comparison. */
export function timingSafeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return diff === 0;
}

/**
 * The owner's claim secret is derived from the (client-generated, secret) idempotency key,
 * so a retried registration returns the same secret. Only its SHA-256 hash is stored.
 */
export function claimSecretFor(pepper: string, idempotencyKey: string): Promise<string> {
  return hmacBase64Url(pepper, `claim:${idempotencyKey}`);
}
