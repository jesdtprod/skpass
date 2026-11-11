// Owner side (My QR page): "notify me" opt-in, and the approved / rejected announcement.
//
// Owners have no account, so a device is linked to a vehicle with that vehicle's claim secret
// (the same proof My QR already uses). One browser can follow several vehicles.
import { isMuted, playAlert, setMuted } from "./alert-sound.js";
import {
  enableOwnerPush,
  permission,
  pushSupport,
  REASON_TEXT,
  showLocalNotification,
} from "./notify.js";

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
  const banner = el(
    "div",
    { id: "decision-banner", class: `oa-banner ${status}`, role: "alert" },
    el("strong", {}, title),
    el("span", {}, plate ? `${plate} · ${body}` : body),
    el("button", { type: "button", "aria-label": "Dismiss", onclick: () => banner.remove() }, "✕"),
  );
  const anchor = document.getElementById("list");
  anchor?.parentElement?.insertBefore(banner, anchor);
  banner.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  playAlert(status === "approved" ? "approved" : "rejected");
  if (document.hidden) {
    showLocalNotification({
      title,
      body: plate ? `${plate} · ${body}` : body,
      tag: `decision-${vehicle_id}`,
      url: `my-qr/?v=${encodeURIComponent(vehicle_id)}`,
    });
  }
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

const ERR = {
  denied:
    "Notifications are blocked for this site. Allow them in your browser settings, then try again.",
  "ios-install": REASON_TEXT["ios-install"],
  network: "No connection. Please try again.",
};

/** Show/hide/update the card from the saved vehicles. Safe to call often. */
export async function refreshNotifyCard() {
  if (!card) return;
  const recs = await getRecs();
  const pending = recs.filter((r) => (r.status ?? "pending") === "pending" && r.claim_secret);
  const follow = readSet();
  const todo = pending.filter((r) => !follow.has(r.vehicle_id));
  const sup = pushSupport();

  card.replaceChildren();
  if (!pending.length) {
    card.hidden = true; // nothing is waiting for a decision
    return;
  }
  card.hidden = false;

  if (!sup.supported) {
    card.append(
      el("strong", {}, "Want an alert when it's decided?"),
      el(
        "p",
        {},
        REASON_TEXT[sup.reason] ??
          "This browser cannot show notifications. Keep this page open, or check back later.",
      ),
    );
    return;
  }
  if (permission() === "denied") {
    card.append(el("strong", {}, "Notifications are blocked"), el("p", {}, ERR.denied));
    return;
  }
  if (!todo.length) {
    card.append(
      el("strong", {}, "✓ Notifications are on"),
      el("p", {}, "You will be told as soon as your registration is approved or rejected."),
      soundRow(),
    );
    return;
  }

  const msg = el("p", { class: "oa-msg", role: "status" });
  const btn = el("button", { class: "oa-btn", type: "button" }, "Notify me when it's decided");
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    msg.textContent = "Turning on…";
    let failed = null;
    for (const r of todo) {
      const res = await enableOwnerPush(r.vehicle_id, r.claim_secret);
      if (res.ok) follow.add(r.vehicle_id);
      else {
        failed = res.error;
        break;
      }
    }
    writeSet(follow);
    if (failed) {
      msg.textContent = ERR[failed] ?? "Could not turn on notifications. Please try again.";
      btn.disabled = false;
    } else {
      refreshNotifyCard();
    }
  });
  card.append(
    el("strong", {}, "Get an alert when your registration is decided"),
    el(
      "p",
      {},
      "We'll notify this device when an administrator approves or rejects it, even if this page is closed.",
    ),
    btn,
    msg,
    soundRow(),
  );
}

function soundRow() {
  const box = el("input", { type: "checkbox", id: "oa-sound" });
  box.checked = !isMuted();
  box.addEventListener("change", () => setMuted(!box.checked));
  return el(
    "div",
    { class: "oa-sound" },
    el(
      "label",
      { for: "oa-sound" },
      box,
      " Play a loud sound (3×) when the decision arrives while this page is open",
    ),
    el("button", {
      type: "button",
      class: "oa-link",
      onclick: () => playAlert("approved", { force: true }),
    }, "Test sound"),
  );
}
