import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { createECDH, randomBytes } from "node:crypto";
import { Buffer } from "node:buffer";
// Independent implementation used as an ORACLE: if it can decrypt what we encrypt, we are
// speaking the standard, not merely agreeing with ourselves.
import ece from "npm:http_ece@1.2.0";
import {
  b64u,
  encryptPayload,
  isAllowedEndpoint,
  MAX_PLAINTEXT,
  sendPush,
  validKeys,
  type Vapid,
  vapidAuthHeader,
} from "./webpush.ts";

function newBrowserSubscription() {
  const ua = createECDH("prime256v1");
  ua.generateKeys();
  const auth = randomBytes(16);
  return {
    ua,
    authSecret: auth,
    keys: { p256dh: b64u.encode(ua.getPublicKey()), auth: b64u.encode(auth) },
  };
}

async function newVapid(): Promise<Vapid> {
  const k = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const jwk = await crypto.subtle.exportKey("jwk", k.privateKey);
  const pub = new Uint8Array(65);
  pub[0] = 4;
  pub.set(b64u.decode(jwk.x!), 1);
  pub.set(b64u.decode(jwk.y!), 33);
  return { publicKey: b64u.encode(pub), privateKey: jwk.d!, subject: "https://example.org/" };
}

Deno.test("endpoint allowlist: real push services only, https only", () => {
  for (
    const ok of [
      "https://fcm.googleapis.com/fcm/send/abc",
      "https://updates.push.services.mozilla.com/wpush/v2/abc",
      "https://web.push.apple.com/QAbc",
      "https://wns2-par02p.notify.windows.com/w/?token=abc",
    ]
  ) assert(isAllowedEndpoint(ok), ok);
  for (
    const bad of [
      "http://fcm.googleapis.com/fcm/send/abc", // not https
      "https://evil.example.com/fcm.googleapis.com",
      "https://fcm.googleapis.com.evil.com/x",
      "https://user:pw@fcm.googleapis.com/x",
      "https://fcm.googleapis.com:8443/x",
      "https://127.0.0.1/x",
      "https://169.254.169.254/latest/meta-data",
      "javascript:alert(1)",
      "not a url",
      "https://fcm.googleapis.com/" + "a".repeat(1100),
      42,
      null,
    ]
  ) assert(!isAllowedEndpoint(bad), String(bad));
});

Deno.test("subscription keys must be a P-256 point and a 16-byte secret", () => {
  const { keys } = newBrowserSubscription();
  assert(validKeys(keys));
  assert(!validKeys({ ...keys, auth: b64u.encode(randomBytes(8)) }));
  assert(!validKeys({ ...keys, p256dh: b64u.encode(randomBytes(65)) })); // first byte not 0x04 (usually)
  assert(!validKeys({ ...keys, p256dh: "!!!" }));
  assert(!validKeys(null));
  assert(!validKeys({ p256dh: keys.p256dh }));
});

Deno.test("encrypted payload is decryptable by an independent implementation (http_ece)", async () => {
  const { ua, authSecret, keys } = newBrowserSubscription();
  const message = JSON.stringify({
    title: "Registration approved",
    body: "Ünïcode ✓ 日本語",
    n: 1,
  });
  const body = await encryptPayload(keys, new TextEncoder().encode(message));
  const plain = ece.decrypt(Buffer.from(body), {
    version: "aes128gcm",
    privateKey: ua,
    authSecret,
  });
  assertEquals(plain.toString("utf8"), message);
});

Deno.test("record header: 16-byte salt, record size 4096, 65-byte sender key", async () => {
  const { keys } = newBrowserSubscription();
  const body = await encryptPayload(keys, new TextEncoder().encode("x"));
  assertEquals(new DataView(body.buffer, body.byteOffset).getUint32(16), 4096);
  assertEquals(body[20], 65);
  assertEquals(body[21], 4); // uncompressed point marker
  assertEquals(body.length, 16 + 4 + 1 + 65 + (1 + 1 + 16)); // payload + delimiter + GCM tag
});

Deno.test("two encryptions of the same message differ (fresh salt and key each time)", async () => {
  const { keys } = newBrowserSubscription();
  const m = new TextEncoder().encode("same");
  const a = await encryptPayload(keys, m);
  const b = await encryptPayload(keys, m);
  assert(b64u.encode(a) !== b64u.encode(b));
});

