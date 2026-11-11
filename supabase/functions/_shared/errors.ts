// Sanitising and validating browser error reports. Pure functions.
// Error text is untrusted AND can accidentally contain secrets (tokens in URLs, emails, QR tokens),
// so everything is scrubbed before it is stored.

export interface ErrorReport {
  app: string;
  message: string;
  stack: string | null;
  url: string | null;
}

const NOISE = [/^Script error\.?$/i, /ResizeObserver loop/i, /^Non-Error promise rejection/i];

// Order matters: specific patterns first.
const SCRUBBERS: [RegExp, string][] = [
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, "[jwt]"],
  [/\bsb_(?:publishable|secret)_[A-Za-z0-9_-]+/g, "[key]"],
  [/\b0x4[A-Za-z0-9_-]{18,}/g, "[key]"],
  [
    /([?&#;]|\b)(access_token|refresh_token|token|code|claim_secret|apikey|password|secret)=[^&\s"')]+/gi,
    "$1$2=[redacted]",
  ],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
  // Long base64url-looking words that mix letters and digits: QR tokens (22), claim secrets (43)...
  [/\b(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{20,}\b/g, "[token]"],
  [/\b\d{9,}\b/g, "[number]"], // phone-number-like runs
];

export function scrub(input: unknown, max: number): string {
  let s = typeof input === "string" ? input : "";
  s = s.slice(0, max * 2); // bound the work before running regexes
  for (const [re, rep] of SCRUBBERS) s = s.replace(re, rep);
  return s.slice(0, max);
}

/** Keep only origin + path: query strings and hashes can hold one-time tokens. */
export function sanitizeUrl(u: unknown): string | null {
  if (typeof u !== "string" || !u) return null;
  try {
    const x = new URL(u);
    if (x.protocol !== "http:" && x.protocol !== "https:") return null;
    return scrub(`${x.origin}${x.pathname}`, 200);
  } catch {
    return null;
  }
}

export function validateReport(raw: unknown): { ok: true; value: ErrorReport } | { ok: false } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const message = scrub(r.message, 500).replace(/\s+/g, " ").trim();
  if (!message || NOISE.some((re) => re.test(message))) return { ok: false };
  const app = typeof r.app === "string" && /^[a-z0-9_-]{1,30}$/.test(r.app) ? r.app : "unknown";
  const stack = scrub(r.stack, 2000).trim() || null;
  return { ok: true, value: { app, message, stack, url: sanitizeUrl(r.url) } };
}

export async function fingerprint(app: string, message: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${app}|${message}`));
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}
