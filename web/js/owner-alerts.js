// Owner side (My QR page): "notify me" opt-in, and the approved / rejected announcement.
//
// Owners have no account, so a device is linked to a vehicle with that vehicle's claim secret
// (the same proof My QR already uses). One browser can follow several vehicles.
import { playAlert } from "./alert-sound.js";
import { enableOwnerPush, permission, pushSupport, showLocalNotification } from "./notify.js";

const KEY = "skpass.push.vehicles";

function readSet() {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}
function writeSet(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...s]));
  } catch { /* storage unavailable */ }
}

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, "");
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
}

let cssAdded = false;
function ensureCss() {
  if (cssAdded) return;
  cssAdded = true;
  document.head.append(
    el("link", {
      rel: "stylesheet",
      href: new URL("../css/owner-alerts.css", import.meta.url).href,
    }),
  );
}

// ------------------------------------------------------------ the announcement
const TEXT = {
  approved: [
    "Your registration was approved ✓",
    "Your pass is ready. Show your QR to the guard at the gate.",
  ],
  rejected: [
    "Your registration was not approved",
    "Scroll down to see the reason, then you can register again.",
  ],
};

/** Sound (3×), banner, and a system notification if this tab is in the background. */
export function announceDecision({ vehicle_id, status, plate }) {
  if (!TEXT[status]) return;
  ensureCss();
  const [title, body] = TEXT[status];
  document.getElementById("decision-banner")?.remove();
  if (status !== "approved") {
    const banner = el(
      "div",
      { id: "decision-banner", class: `oa-banner ${status}`, role: "alert" },
      el("strong", {}, title),
      el("span", {}, plate ? `${plate} · ${body}` : body),
      el(
        "button",
        { type: "button", "aria-label": "Dismiss", onclick: () => banner.remove() },
        "✕",
      ),
    );
    const anchor = document.getElementById("list");
    anchor?.parentElement?.insertBefore(banner, anchor);
    banner.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  }
  const kind = status === "approved" ? "approved" : "rejected";
  playAlert(kind).then((ms) => {
    // Browsers block sound until the page has been touched once: offer a one-tap replay.
    if (ms === -1) offerSound(kind, title);
  });
  if (document.hidden) {
    showLocalNotification({
      title,
      body: plate ? `${plate} · ${body}` : body,
      tag: `decision-${vehicle_id}`,
      url: `my-qr/?v=${encodeURIComponent(vehicle_id)}`,
    });
  }
}

/** Shown only when the browser blocked the alert sound. One tap unlocks audio and plays it. */
function offerSound(kind, title) {
  document.getElementById("sound-offer")?.remove();
  const btn = el(
    "button",
    {
      id: "sound-offer",
      type: "button",
      class: "oa-sound-offer",
      onclick: async () => {
        btn.remove();
        await playAlert(kind, { force: true });
      },
    },
    `🔔 ${title} Tap to play the sound`,
  );
  document.body.append(btn);
}

// ------------------------------------------------------------ the opt-in card
let card = null;
let getRecs = () => Promise.resolve([]);

export function mountNotifyCard(listEl, recsFn) {
  if (!listEl || card) return;
  ensureCss();
  getRecs = recsFn;
  card = el("section", { class: "oa-card", hidden: true, "aria-live": "polite" });
  listEl.parentElement?.insertBefore(card, listEl);
}

// Silent subscription: the decision banner and sound remain active without an opt-in panel.
let syncingPush = false;
let permissionGestureQueued = false;
export async function refreshNotifyCard() {
  if (!card) return;
  card.hidden = true;
  card.replaceChildren();
  if (syncingPush || !pushSupport().supported || permission() === "denied") return;
  const recs = await getRecs();
  const follow = readSet();
  const todo = recs.filter((r) =>
    (r.status ?? "pending") === "pending" && r.claim_secret && !follow.has(r.vehicle_id)
  );
  if (!todo.length) return;
  if (permission() !== "granted") {
    // Browsers require a gesture for the native permission prompt.
    if (!permissionGestureQueued) {
      permissionGestureQueued = true;
      document.addEventListener("click", () => syncPending(todo), { once: true });
    }
    return;
  }
  await syncPending(todo);
}
async function syncPending(records) {
  if (syncingPush || permission() === "denied") return;
  syncingPush = true;
  const follow = readSet();
  try {
    for (const record of records) {
      if (follow.has(record.vehicle_id)) continue;
      const result = await enableOwnerPush(record.vehicle_id, record.claim_secret);
      if (result.ok) follow.add(record.vehicle_id);
      else break;
    }
    writeSet(follow);
  } catch {
    // In-page status checks still announce decisions when push is unavailable.
  } finally {
    syncingPush = false;
  }
}
