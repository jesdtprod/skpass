import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  describeFailure,
  describeResult,
  isAuthError,
  isForbidden,
  isNetworkError,
  isToken,
} from "./scan-ui.js";

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