Deno.test("a different subscriber cannot decrypt (wrong key)", async () => {
  const a = newBrowserSubscription();
  const b = newBrowserSubscription();
  const body = await encryptPayload(a.keys, new TextEncoder().encode("secret"));
  let failed = false;
  try {
    ece.decrypt(Buffer.from(body), {
      version: "aes128gcm",
      privateKey: b.ua,
      authSecret: b.authSecret,
    });
  } catch {
    failed = true;
  }
  assert(failed);
});

Deno.test("oversized payloads are refused", async () => {
  const { keys } = newBrowserSubscription();
  await assertRejects(
    () => encryptPayload(keys, new Uint8Array(MAX_PLAINTEXT + 1)),
    Error,
    "too large",
  );
  await encryptPayload(keys, new Uint8Array(MAX_PLAINTEXT)); // the limit itself is fine
});

Deno.test("VAPID token: ES256 signature verifies, audience/subject/expiry are right", async () => {
  const v = await newVapid();
  const now = 1_800_000_000;
  const header = await vapidAuthHeader("https://fcm.googleapis.com/fcm/send/xyz", v, now);
  const m = header.match(/^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/);
  assert(m, header);
  const [, h, c, s, k] = m;
  assertEquals(k, v.publicKey);
  assertEquals(JSON.parse(new TextDecoder().decode(b64u.decode(h))), { typ: "JWT", alg: "ES256" });
  const claims = JSON.parse(new TextDecoder().decode(b64u.decode(c)));
  assertEquals(claims.aud, "https://fcm.googleapis.com"); // origin only, no path
  assertEquals(claims.sub, "https://example.org/");
  assert(claims.exp > now && claims.exp - now <= 24 * 3600);
  const pubKey = await crypto.subtle.importKey(
    "raw",
    b64u.decode(v.publicKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const sig = b64u.decode(s);
  assertEquals(sig.length, 64); // raw r||s, not DER
  assert(
    await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      pubKey,
      sig,
      new TextEncoder().encode(`${h}.${c}`),
    ),
  );
  // and it must NOT verify for a different message
  assert(
    !(await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      pubKey,
      sig,
      new TextEncoder().encode(`${h}.x${c}`),
    )),
  );
});

Deno.test("sendPush: correct request, and status mapping", async () => {
  const { ua, authSecret, keys } = newBrowserSubscription();
  const vapid = await newVapid();
  const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", ...keys };
  let seen: { url: string; init: RequestInit } | null = null;
  const fake = (status: number) => (url: string | URL | Request, init?: RequestInit) => {
    seen = { url: String(url), init: init! };
    return Promise.resolve(new Response(null, { status }));
  };

  const ok = await sendPush(sub, { title: "Hi" }, vapid, { fetchFn: fake(201) as typeof fetch });
  assertEquals([ok.status, ok.ok, ok.gone], [201, true, false]);
  assertEquals(seen!.url, sub.endpoint);
  const h = seen!.init.headers as Record<string, string>;
  assertEquals(h["Content-Encoding"], "aes128gcm");
  assertEquals(h["TTL"], "86400");
  assertEquals(h["Urgency"], "high");
  assert(h["Authorization"].startsWith("vapid t="));
  const plain = ece.decrypt(Buffer.from(seen!.init.body as Uint8Array), {
    version: "aes128gcm",
    privateKey: ua,
    authSecret,
  });
  assertEquals(JSON.parse(plain.toString("utf8")), { title: "Hi" });

  assertEquals((await sendPush(sub, {}, vapid, { fetchFn: fake(410) as typeof fetch })).gone, true);
  assertEquals((await sendPush(sub, {}, vapid, { fetchFn: fake(404) as typeof fetch })).gone, true);
  const rate = await sendPush(sub, {}, vapid, { fetchFn: fake(429) as typeof fetch });
  assertEquals([rate.ok, rate.gone], [false, false]); // transient: keep the subscription
  const boom = await sendPush(sub, {}, vapid, {
    fetchFn: (() => Promise.reject(new Error("net"))) as typeof fetch,
  });
  assertEquals([boom.status, boom.ok, boom.gone], [0, false, false]);
});
