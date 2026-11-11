// Live alerts for the admin dashboard:
//  * Supabase Realtime pushes new registrations to this open page instantly.
//  * Web Push (via the service worker) reaches admins whose dashboard is closed.
//  * Both play a loud 3x sound while a page is open; both are de-duplicated.
import { audioReady, isMuted, playAlert, setMuted, unlockAudio } from "../alert-sound.js";
import {
  currentSubscription,
  disablePush,
  enableAdminPush,
  permission,
  pushSupport,
  REASON_TEXT,
  sendAdminTest,
  showLocalNotification,
} from "../notify.js";
import { h, toast } from "./util.js";

const DEDUPE_MS = 60_000;
const POLL_MS = 30_000;

export function start(ctx) {
  const seen = new Map(); // key -> time, so Realtime + push for the same event sound once
  const state = { live: "connecting" };
  let lastTestSound = -Infinity;
  async function playTestSound() {
    const now = performance.now();
    if (now - lastTestSound < 5000) return;
    lastTestSound = now;
    const result = await playAlert("test");
    if (result < 0) {
      toast("Tap Test the sound to enable notification audio in this browser.", "error");
    }
  }

  const css = h("link", {
    rel: "stylesheet",
    href: new URL("../../css/alerts.css", import.meta.url).href,
  });
  document.head.append(css);

  // ------------------------------------------------------------ announcing
  function fresh(key) {
    const now = Date.now();
    for (const [k, t] of seen) if (now - t > DEDUPE_MS) seen.delete(k);
    if (seen.has(key)) return false;
    seen.set(key, now);
    return true;
  }

  async function announceNew({ id, plate, category }) {
    if (!fresh(`new:${id ?? plate ?? "generic"}`)) return;
    const what = plate ? `${plate}${category ? ` (${category})` : ""}` : "A vehicle";
    const t = toast(`New registration: ${what} is waiting for approval`, "ok");
    t?.addEventListener?.("click", () => (location.hash = "#/pending"));
    playAlert("new_registration");
    if (document.hidden) {
      showLocalNotification({
        title: "New registration",
        body: `${what} is waiting for approval`,
        tag: id ? `new-${id}` : "new-registration",
        url: "admin/#/pending",
      });
    }
    await ctx.refreshBadge?.();
    refreshIfIdle();
  }

  /** Re-render the current page, unless that would interrupt typing or an open dialog. */
  function refreshIfIdle() {
    const busy = document.querySelector("dialog[open]") ||
      document.activeElement?.matches?.("input, textarea, select");
    if (!busy) dispatchEvent(new CustomEvent("skpass:refresh"));
  }

  // ------------------------------------------------------------ realtime
  const channel = ctx.sb.channel("admin-vehicles")
    .on("postgres_changes", { event: "*", schema: "public", table: "vehicles" }, (p) => {
      if (p.eventType === "INSERT" && p.new?.status === "pending") {
        announceNew({ id: p.new.id, plate: p.new.plate, category: p.new.category });
      } else {
        // someone else approved/rejected/edited: keep numbers and lists current, quietly
        ctx.refreshBadge?.();
        refreshIfIdle();
      }
    })
    .subscribe((status) => {
      state.live = status === "SUBSCRIBED" ? "live" : status === "CLOSED" ? "closed" : "problem";
      paint();
    });
  addEventListener("pagehide", () => ctx.sb.removeChannel(channel));

  // Fallback: if the live connection is not up, notice new registrations by polling the count.
  let lastPending = ctx.badge?.pending ?? 0;
  setInterval(async () => {
    if (document.hidden || state.live === "live") {
      lastPending = ctx.badge?.pending ?? lastPending;
      return;
    }
    await ctx.refreshBadge?.();
    const now = ctx.badge?.pending ?? 0;
    if (now > lastPending) announceNew({ id: `poll-${now}` });
    lastPending = now;
  }, POLL_MS);

  // ------------------------------------------------------------ service-worker messages
  navigator.serviceWorker?.addEventListener("message", (e) => {
    const m = e.data;
    if (m?.type === "skpass-resubscribe") syncPush(true);
    if (m?.type !== "skpass-push") return;
    if (m.kind === "new_registration") announceNew({ id: m.vehicle_id });
    else if (m.kind === "test") {
      playTestSound();
      toast("Test notification received on this device.");
    }
  });

  // ------------------------------------------------------------ the bell widget
  const els = {};
  const bell = h(
    "button",
    {
      class: "al-bell",
      type: "button",
      "aria-label": "Alerts and notifications",
      "aria-expanded": "false",
    },
    "🔔",
    els.dot = h("span", { class: "al-dot", hidden: true }),
  );
  const live = (els.live = h("p", { class: "al-live" }));
  const soundBox = h("input", { type: "checkbox", id: "al-sound" });
  soundBox.checked = !isMuted();
  const pushStatus = (els.pushStatus = h("p", { class: "al-sub" }));
  const pushBtn =
    (els.pushBtn = h("button", { class: "al-btn", type: "button" }, "Turn on notifications"));
  const testPush = (els.testPush = h(
    "button",
    { class: "al-btn ghost", type: "button", hidden: true },
    "Send a test notification",
  ));
  const panel = h(
    "div",
    { class: "al-panel", role: "dialog", "aria-label": "Alerts", hidden: true },
    h("h3", {}, "Alerts"),
    live,
    h(
      "label",
      { class: "al-row", for: "al-sound" },
      soundBox,
      h("span", {}, "Loud alert sound (plays 3×) while SKPass is open"),
    ),
    h("button", {
      class: "al-btn ghost",
      type: "button",
      onclick: async () => {
        await unlockAudio();
        const r = await playAlert("new_registration", { force: true });
        if (r < 0) {
          toast(
            "Your browser is blocking sound. Tap anywhere on the page, then try again.",
            "error",
          );
        }
      },
    }, "▶ Test the sound"),
    h("hr"),
    h("p", { class: "al-title" }, "Notifications on this device"),
    pushStatus,
    pushBtn,
    testPush,
    h(
      "p",
      { class: "al-note" },
      "When SKPass is closed, your phone or computer plays its own notification sound. A web page cannot change that sound or make it louder.",
    ),
  );
  const wrap = h("div", { class: "al-wrap" }, panel, bell);
  const header = document.querySelector("skpass-header");
  if (header) {
    wrap.slot = "header-actions";
    wrap.classList.add("al-header");
    header.append(wrap);
  } else document.body.append(wrap);

  bell.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    bell.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) syncPush();
  });
  document.addEventListener("click", (e) => {
    if (!panel.hidden && !e.composedPath().includes(wrap)) {
      panel.hidden = true;
      bell.setAttribute("aria-expanded", "false");
    }
  });
  soundBox.addEventListener("change", () => {
    setMuted(!soundBox.checked);
    paint();
  });

  function paint() {
    els.live.textContent = state.live === "live"
      ? "● Live: new registrations appear instantly"
      : state.live === "connecting"
      ? "○ Connecting…"
      : "○ Not live right now. Checking every 30 seconds.";
    els.live.dataset.state = state.live;
    els.dot.hidden = !(isMuted() || (!audioReady() && false));
    bell.title = isMuted() ? "Alert sound is off" : "Alerts";
  }

  async function syncPush(quiet = false) {
    const s = pushSupport();
    if (!s.supported) {
      els.pushStatus.textContent = REASON_TEXT[s.reason] ?? "Not supported here.";
      els.pushBtn.hidden = true;
      els.testPush.hidden = true;
      return;
    }
    const sub = await currentSubscription();
    const perm = permission();
    if (perm === "denied") {
      els.pushStatus.textContent =
        "Blocked. Allow notifications for this site in your browser settings, then reload.";
      els.pushBtn.hidden = true;
      els.testPush.hidden = true;
      return;
    }
    const on = perm === "granted" && !!sub;
    els.pushStatus.textContent = on ? "✓ On for this device" : "Off for this device";
    els.pushBtn.textContent = on ? "Turn off" : "Turn on notifications";
    els.pushBtn.hidden = false;
    els.testPush.hidden = !on;
    // The browser may have rotated its subscription: silently re-register it.
    if (on && !quiet) tokenThen((t) => enableAdminPush(t));
    else if (on && quiet) tokenThen((t) => enableAdminPush(t));
  }

  async function tokenThen(fn) {
    const { data: { session } } = await ctx.sb.auth.getSession();
    return session ? fn(session.access_token) : null;
  }

  pushBtn.addEventListener("click", async () => {
    pushBtn.disabled = true;
    try {
      const sub = await currentSubscription();
      if (sub && permission() === "granted") {
        await tokenThen((t) => disablePush({ audience: "admin" }, t));
        toast("Notifications turned off for this device.");
      } else {
        const r = await tokenThen((t) => enableAdminPush(t));
        if (r?.ok) toast("Notifications are on. You will be told about new registrations.");
        else {toast(
            ERRORS[r?.error] ?? "Could not turn on notifications. Please try again.",
            "error",
          );}
      }
    } finally {
      pushBtn.disabled = false;
      syncPush(true);
    }
  });
  testPush.addEventListener("click", async () => {
    // Unlock during the click, before the asynchronous server request loses the user gesture.
    await unlockAudio();
    testPush.disabled = true;
    let r;
    try {
      r = await tokenThen((t) => sendAdminTest(t));
    } finally {
      testPush.disabled = false;
    }
    if (r?.ok && r.sent > 0) {
      await playTestSound();
      toast("Test sent. It should arrive in a moment.");
    } else if (r?.ok) {
      toast(
        "The push service did not accept it. Try turning notifications off and on again.",
        "error",
      );
    } else toast("Could not send the test.", "error");
  });

  paint();
  syncPush(true);
  return { announceNew, state };
}

const ERRORS = {
  denied: "Notifications are blocked. Allow them for this site in your browser settings.",
  "ios-install": REASON_TEXT["ios-install"],
  unsupported_push_service: "This browser's push service is not supported.",
  network: "No connection. Try again.",
};
