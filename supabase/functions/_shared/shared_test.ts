import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { claimSecretFor, sha256Hex, timingSafeEqual } from "./crypto.ts";
import { verifyTurnstile } from "./turnstile.ts";
import { sniffImageType } from "./validate.ts";

Deno.test("claim secret is deterministic per key and differs across keys/peppers", async () => {
  const a = await claimSecretFor("pepper", "key-1");
  assertEquals(a, await claimSecretFor("pepper", "key-1"));
  assertNotEquals(a, await claimSecretFor("pepper", "key-2"));
  assertNotEquals(a, await claimSecretFor("other", "key-1"));
  assertEquals(a.length, 43);
  assert(/^[A-Za-z0-9_-]+$/.test(a));
});

Deno.test("sha256 and timingSafeEqual", async () => {
  assertEquals(
    await sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assert(timingSafeEqual("abc", "abc"));
  assert(!timingSafeEqual("abc", "abd"));
  assert(!timingSafeEqual("abc", "abcd"));
});

Deno.test("turnstile: success, rejection, network error and empty token fail closed", async () => {
  const ok = () => Promise.resolve(new Response(JSON.stringify({ success: true })));
  const bad = () => Promise.resolve(new Response(JSON.stringify({ success: false })));
  const boom = () => Promise.reject(new Error("net"));
  assert(await verifyTurnstile("t", "s", "1.2.3.4", ok as typeof fetch));
  assert(!(await verifyTurnstile("t", "s", null, bad as typeof fetch)));
  assert(!(await verifyTurnstile("t", "s", null, boom as typeof fetch)));
  assert(!(await verifyTurnstile("", "s", null, ok as typeof fetch)));
  assert(!(await verifyTurnstile("t", "", null, ok as typeof fetch)));
});

Deno.test("sniffImageType reads magic bytes", () => {
  assertEquals(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assertEquals(
    sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])),
    "image/png",
  );
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  assertEquals(sniffImageType(webp), "image/webp");
  assertEquals(sniffImageType(new TextEncoder().encode("<script>alert(1)</script>")), null);
  assertEquals(sniffImageType(new Uint8Array([])), null);
});
