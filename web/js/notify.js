// Browser side of push notifications: permission, subscribing, and showing a notification.
// The service worker (sw.js) receives pushes; the Edge Functions send them.
import { SUPABASE_ANON_KEY, SUPABASE_URL, VAPID_PUBLIC_KEY } from "./config.js";

const FN = `${SUPABASE_URL}/functions/v1/push-subscribe`;

export function urlBase64ToUint8Array(b64) {
  const p = b64.replaceAll("-", "+").replaceAll("_", "/");
  const bin = atob(p + "=".repeat((4 - (p.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** { supported, reason }. reason explains why not, in terms a person can act on. */
export function pushSupport() {
  const g = globalThis;
  const ua = g.navigator?.userAgent ?? "";
  const ios = /iPad|iPhone|iPod/.test(ua);
  if (ios && !(g.navigator?.standalone || g.matchMedia?.("(display-mode: standalone)").matches)) {
    return { supported: false, reason: "ios-install" }; // iOS only allows push from an installed home-screen app
  }
  if (!g.isSecureContext) return { supported: false, reason: "insecure" };
  if (!("serviceWorker" in (g.navigator ?? {}))) return { supported: false, reason: "no-sw" };
  if (!("PushManager" in g)) return { supported: false, reason: "no-push" };
  if (!("Notification" in g)) return { supported: false, reason: "no-notification" };
  return { supported: true, reason: null };
}

export const REASON_TEXT = {
  "ios-install":
    "On iPhone/iPad, add SKPass to your Home Screen first (Share → Add to Home Screen), then open it from there.",
  insecure: "Notifications need a secure (https) connection.",
  "no-sw": "This browser does not support notifications.",
  "no-push": "This browser does not support push notifications.",
  "no-notification": "This browser does not support notifications.",
};

export const permission = () => ("Notification" in globalThis ? Notification.permission : "denied");

async function registration() {
  return await navigator.serviceWorker.ready;
}

export async function currentSubscription() {
  try {
    return await (await registration()).pushManager.getSubscription();
  } catch {
    return null;
  }
}

async function callServer(body, accessToken) {
  const headers = { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  try {
    const res = await fetch(FN, { method: "POST", headers, body: JSON.stringify(body) });
    let data = {};
    try {
      data = await res.json();
    } catch { /* no body */ }
    return { status: res.status, data };
  } catch {
    return { status: 0, data: { error: "network" } };
  }
}

/** Ask permission (needs a user gesture), subscribe this browser, register it with the server. */
async function subscribe(extra, accessToken) {
  const s = pushSupport();
  if (!s.supported) return { ok: false, error: s.reason };
  if (permission() === "denied") return { ok: false, error: "denied" };
  const perm = permission() === "granted" ? "granted" : await Notification.requestPermission();
  if (perm !== "granted") return { ok: false, error: "denied" };
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with a different server key cannot be reused.
  if (sub) {
    const key = sub.options?.applicationServerKey;
    const mine = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
    if (
      key && (key.byteLength !== mine.length || !new Uint8Array(key).every((b, i) => b === mine[i]))
    ) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  sub ??= await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });
  const r = await callServer(
    { action: "subscribe", subscription: sub.toJSON(), ...extra },
    accessToken,
  );
  return r.status === 201
    ? { ok: true }
    : { ok: false, error: r.data?.error ?? `http_${r.status}` };
}

export const enableAdminPush = (accessToken) => subscribe({ audience: "admin" }, accessToken);
export const enableOwnerPush = (vehicleId, claimSecret) =>
  subscribe({ audience: "owner", vehicle_id: vehicleId, claim_secret: claimSecret });

export async function disablePush(extra, accessToken) {
  const sub = await currentSubscription();
  if (!sub) return { ok: true };
  const r = await callServer({
    action: "unsubscribe",
    subscription: { endpoint: sub.endpoint },
    ...extra,
  }, accessToken);
  await sub.unsubscribe().catch(() => {});
  return { ok: r.status === 200 || r.status === 404 };
}

export async function sendAdminTest(accessToken) {
  const r = await callServer({ action: "test", audience: "admin" }, accessToken);
  return r.status === 200
    ? { ok: true, ...r.data }
    : { ok: false, error: r.data?.error ?? `http_${r.status}` };
}

/** A notification from the page itself (used when the tab is hidden and no push is involved). */
export async function showLocalNotification({ title, body, tag, url }) {
  if (permission() !== "granted") return false;
  try {
    const reg = await registration();
    await reg.showNotification(title, {
      body,
      tag,
      icon: "./icons/icon-192.png",
      badge: "./icons/icon-192.png",
      renotify: true,
      requireInteraction: true,
      vibrate: [500, 200, 500, 200, 500],
      data: { url: new URL(url ?? "./", reg.scope).href },
    });
    return true;
  } catch {
    return false;
  }
}
