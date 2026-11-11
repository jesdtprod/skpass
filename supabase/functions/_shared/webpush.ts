// Web Push (RFC 8030 delivery, RFC 8291 message encryption "aes128gcm", RFC 8292 VAPID) using only
// the standard Web Crypto API, so it runs unchanged in Supabase Edge Functions.

const enc = new TextEncoder();
type Bytes = Uint8Array<ArrayBuffer>;

export const b64u = {
  encode(buf: ArrayBuffer | Uint8Array): string {
    const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = "";
    for (const x of b) s += String.fromCharCode(x);
    return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  },
  decode(s: string): Bytes {
    const p = s.replaceAll("-", "+").replaceAll("_", "/");
    const bin = atob(p + "=".repeat((4 - (p.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  },
};

export interface PushKeys {
  p256dh: string;
  auth: string;
}
export interface PushSub extends PushKeys {
  endpoint: string;
}
export interface Vapid {
  publicKey: string; // base64url, 65-byte uncompressed P-256 point
  privateKey: string; // base64url, 32-byte scalar (JWK "d")
  subject: string; // https: or mailto: contact URL
}

// ------------------------------------------------------------------ endpoint safety
// The server will POST to whatever endpoint a client registers, so accept only the real push
// services (otherwise this would be a way to make our server call arbitrary URLs).
const ALLOWED_HOSTS: RegExp[] = [
  /^fcm\.googleapis\.com$/, // Chrome, Edge, Brave, Opera, Android
  /^updates\.push\.services\.mozilla\.com$/, // Firefox
  /\.push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/, // Safari / iOS home-screen apps
  /\.push\.apple\.com$/,
  /^[a-z0-9.-]+\.notify\.windows\.com$/, // legacy Edge / Windows
];

export function isAllowedEndpoint(raw: unknown): boolean {
  if (typeof raw !== "string" || raw.length > 1000) return false;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && !u.username && !u.password &&
      (u.port === "" || u.port === "443") &&
      ALLOWED_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

/** A subscription's keys must be a 65-byte P-256 point and a 16-byte auth secret. */
export function validKeys(k: unknown): k is PushKeys {
  if (!k || typeof k !== "object") return false;
  const { p256dh, auth } = k as Record<string, unknown>;
  if (typeof p256dh !== "string" || typeof auth !== "string") return false;
  if (!/^[A-Za-z0-9_-]+$/.test(p256dh) || !/^[A-Za-z0-9_-]+$/.test(auth)) return false;
  try {
    const pub = b64u.decode(p256dh);
    return pub.length === 65 && pub[0] === 4 && b64u.decode(auth).length === 16;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ VAPID (RFC 8292)
function importVapidPrivate(v: Vapid): Promise<CryptoKey> {
  const pub = b64u.decode(v.publicKey);
  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    x: b64u.encode(pub.slice(1, 33)),
    y: b64u.encode(pub.slice(33, 65)),
    d: v.privateKey,
    ext: true,
  };
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
  ]);
}

export async function vapidAuthHeader(
  endpoint: string,
  v: Vapid,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const header = b64u.encode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u.encode(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: nowSeconds + 12 * 3600, // push services reject anything beyond 24 h
    sub: v.subject,
  })));
  const input = `${header}.${claims}`;
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    await importVapidPrivate(v),
    enc.encode(input),
  ); // Web Crypto returns the raw r||s form that JWT ES256 requires
  return `vapid t=${input}.${b64u.encode(sig)}, k=${v.publicKey}`;
}

// ------------------------------------------------------------------ encryption (RFC 8291)
const concat = (...parts: Bytes[]): Bytes => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

async function hkdf(
  salt: Bytes,
  ikm: Bytes,
  info: Bytes,
  bytes: number,
): Promise<Bytes> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8),
  );
}

export const MAX_PLAINTEXT = 3800; // one 4096-byte record, leaving room for header and tag

/** Encrypts `plaintext` for one subscription. Optional `salt`/`asKeys` are for tests only. */
export async function encryptPayload(
  keys: PushKeys,
  plaintext: Bytes,
  test?: { salt?: Bytes; asKeys?: CryptoKeyPair },
): Promise<Bytes> {
  if (plaintext.length > MAX_PLAINTEXT) throw new Error("payload too large");
  const uaPublic = b64u.decode(keys.p256dh);
  const authSecret = b64u.decode(keys.auth);

  const asKeys = test?.asKeys ??
    await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", asKeys.publicKey));
  const uaKey = await crypto.subtle.importKey(
    "raw",
    uaPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ecdh = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asKeys.privateKey, 256),
  );

  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdh, keyInfo, 32);
  const salt = test?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const body = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      aes,
      concat(plaintext, new Uint8Array([2])),
    ),
  ); // 0x02 = last-record delimiter

  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096);
  return concat(salt, recordSize, new Uint8Array([asPublic.length]), asPublic, body);
}

// ------------------------------------------------------------------ sending
export interface SendResult {
  status: number; // 0 = network error / timeout
  ok: boolean;
  gone: boolean; // the subscription no longer exists: delete it
}

export async function sendPush(
  sub: PushSub,
  payload: unknown,
  vapid: Vapid,
  opts: { ttl?: number; urgency?: "very-low" | "low" | "normal" | "high"; fetchFn?: typeof fetch } =
    {},
): Promise<SendResult> {
  try {
    const body = await encryptPayload(sub, enc.encode(JSON.stringify(payload)));
    const res = await (opts.fetchFn ?? fetch)(sub.endpoint, {
      method: "POST",
      headers: {
        Authorization: await vapidAuthHeader(sub.endpoint, vapid),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(opts.ttl ?? 86400),
        Urgency: opts.urgency ?? "high",
      },
      body,
      signal: AbortSignal.timeout(8000),
    });
    await res.body?.cancel();
    return {
      status: res.status,
      ok: res.status >= 200 && res.status < 300,
      gone: res.status === 404 || res.status === 410,
    };
  } catch {
    return { status: 0, ok: false, gone: false };
  }
}
