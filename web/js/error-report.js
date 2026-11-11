// Reports unexpected JavaScript errors to the admin "System health" page.
// Privacy: only the error text, stack and page path are sent (never the query string or hash),
// and the server scrubs tokens/emails/numbers again. Loaded by pwa.js, i.e. on every page.
import { SUPABASE_URL } from "./config.js";

const ENDPOINT = `${SUPABASE_URL}/functions/v1/report-error`;
const KNOWN = ["scan", "admin", "login", "register", "find", "my-qr", "reset"];
const MAX_PER_PAGE_LOAD = 5;
const seen = new Set();

function appName() {
  const parts = location.pathname.split("/").filter(Boolean);
  return KNOWN.find((k) => parts.includes(k)) ?? "home";
}

export function report(message, stack) {
  try {
    if (!navigator.onLine) return; // offline errors are expected, and we could not send them
    if (seen.size >= MAX_PER_PAGE_LOAD) return;
    const msg = String(message ?? "").slice(0, 500);
    if (!msg || seen.has(msg)) return;
    seen.add(msg);
    fetch(ENDPOINT, {
      method: "POST",
      mode: "no-cors", // fire-and-forget: we never need the answer
      keepalive: true,
      headers: { "Content-Type": "text/plain" }, // simple request: no preflight
      body: JSON.stringify({
        app: appName(),
        message: msg,
        stack: String(stack ?? "").slice(0, 2000),
        url: location.origin + location.pathname,
      }),
    }).catch(() => {});
  } catch { /* reporting must never throw */ }
}

addEventListener("error", (e) => {
  if (!e.error && /^Script error/i.test(e.message ?? "")) return; // cross-origin noise
  report(e.message || e.error?.message, e.error?.stack);
});
addEventListener("unhandledrejection", (e) => {
  const r = e.reason;
  report(`Unhandled rejection: ${r?.message ?? String(r)}`, r?.stack);
});
