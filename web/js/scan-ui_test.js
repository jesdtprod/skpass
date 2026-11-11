import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  describeFailure,
  describeResult,
  isAuthError,
  isForbidden,
  isNetworkError,
  isToken,
  resultVehicleDetails,
} from "./scan-ui.js";

Deno.test("result vehicle details use readable labels without inventing missing values", () => {
  assertEquals(
    resultVehicleDetails({ vehicle_type: "motorcycle", color: "black", category: "employee" }),
    {
      type: "Motorcycle / Scooter",
      color: "Black",
      category: "Employee",
    },
  );
  assertEquals(
    resultVehicleDetails({ vehicle_type: "suv", color: "light blue", category: "visitor" }),
    {
      type: "SUV / Crossover",
      color: "Light Blue",
      category: "Visitor",
    },
  );
  assertEquals(resultVehicleDetails(null), {
    type: "Not provided",
    color: "Not provided",
    category: "",
  });
});

Deno.test("isToken accepts the 22-char token and rejects anything else", () => {
  assert(isToken("wpnZ3aUdNTMBQUHqES0NzQ"));
  assert(isToken("  wpnZ3aUdNTMBQUHqES0NzQ  "));
  assert(!isToken("https://evil.example/x"));
  assert(!isToken("short"));
  assert(!isToken("a".repeat(65)));
  assert(!isToken(null));
  assert(!isToken("SMP-1001 owner name"));
});

Deno.test("describeResult maps every server result", () => {
  assertEquals(describeResult({ result: "ok", direction: "IN" }).title, "IN");
  assertEquals(describeResult({ result: "ok", direction: "OUT" }).tone, "ok");
  assertEquals(describeResult({ result: "warning", direction: "IN" }).tone, "warn");
  assertEquals(describeResult({ result: "duplicate", direction: "IN" }).tone, "dup");
  assertEquals(describeResult({ result: "denied" }).tone, "deny");
  assertEquals(describeResult({ result: "something-new" }).tone, "deny"); // fail closed (red)
});

Deno.test("describeFailure is always a denied-style result", () => {
  for (const k of ["notQr", "offline", "forbidden", "session", "server", "unknown"]) {
    const f = describeFailure(k);
    assertEquals(f.result, "denied");
    assert(f.message.length > 0);
  }
});

Deno.test("error classification", () => {
  assert(isNetworkError({ message: "TypeError: Failed to fetch", code: "" }));
  assert(isNetworkError({ message: "Load failed" }));
  assert(!isNetworkError({ message: "permission denied", code: "42501" }));
  assert(!isNetworkError(null));
  assert(isForbidden({ code: "42501", message: "forbidden" }));
  assert(isAuthError({ code: "PGRST301", message: "x" }));
  assert(isAuthError({ message: "JWT expired" }));
  assert(!isAuthError({ code: "P0001", message: "invalid idempotency key" }));
});

import { queuedResult, syncBarState } from "./scan-ui.js";

Deno.test("queued results look like a warning, never like an approval", () => {
  const q = queuedResult("Main Gate");
  const d = describeResult(q);
  assertEquals(d.tone, "queued");
  assertEquals(d.title, "SAVED OFFLINE");
  assert(q.vehicle === null && q.direction === null); // nothing was verified
  assert(/not verified/i.test(q.message));
});

Deno.test("abort/timeout counts as a network failure (so the scan is queued, not lost)", () => {
  assert(isNetworkError({ message: "AbortError: signal is aborted without reason", code: "" }));
  assert(isNetworkError({ message: "Request timed out", code: "" }));
  assert(!isNetworkError({ message: "timed out", code: "57014" })); // real DB error is not offline
});

Deno.test("report overlay is red when something was denied", () => {
  assertEquals(describeResult({ result: "report", code: "sync_denied" }).tone, "deny");
  assertEquals(describeResult({ result: "report", code: "sync_warn" }).tone, "warn");
  assertEquals(describeResult({ result: "report", code: "sync_denied" }).hold, 0); // stays until tapped
});

Deno.test("sync bar: nothing to say when online and empty", () => {
  assertEquals(syncBarState({ online: true }).visible, false);
});

Deno.test("sync bar: offline with saved scans", () => {
  const s = syncBarState({ online: false, pending: 3 });
  assert(s.visible && /Offline\. 3 scans saved/.test(s.text) && s.tone === "warn" && !s.canSync);
});

Deno.test("sync bar: online with a backlog offers Sync now; singular wording", () => {
  const s = syncBarState({ online: true, pending: 1 });
  assert(s.canSync && /1 scan waiting/.test(s.text));
});

Deno.test("sync bar: session expired and forbidden are explained and not retryable", () => {
  const a = syncBarState({ online: true, pending: 2, stopped: "auth" });
  assert(/Sign in again/.test(a.text) && !a.canSync && a.tone === "error");
  const f = syncBarState({ online: true, pending: 2, stopped: "forbidden" });
  assert(/cannot send/.test(f.text) && !f.canSync);
});

Deno.test("sync bar: failures, near-expiry, other users and in-memory storage are surfaced", () => {
  assert(syncBarState({ online: true, failed: 2 }).canRetry);
  assert(/age limit/.test(syncBarState({ online: true, pending: 1, nearExpiry: true }).text));
  assert(/another user/.test(syncBarState({ online: true, others: 2 }).text));
  const d = syncBarState({ online: false, degraded: true });
  assert(/cannot save scans offline/.test(d.text) && d.tone === "error");
});

Deno.test("sync bar: confirmation after a sync, and syncing state", () => {
  assertEquals(syncBarState({ online: true, syncedJustNow: 4 }).text, "4 scans synced.");
  assert(/Syncing 5 scans/.test(syncBarState({ online: true, pending: 5, syncing: true }).text));
});
