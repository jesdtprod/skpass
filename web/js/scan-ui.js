// Pure helpers for the scanner screen (no DOM, no network) so they can be unit-tested.

/** A valid SKPass QR holds only a 128-bit URL-safe token (22 chars); accept 16-64 to be tolerant. */
export function isToken(text) {
  return typeof text === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(text.trim());
}

/** How the result overlay should look/behave for a server response. */
export function describeResult(r) {
  const dir = r.direction ?? null;
  switch (r.result) {
    case "ok":
      return { tone: "ok", title: dir === "IN" ? "IN" : "OUT", hold: 2500, sound: "ok" };
    case "warning":
      return { tone: "warn", title: dir === "IN" ? "IN" : "OUT", hold: 4500, sound: "warn" };
    case "duplicate":
      return { tone: "dup", title: "ALREADY SCANNED", hold: 1500, sound: "dup" };
    default:
      return { tone: "deny", title: "DENIED", hold: 5000, sound: "deny" };
  }
}

/** Overlay content for failures that are not a server decision (offline, expired session...). */
export function describeFailure(kind) {
  const map = {
    notQr: "Not an SKPass QR code",
    offline: "No connection. Check the network and scan again.",
    forbidden: "This account is not allowed to scan.",
    session: "Session expired. Please sign in again.",
    server: "Server error. Please scan again.",
  };
  return {
    result: "denied",
    code: kind,
    message: map[kind] ?? map.server,
    direction: null,
    vehicle: null,
    gate: null,
  };
}

/** Beep patterns: [frequency Hz, duration ms, waveform]. */
export const SOUNDS = {
  ok: [[880, 140, "sine"]],
  warn: [[660, 120, "square"], [660, 120, "square"]],
  dup: [[440, 60, "sine"]],
  deny: [[200, 450, "sawtooth"]],
};

export const VIBRATION = {
  ok: [80],
  warn: [100, 60, 100],
  dup: [30],
  deny: [300, 100, 300],
};

/** Retry only network-level failures (same idempotency key makes retries safe). */
export function isNetworkError(err) {
  if (!err) return false;
  // supabase-js reports a failed fetch as an error with an empty code and a fetch-style message;
  // real database/PostgREST errors always carry a code.
  return err.status === 0 || (!err.code && /fetch|network|load failed/i.test(err.message ?? ""));
}

export function isAuthError(err) {
  return !!err && (err.status === 401 || err.code === "PGRST301" || /jwt/i.test(err.message ?? ""));
}

export function isForbidden(err) {
  return !!err && (err.code === "42501" || /forbidden/i.test(err.message ?? ""));
}
