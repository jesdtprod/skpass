import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { fingerprint, sanitizeUrl, scrub, validateReport } from "./errors.ts";

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk";
const QR = "wpnZ3aUdNTMBQUHqES0NzQ";
const CLAIM = "fNfT0Dko8_Jv0uVeUBwUDAl9Tp4o8s6jS9FSnx_UXE0";

Deno.test("JWTs, API keys and Turnstile keys never survive", () => {
  const s = scrub(
    `failed with ${JWT} and sb_secret_abcDEF123_x and 0x4EXAMPLEEXAMPLEEXAMPLE1234`,
    500,
  );
  assert(!s.includes("eyJ") && !s.includes("sb_secret") && !s.includes("0x4EXAMPLE"), s);
  assert(s.includes("[jwt]") && s.includes("[key]"));
});

Deno.test("one-time tokens in URLs and query strings are redacted", () => {
  const s = scrub(
    "GET /reset/#access_token=abc.def&refresh_token=xyz&type=recovery?code=123456&x=1",
    500,
  );
  assert(!/access_token=abc|refresh_token=xyz|code=123456/.test(s), s);
  assert(s.includes("access_token=[redacted]") && s.includes("x=1"));
});

Deno.test("QR tokens and claim secrets are redacted", () => {
  const s = scrub(`bad token ${QR} / secret ${CLAIM}`, 500);
  assert(!s.includes(QR) && !s.includes(CLAIM), s);
});

Deno.test("emails and phone-number-like digits are redacted", () => {
  const s = scrub("user stmstarlink@gmail.com phone 09170006001 rejected", 500);
  assert(!s.includes("@gmail") && !s.includes("09170006001"), s);
  assertEquals(s, "user [email] phone [number] rejected");
});

Deno.test("ordinary error text is left alone (no over-redaction)", () => {
  const msg = "TypeError: Cannot read properties of undefined (reading 'plate') at scan.js:123:45";
  assertEquals(scrub(msg, 500), msg);
  assertEquals(
    scrub("offline-queue.js failed after 5 attempts", 500),
    "offline-queue.js failed after 5 attempts",
  );
});

Deno.test("scrub bounds its output length and tolerates non-strings", () => {
  assertEquals(scrub("a".repeat(10_000), 100).length, 100);
  assertEquals(scrub(undefined, 100), "");
  assertEquals(scrub({ a: 1 }, 100), "");
});

Deno.test("sanitizeUrl drops query and hash and rejects non-http", () => {
  assertEquals(
    sanitizeUrl("https://x.github.io/skpass/reset/?plate=ABC#access_token=eyJabc.def.ghi"),
    "https://x.github.io/skpass/reset/",
  );
  assertEquals(sanitizeUrl("javascript:alert(1)"), null);
  assertEquals(sanitizeUrl("not a url"), null);
  assertEquals(sanitizeUrl(42), null);
});

Deno.test("validateReport: normal report is accepted and scrubbed", () => {
  const r = validateReport({
    app: "scan",
    message: `boom ${JWT}`,
    stack: `at x (${QR})`,
    url: "https://a.b/scan/?t=1",
  });
  assert(r.ok);
  if (r.ok) {
    assertEquals(r.value.app, "scan");
    assert(!r.value.message.includes("eyJ") && !r.value.stack!.includes(QR));
    assertEquals(r.value.url, "https://a.b/scan/");
  }
});

Deno.test("validateReport: noise, empty and malformed reports are rejected", () => {
  assert(!validateReport({ message: "Script error." }).ok);
  assert(
    !validateReport({ message: "ResizeObserver loop completed with undelivered notifications." })
      .ok,
  );
  assert(!validateReport({ message: "   " }).ok);
  assert(!validateReport(null).ok);
  assert(!validateReport("x").ok);
});

Deno.test("validateReport: odd app names fall back to 'unknown'", () => {
  const r = validateReport({ app: "../../etc", message: "boom" });
  assert(r.ok && r.value.app === "unknown");
});

Deno.test("fingerprint is stable per (app, message) and differs otherwise", async () => {
  const a = await fingerprint("scan", "boom");
  assertEquals(a, await fingerprint("scan", "boom"));
  assertNotEquals(a, await fingerprint("admin", "boom"));
  assertNotEquals(a, await fingerprint("scan", "bang"));
  assertEquals(a.length, 16);
});
