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
      return { tone: "ok", title: dir === "IN" ? "IN" : "OUT", hold: 5000, sound: "ok" };
    case "warning":
      return { tone: "warn", title: dir === "IN" ? "IN" : "OUT", hold: 4500, sound: "warn" };
    case "duplicate":
      return { tone: "dup", title: "ALREADY SCANNED", hold: 1500, sound: "dup" };
    case "queued":
      return { tone: "queued", title: "SAVED OFFLINE", hold: 4000, sound: "warn" };
    case "report":
      return {
        tone: r.code === "sync_denied" ? "deny" : "warn",
        title: "CHECK OFFLINE SCANS",
        hold: 0,
        sound: "deny",
      };
    default:
      return { tone: "deny", title: "DENIED", hold: 5000, sound: "deny" };
  }
}

/** Display registration details without substituting invented vehicle data. */
export function resultVehicleDetails(vehicle) {
  const proper = (value) =>
    String(value ?? "").trim().toLocaleLowerCase().replace(
      /\b\p{L}/gu,
      (letter) => letter.toLocaleUpperCase(),
    );
  const types = {
    car: "Car (Sedan / Hatchback)",
    suv: "SUV / Crossover",
    van: "Van / MPV",
    truck: "Pickup / Truck",
    motorcycle: "Motorcycle / Scooter",
    tricycle: "Tricycle / Three-Wheeler",
    other: "Other",
  };
  return {
    type: types[vehicle?.vehicle_type] ?? (proper(vehicle?.vehicle_type) || "Not provided"),
    color: proper(vehicle?.color) || "Not provided",
    category: proper(vehicle?.category),
  };
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
  return err.status === 0 ||
    (!err.code && /fetch|network|load failed|abort|timed? ?out/i.test(err.message ?? ""));
}

export function isAuthError(err) {
  return !!err && (err.status === 401 || err.code === "PGRST301" || /jwt/i.test(err.message ?? ""));
}

export function isForbidden(err) {
  return !!err && (err.code === "42501" || /forbidden/i.test(err.message ?? ""));
}

/** The result shown when a scan could not be sent and was saved on the phone instead. */
export function queuedResult(gateName) {
  return {
    result: "queued",
    code: "queued",
    message:
      "Not verified. Check the vehicle yourself. This scan is saved and will sync when you are back online.",
    direction: null,
    vehicle: null,
    gate: gateName ? { name: gateName } : null,
  };
}

/** What to tell the guard about the offline queue. Pure, so it is unit-tested. */
export function syncBarState(
  {
    online,
    pending = 0,
    failed = 0,
    others = 0,
    syncing = false,
    syncedJustNow = 0,
    nearExpiry = false,
    stopped = null,
    degraded = false,
  },
) {
  const plural = (n) => `${n} scan${n === 1 ? "" : "s"}`;
  const parts = [];
  const rank = { ok: 0, info: 1, warn: 2, error: 3 };
  let tone = "info";
  const raise = (t) => {
    if (rank[t] > rank[tone]) tone = t;
  };
  let canSync = false;
  let canRetry = false;
  if (degraded && !online) {
    parts.push("This device cannot save scans offline. Do not close this page.");
    raise("error");
  }
  if (syncing) {
    parts.push(`Syncing ${plural(pending)}…`);
  } else if (pending > 0) {
    if (!online) {
      parts.push(`Offline. ${plural(pending)} saved on this device.`);
      raise("warn");
    } else if (stopped === "auth") {
      parts.push(`Sign in again to send ${plural(pending)} saved on this device.`);
      raise("error");
    } else if (stopped === "forbidden") {
      parts.push(`This account cannot send ${plural(pending)}. Ask an administrator.`);
      raise("error");
    } else {
      parts.push(`${plural(pending)} waiting to sync.`);
      raise("warn");
      canSync = true;
    }
    if (nearExpiry) {
      parts.push(
        "Some are close to the age limit; sync soon or the time will be set to the sync time.",
      );
      raise("error");
    }
  } else if (!online && !degraded) {
    parts.push("Offline. Scans will be saved on this device.");
    raise("warn");
  } else if (syncedJustNow > 0) {
    parts.push(`${plural(syncedJustNow)} synced.`);
    tone = "ok";
  }
  if (failed > 0) {
    parts.push(`${plural(failed)} could not be sent.`);
    raise("error");
    canRetry = true;
  }
  if (others > 0) {
    parts.push(`${plural(others)} from another user are saved here and sync when they sign in.`);
  }
  return { text: parts.join(" "), tone, canSync, canRetry, visible: parts.length > 0 };
}
