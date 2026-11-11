// Service worker: caches the static app shell only.
// Supabase / Turnstile (cross-origin) requests are never cached.
const CACHE = "skpass-shell-v23";
const SHELL = [
  "./",
  "./index.html",
  "./css/base.css",
  "./css/portal.css",
  "./js/config.js",
  "./js/pwa.js",
  "./js/footer.js",
  "./js/form-controls.js",
  "./js/calendar.js",
  "./css/form-controls.css",
  "./js/header.js",
  "./css/header.css",
  "./css/fonts.css",
  "./css/tw/home.css",
  "./css/tw/my-qr.css",
  "./css/tw/register.css",
  "./css/tw/find.css",
  "./css/background.css",
  "./css/footer.css",
  "./css/radii.css",
  "./css/theme.css",
  "./css/qr-modal.css",
  "./js/qr-modal.js",
  "./css/control-shapes.css",
  "./js/background.js",
  "./manifest.webmanifest",
  "./icons/logo.png",
  "./icons/logo.webp",
  "./fonts/plus-jakarta-sans-var.woff2",
  "./fonts/space-grotesk-var.woff2",
  "./fonts/jetbrains-mono-var.woff2",
  "./icons/icon-192.png",
  "./icons/favicon-32.png",
  // Guard scanner: must open and keep working with no connection.
  "./scan/",
  "./scan/index.html",
  "./css/scan.css",
  "./css/scanner-workspace.css",
  "./js/scan.js",
  "./js/scan-ui.js",
  "./js/offline-queue.js",
  "./js/alert-sound.js",
  "./js/auth.js",
  "./js/vendor/supabase.js",
  "./js/vendor/jsQR.js",
];

self.addEventListener("install", (event) => {
  // Tolerant precache: one missing file must not stop the whole worker from installing.
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  // Network first, fall back to cache (keeps the app fresh, works offline).
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: true }).then((hit) =>
          hit || (req.mode === "navigate" ? caches.match("./index.html") : Response.error())
        )
      ),
  );
});

// ---------------------------------------------------------------- Web Push
// A push arrives even when no SKPass page is open. We always show a notification (browsers
// require it), keep it on screen until acted on, and ask any open page to play the alert sound,
// because a service worker cannot play audio itself.
const PUSH_ICON = "./icons/icon-192.png";

/** Only same-scope URLs are ever opened, whatever the payload says. */
function scopedUrl(raw) {
  const scope = self.registration.scope;
  try {
    const u = new URL(String(raw || "./"), scope);
    return u.href.startsWith(scope) ? u.href : scope;
  } catch {
    return scope;
  }
}

self.addEventListener("push", (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = { body: event.data ? event.data.text() : "" };
  }
  const title = String(d.title || "SKPass").slice(0, 80);
  const body = String(d.body || "").slice(0, 200);
  const options = {
    body,
    icon: PUSH_ICON,
    badge: PUSH_ICON,
    tag: String(d.tag || "skpass").slice(0, 60),
    renotify: true, // alert again even when replacing a notification with the same tag
    requireInteraction: true, // stay until the person taps or dismisses it
    vibrate: [500, 200, 500, 200, 500], // three long buzzes (Android)
    timestamp: Date.now(),
    data: {
      url: scopedUrl(d.url),
      kind: d.kind || null,
      status: d.status || null,
      vehicle_id: d.vehicle_id || null,
    },
  };
  event.waitUntil((async () => {
    await self.registration.showNotification(title, options);
    const pages = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of pages) {
      c.postMessage({
        type: "skpass-push",
        kind: d.kind || null,
        status: d.status || null,
        vehicle_id: d.vehicle_id || null,
        title,
        body,
      });
    }
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || self.registration.scope;
  event.waitUntil((async () => {
    const pages = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const path = new URL(target).pathname;
    // Reuse a tab that is already on that page; never navigate away from some other page
    // (the person might be in the middle of a form).
    const same = pages.find((c) => new URL(c.url).pathname === path);
    if (same) {
      await same.focus();
      if (same.url !== target && "navigate" in same) await same.navigate(target).catch(() => {});
      return;
    }
    await self.clients.openWindow(target);
  })());
});

// The browser may rotate a subscription; open pages re-register themselves.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.clients.matchAll({ includeUncontrolled: true }).then((pages) =>
      pages.forEach((c) => c.postMessage({ type: "skpass-resubscribe" }))
    ),
  );
});
