// Offline scan queue for the guard scanner.
//
// When the phone cannot reach the server, scans are saved here with their idempotency key and the
// time they happened, then replayed (oldest first, one at a time) once the connection is back.
// Because the server treats the idempotency key as the identity of a scan, a replay that was
// already processed (e.g. the response was lost) returns the original result instead of recording
// the scan twice.
//
// Storage is injected so the logic can be unit-tested; idbStore() is the real browser storage.

const EMPTY = () => ({ items: [], history: [] });
export const HISTORY_LIMIT = 50;
export const MAX_ATTEMPTS = 5;

/** In-memory store (tests, and the fallback when IndexedDB is unavailable). */
export function memoryStore() {
  let state = EMPTY();
  return {
    kind: "memory",
    update(fn) {
      const next = fn(structuredClone(state));
      if (next) state = structuredClone(next);
      return Promise.resolve(structuredClone(state));
    },
    read: () => Promise.resolve(structuredClone(state)),
  };
}

/**
 * IndexedDB store. The whole queue state lives in one record and every change is a single
 * readwrite transaction, which IndexedDB serialises across tabs: two open scanner tabs cannot
 * lose each other's writes.
 */
export function idbStore(name = "skpass-offline") {
  const open = () =>
    new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) return reject(new Error("no indexedDB"));
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore("state");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  const run = async (mutate) => {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction("state", "readwrite");
        const os = tx.objectStore("state");
        const get = os.get("q");
        let out;
        get.onsuccess = () => {
          const cur = get.result ?? EMPTY();
          const next = mutate ? mutate(cur) : null;
          out = next ?? cur;
          if (next) os.put(next, "q");
        };
        tx.oncomplete = () => resolve(out);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error("aborted"));
      });
    } finally {
      db.close();
    }
  };
  return { kind: "indexeddb", update: (fn) => run(fn), read: () => run(null) };
}

/** Try IndexedDB; if it is unusable (private mode, blocked), fall back to memory and say so. */
export async function openStore() {
  try {
    const s = idbStore();
    await s.read();
    return s;
  } catch {
    const s = memoryStore();
    s.degraded = true; // scans queued now would be lost if the page closes
    return s;
  }
}

export function createQueue(store, { now = () => new Date(), maxAttempts = MAX_ATTEMPTS } = {}) {
  const byTime = (a, b) => (a.scanned_at < b.scanned_at ? -1 : a.scanned_at > b.scanned_at ? 1 : 0);
  return {
    store,

    /** Save a scan that could not be sent. Returns the stored item. */
    async add({ key, token, gate_id, gate_name = null, user_id, scanned_at }) {
      const item = {
        key,
        token,
        gate_id,
        gate_name,
        user_id,
        scanned_at: scanned_at ?? now().toISOString(),
        status: "pending",
        attempts: 0,
        last_error: null,
      };
      await store.update((s) => {
        if (!s.items.some((i) => i.key === key)) s.items.push(item); // never queue one key twice
        return s;
      });
      return item;
    },

    /** Pending items for this user, oldest first (order matters for IN/OUT). */
    async pending(userId) {
      const s = await store.read();
      return s.items.filter((i) => i.status === "pending" && i.user_id === userId).sort(byTime);
    },

    async counts(userId) {
      const s = await store.read();
      const mine = s.items.filter((i) => i.user_id === userId);
      return {
        pending: mine.filter((i) => i.status === "pending").length,
        failed: mine.filter((i) => i.status === "failed").length,
        others: s.items.filter((i) => i.user_id !== userId && i.status === "pending").length,
        oldest: mine.filter((i) => i.status === "pending").sort(byTime)[0]?.scanned_at ?? null,
      };
    },

    /** Remove a delivered item and keep a short outcome history for the guard to review. */
    async done(key, outcome) {
      await store.update((s) => {
        s.items = s.items.filter((i) => i.key !== key);
        if (outcome) {
          s.history.unshift({ ...outcome, at: now().toISOString() });
          s.history.length = Math.min(s.history.length, HISTORY_LIMIT);
        }
        return s;
      });
    },

    /** A non-network failure. After maxAttempts the item is parked as 'failed' so it cannot block
     *  everything behind it forever. */
    async attempted(key, message) {
      let parked = false;
      await store.update((s) => {
        const it = s.items.find((i) => i.key === key);
        if (it) {
          it.attempts += 1;
          it.last_error = String(message ?? "").slice(0, 200);
          if (it.attempts >= maxAttempts) {
            it.status = "failed";
            parked = true;
          }
        }
        return s;
      });
      return parked;
    },

    async failedItems(userId) {
      const s = await store.read();
      return s.items.filter((i) => i.status === "failed" && i.user_id === userId).sort(byTime);
    },

    async retryFailed(userId) {
      await store.update((s) => {
        for (const i of s.items) {
          if (i.user_id === userId && i.status === "failed") {
            i.status = "pending";
            i.attempts = 0;
          }
        }
        return s;
      });
    },

    async history() {
      return (await store.read()).history;
    },
  };
}

/**
 * Replay a user's queued scans, oldest first, strictly one at a time.
 * `send(item)` must resolve to one of:
 *   { kind: "result", data }   the server decided (ok / warning / duplicate / denied / replayed)
 *   { kind: "network" }        could not reach the server: stop, try again later
 *   { kind: "auth" }           session problem: stop, the guard must sign in
 *   { kind: "forbidden" }      this account may not scan: stop
 *   { kind: "error", message } anything else: count an attempt, keep going
 */
export async function syncQueue(queue, userId, send, { onItem } = {}) {
  const summary = {
    sent: 0,
    ok: 0,
    warnings: [],
    denied: [],
    duplicates: 0,
    replayed: 0,
    parked: 0,
    stopped: null,
  };
  for (const item of await queue.pending(userId)) {
    const r = await send(item);
    if (r.kind === "network" || r.kind === "auth" || r.kind === "forbidden") {
      summary.stopped = r.kind;
      break;
    }
    if (r.kind === "error") {
      if (await queue.attempted(item.key, r.message)) summary.parked += 1;
      continue;
    }
    const d = r.data ?? {};
    const outcome = {
      key: item.key,
      scanned_at: item.scanned_at,
      result: d.result ?? "unknown",
      code: d.code ?? null,
      direction: d.direction ?? null,
      plate: d.vehicle?.plate ?? null,
      owner: d.vehicle?.owner_name ?? null,
      gate: d.gate?.name ?? item.gate_name ?? null,
      message: d.message ?? null,
    };
    await queue.done(item.key, outcome);
    summary.sent += 1;
    if (d.replayed) summary.replayed += 1;
    if (d.result === "ok") summary.ok += 1;
    else if (d.result === "warning") summary.warnings.push(outcome);
    else if (d.result === "duplicate") summary.duplicates += 1;
    else summary.denied.push(outcome); // denied or anything unexpected: needs a human
    onItem?.(outcome);
  }
  return summary;
}

/** Whether anything in a sync summary needs the guard's attention. */
export function needsAttention(s) {
  return s.denied.length > 0 || s.warnings.length > 0 || s.parked > 0;
}

/** Items older than this will have their timestamp replaced by the server clock (see the
 *  offline_max_age_hours setting), so warn before that happens. */
export function isNearExpiry(oldestIso, maxAgeHours = 72, now = Date.now()) {
  if (!oldestIso) return false;
  return now - new Date(oldestIso).getTime() > maxAgeHours * 3600_000 * 0.8;
}
