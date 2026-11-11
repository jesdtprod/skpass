// Live alerts for the admin dashboard:
//  * Supabase Realtime pushes new registrations to this open page instantly.
//  * Web Push (via the service worker) reaches admins whose dashboard is closed.
//  * Both play a loud 3x sound while a page is open; both are de-duplicated.
import { isMuted, playAlert, setMuted, unlockAudio } from "../alert-sound.js";
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
import { fmtTime, h, toast } from "./util.js";

const DEDUPE_MS = 60_000;
const POLL_MS = 30_000;

export function start(ctx) {
  const seen = new Map(); // key -> time, so Realtime + push for the same event sound once
  const state = { live: "connecting", unread: 0 };
  // Which notifications this admin has read. Kept per browser and per account.
  const READ_KEY = `skpass.notif.read.${ctx.profile?.id ?? "me"}`;
  const readSet = () => {
    try {
      return new Set(JSON.parse(localStorage.getItem(READ_KEY) ?? "[]"));
    } catch {
      return new Set();
    }
  };
  function markRead(keys) {
    const set = readSet();
    for (const k of keys) set.add(k);
    try {
      localStorage.setItem(READ_KEY, JSON.stringify([...set].slice(-300)));
    } catch { /* storage unavailable */ }
  }
  let pendingKeys = []; // keys of everything currently waiting, newest first
  async function refreshUnread() {
    try {
      const { data, error } = await ctx.sb.from("vehicles").select("id")
        .is("deleted_at", null).eq("status", "pending")
        .order("created_at", { ascending: false }).limit(50);
      if (error) return;
      pendingKeys = (data ?? []).map((r) => `reg:${r.id}`);
      const read = readSet();
      state.unread = pendingKeys.filter((k) => !read.has(k)).length;
      paint();
    } catch { /* keep the previous count */ }
  }
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
    await refreshUnread();
    if (!panel.hidden) loadNotifications();
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
        refreshUnread();
        if (!panel.hidden) loadNotifications();
        refreshIfIdle();
      }
    })
    .subscribe((status) => {
      state.live = status === "SUBSCRIBED" ? "live" : status === "CLOSED" ? "closed" : "problem";
      ctx.live = state.live;
      dispatchEvent(new CustomEvent("skpass:live", { detail: state.live }));
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
      "aria-haspopup": "dialog",
    },
    els.dot = h("span", { class: "al-dot", hidden: true }),
  );
  const bellIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (
    const [key, value] of Object.entries({
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "1.7",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
    })
  ) bellIcon.setAttribute(key, value);
  const bellPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  bellPath.setAttribute("d", "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4");
  bellIcon.append(bellPath);
  bell.prepend(bellIcon);
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
  const feed = h("div", { class: "al-feed", "aria-live": "polite" });
  const settings = h(
    "section",
    { class: "al-settings", hidden: true },
    h("p", { class: "al-section-label" }, "Notification settings"),
    h(
      "label",
      { class: "al-setting", for: "al-sound" },
      h(
        "span",
        {},
        h("strong", {}, "Alert sound"),
        h("small", {}, "Play three chimes for new registrations while this page is open."),
      ),
      soundBox,
    ),
    h("button", {
      class: "al-btn ghost",
      type: "button",
      onclick: async () => {
        await unlockAudio();
        if (await playAlert("new_registration", { force: true }) < 0) {
          toast("Your browser blocked audio. Interact with this page and try again.", "error");
        }
      },
    }, "Test alert sound"),
    h(
      "div",
      { class: "al-device" },
      h("p", { class: "al-title" }, "Device notifications"),
      pushStatus,
      pushBtn,
      testPush,
      h(
        "p",
        { class: "al-note" },
        "Receive new registration alerts when this page is closed. Delivery and sound depend on browser and device settings.",
      ),
    ),
  );
  soundBox.setAttribute("role", "switch");
  const inboxTab = h(
    "button",
    { class: "al-tab", type: "button", "aria-pressed": "true" },
    "Notifications",
  );
  const settingsTab = h(
    "button",
    { class: "al-tab", type: "button", "aria-pressed": "false" },
    "Settings",
  );
  function selectTab(showSettings) {
    feed.hidden = showSettings;
    settings.hidden = !showSettings;
    inboxTab.setAttribute("aria-pressed", String(!showSettings));
    settingsTab.setAttribute("aria-pressed", String(showSettings));
  }
  inboxTab.addEventListener("click", () => selectTab(false));
  settingsTab.addEventListener("click", () => selectTab(true));
  function closePanel() {
    panel.hidden = true;
    bell.setAttribute("aria-expanded", "false");
  }
  const closeIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (
    const [key, value] of Object.entries({
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2.2",
      "stroke-linecap": "round",
      "aria-hidden": "true",
    })
  ) closeIcon.setAttribute(key, value);
  const closePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  closePath.setAttribute("d", "M6 6l12 12M18 6L6 18");
  closeIcon.append(closePath);
  const close = h("button", {
    class: "al-close",
    type: "button",
    title: "Close",
    "aria-label": "Close notifications",
    onclick: (e) => {
      e.stopPropagation();
      closePanel();
      bell.focus();
    },
  }, closeIcon);
  const panel = h(
    "div",
    {
      class: "al-panel",
      id: "admin-notifications",
      role: "dialog",
      "aria-labelledby": "al-heading",
      hidden: true,
    },
    h(
      "div",
      { class: "al-panel-heading" },
      h(
        "div",
        {},
        h("h3", { id: "al-heading" }, "Notifications"),
        h("p", { class: "al-note" }, "Registration updates and device preferences"),
      ),
      close,
    ),
    live,
    h("div", { class: "al-tabs" }, inboxTab, settingsTab),
    feed,
    settings,
  );
  bell.setAttribute("aria-controls", "admin-notifications");
  let feedRequest = 0;
  const KINDS = { employee: "Employee", official: "Official", visitor: "Visitor" };
  async function loadNotifications() {
    const request = ++feedRequest;
    if (!feed.children.length) {
      feed.replaceChildren(h("p", { class: "al-empty" }, "Loading registrations…"));
    }
    try {
      const { data, error } = await ctx.sb.from("vehicles").select("id,plate,category,created_at")
        .is("deleted_at", null).eq("status", "pending").order("created_at", { ascending: false })
        .limit(10);
      if (request !== feedRequest) return;
      if (error) throw error;
      const rows = data ?? [];
      const read = readSet();
      const unread = rows.filter((r) => !read.has(`reg:${r.id}`)).length;
      const markAll = h("button", {
        class: "al-markall",
        type: "button",
        disabled: pendingKeys.every((k) => read.has(k)) && unread === 0,
        onclick: () => {
          markRead([...pendingKeys, ...rows.map((r) => `reg:${r.id}`)]);
          state.unread = 0;
          paint();
          loadNotifications();
        },
      }, "Mark all as read");
      feed.replaceChildren(
        h(
          "div",
          { class: "al-feed-head" },
          h(
            "p",
            { class: "al-section-label" },
            "Awaiting your review",
            unread ? h("span", { class: "al-count" }, `${unread} new`) : null,
          ),
          markAll,
        ),
        ...rows.map((row) => {
          const key = `reg:${row.id}`;
          const isNew = !read.has(key);
          return h(
            "a",
            {
              class: `al-item ${isNew ? "unread" : "read"}`,
              href: "#/pending",
              "aria-label": `${isNew ? "Unread: " : ""}${
                row.plate || "Vehicle"
              } registration pending`,
              onclick: () => {
                markRead([key]); // opens the Approvals page, where it can be reviewed
                state.unread = Math.max(0, state.unread - (isNew ? 1 : 0));
                paint();
                closePanel();
              },
            },
            h("span", { class: "al-item-dot", "aria-hidden": "true" }),
            h(
              "span",
              {},
              h("strong", {}, `${row.plate || "Vehicle"} · Registration pending`),
              h("span", {}, `${KINDS[row.category] ?? "Vehicle"} pass awaiting approval.`),
              h(
                "time",
                { datetime: row.created_at },
                fmtTime(row.created_at, ctx.tz ?? "Asia/Manila"),
              ),
            ),
            isNew ? h("span", { class: "al-new-tag" }, "New") : null,
          );
        }),
        rows.length
          ? h(
            "a",
            { class: "al-view-all", href: "#/pending", onclick: closePanel },
            "View all approvals →",
          )
          : h(
            "p",
            { class: "al-empty" },
            "You're all caught up. No registrations are waiting for approval.",
          ),
      );
    } catch {
      if (request === feedRequest) {
        feed.replaceChildren(
          h(
            "p",
            { class: "al-empty" },
            "Unable to load registrations. Reopen this panel to try again.",
          ),
        );
      }
    }
  }
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
    if (!panel.hidden) {
      loadNotifications();
      syncPush();
      inboxTab.focus();
    }
  });
  document.addEventListener("click", (e) => {
    if (!panel.hidden && !e.composedPath().includes(wrap)) {
      panel.hidden = true;
      bell.setAttribute("aria-expanded", "false");
    }
  });
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closePanel();
      bell.focus();
    }
  });
  soundBox.addEventListener("change", async () => {
    setMuted(!soundBox.checked);
    if (soundBox.checked) await unlockAudio();
    paint();
  });

  function paint() {
    els.live.textContent = state.live === "live"
      ? "Live updates connected"
      : state.live === "connecting"
      ? "Connecting to live updates…"
      : "Reconnecting · checking every 30 seconds";
    els.live.dataset.state = state.live;
    els.dot.hidden = state.unread === 0;
    els.dot.textContent = state.unread > 9 ? "9+" : String(state.unread || "");
    bell.title = state.unread
      ? `${state.unread} unread notification${state.unread === 1 ? "" : "s"}`
      : "Notifications and settings";
    bell.setAttribute(
      "aria-label",
      state.unread ? `Notifications, ${state.unread} unread` : "Alerts and notifications",
    );
  }

  async function syncPush() {
    try {
      await syncPushState();
    } catch {
      els.pushStatus.textContent =
        "Could not check device notifications. Reopen this panel to try again.";
    }
  }

  async function syncPushState() {
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
    els.pushStatus.textContent = on ? "Enabled on this device" : "Not enabled on this device";
    els.pushBtn.textContent = on ? "Disable device notifications" : "Enable device notifications";
    els.pushBtn.hidden = false;
    els.testPush.hidden = !on;
    // The browser may have rotated its subscription: silently re-register it.
    if (on) {
      const result = await tokenThen((t) => enableAdminPush(t));
      if (!result?.ok) {
        els.pushStatus.textContent =
          "Browser permission granted, but registration alerts could not be connected. Try disabling and enabling notifications.";
      }
    }
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
        const result = await tokenThen((t) => disablePush({ audience: "admin" }, t));
        if (result?.ok) toast("Notifications turned off for this device.");
        else {toast(
            "Could not confirm removal of this device subscription. Please try again.",
            "error",
          );}
      } else {
        const r = await tokenThen((t) => enableAdminPush(t));
        if (r?.ok) toast("Notifications are on. You will be told about new registrations.");
        else {toast(
            ERRORS[r?.error] ?? "Could not turn on notifications. Please try again.",
            "error",
          );}
      }
    } catch {
      toast("Could not update device notifications. Please try again.", "error");
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
    } catch {
      r = { ok: false };
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
  refreshUnread();
  setInterval(() => !document.hidden && refreshUnread(), 60_000);
  syncPush(true);
  return { announceNew, state };
}

const ERRORS = {
  denied: "Notifications are blocked. Allow them for this site in your browser settings.",
  "ios-install": REASON_TEXT["ios-install"],
  unsupported_push_service: "This browser's push service is not supported.",
  network: "No connection. Try again.",
};
