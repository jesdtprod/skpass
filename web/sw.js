// Service worker: caches the static app shell only.
// Supabase / Turnstile (cross-origin) requests are never cached.
const CACHE = "skpass-shell-v11";
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
  "./css/footer.css",
  "./css/radii.css",
  "./css/control-shapes.css",
  "./js/background.js",
  "./manifest.webmanifest",
  "./icons/logo.png",
  "./icons/icon-192.png",
  "./icons/favicon-32.png",
  // Guard scanner: must open and keep working with no connection.
  "./scan/",
  "./scan/index.html",
  "./css/scan.css",
  "./js/scan.js",
  "./js/scan-ui.js",
  "./js/offline-queue.js",
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
