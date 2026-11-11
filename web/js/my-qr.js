import { myStatus } from "./api.js";
import { downloadQr, drawQr } from "./qr.js";
import { listVehicles, removeVehicle, updateVehicle } from "./store.js";

const list = document.getElementById("list");
const empty = document.getElementById("empty");
const welcome = document.getElementById("welcome");
const params = new URLSearchParams(location.search);
const focusId = params.get("v");
if (params.get("new") === "1") welcome.hidden = false;

/** Tiny DOM helper. Uses textContent only, so user data can never inject markup. */
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return el;
}

function badge(text, cls) {
  return h("span", { class: `badge ${cls}` }, text);
}
function icon(kind) {
  const paths = {
    car: "m5 10 2-5h10l2 5M3 17v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5H3Zm2 0v3m14-3v3M6 13h2m8 0h2",
    refresh: "M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-2l2 7M4 12l2 7a7 7 0 0 0 12-2",
    remove: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7",
  };
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
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
  ) svg.setAttribute(key, value);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", paths[kind]);
  svg.append(path);
  return svg;
}

function card(rec, view, note) {
  const s = view.status;
  const kids = [
    h(
      "div",
      { class: "card-head" },
      h(
        "div",
        { class: "plate-identity" },
        h("span", { class: "vehicle-icon" }, icon("car")),
        h("strong", { class: "plate" }, view.plate ?? rec.plate),
      ),
      badge(view.category ?? rec.category, "cat"),
    ),
    h(
      "div",
      { class: "pass-status-row" },
      h(
        "span",
        { class: `pass-status status-${view.expired ? "expired" : s}` },
        view.expired ? "Expired" : ({
          pending: "Pending approval",
          approved: "Approved",
          rejected: "Not approved",
          blocked: "Blocked",
          gone: "Unavailable",
        }[s] ?? "Checking status"),
      ),
    ),
  ];
  if (view.owner_name) kids.push(h("p", { class: "muted" }, view.owner_name));
  if (note) kids.push(h("p", { class: "alert warn" }, note));

  if (s === "pending") {
    kids.push(
      h(
        "div",
        { class: "pending-message" },
        h("span", { class: "pending-icon", "aria-hidden": "true" }),
        h(
          "div",
          {},
          h("h2", {}, "Your registration is being reviewed"),
          h("p", {}, "Your QR will appear here once approved."),
        ),
      ),
    );
  } else if (s === "rejected") {
    kids.push(
      h(
        "p",
        { class: "alert error" },
        `Not approved${view.reject_reason ? `: ${view.reject_reason}` : "."}`,
      ),
    );
    kids.push(h("a", { class: "btn", href: "../register/" }, "Register again"));
  } else if (s === "blocked") {
    kids.push(
      h("p", { class: "alert error" }, "This pass is blocked. Please contact the administrator."),
    );
  } else if (s === "approved" && view.token) {
    if (view.expired) kids.push(h("p", { class: "alert error" }, "This pass has expired."));
    if (view.not_yet_valid) {
      kids.push(h("p", { class: "alert warn" }, `Valid from ${view.valid_from}.`));
    }
    const canvas = h("canvas", { class: "qr", "aria-label": `QR code for ${rec.plate}` });
    drawQr(canvas, view.token);
    kids.push(canvas);
    if (view.valid_from || view.valid_to) {
      kids.push(
        h(
          "p",
          { class: "center muted" },
          `Valid ${view.valid_from ?? "…"} to ${view.valid_to ?? "…"}`,
        ),
      );
    }
    kids.push(h("p", { class: "center muted" }, "Show this QR to the guard at the gate."));
    kids.push(
      h("button", {
        class: "btn",
        type: "button",
        onclick: () => downloadQr(view.token, rec.plate),
      }, "Download QR"),
    );
  } else if (s === "gone") {
    kids.push(h("p", { class: "alert error" }, "This registration is no longer available."));
  }

  const actions = [];
  if (s !== "gone") {
    actions.push(
      h(
        "button",
        {
          class: "btn refresh-pass",
          type: "button",
          onclick: () => refresh(rec.vehicle_id),
        },
        icon("refresh"),
        "Refresh",
      ),
    );
  }
  actions.push(h(
    "button",
    {
      class: "btn ghost remove-pass",
      type: "button",
      onclick: async () => {
        if (
          confirm("Remove this vehicle from this device? You can get the QR back with Find my QR.")
        ) {
          await removeVehicle(rec.vehicle_id);
          render();
        }
      },
    },
    icon("remove"),
    "Remove from this device",
  ));
  kids.push(h("div", { class: "actions" }, actions));

  return h("section", { class: "card", "data-id": rec.vehicle_id }, kids);
}

async function viewFor(rec) {
  const { status, data } = await myStatus(rec.vehicle_id, rec.claim_secret);
  if (status === 200) {
    await updateVehicle(rec.vehicle_id, {
      status: data.status,
      token: data.token ?? null,
      view: data,
    });
    return { view: data };
  }
  if (status === 404) return { view: { status: "gone" } };
  // offline or server problem: fall back to what this device last saw
  if (rec.view) {
    return { view: rec.view, note: "You appear to be offline. Showing your last saved pass." };
  }
  return {
    view: { status: rec.status ?? "pending" },
    note: "Could not check the latest status. Try again.",
  };
}

async function refresh(id) {
  const recs = await listVehicles();
  const rec = recs.find((r) => r.vehicle_id === id);
  if (!rec) return;
  const old = list.querySelector(`[data-id="${id}"]`);
  if (old) old.classList.add("loading");
  const { view, note } = await viewFor(rec);
  const fresh = card(rec, view, note);
  if (old) old.replaceWith(fresh);
  else list.append(fresh);
}

async function render() {
  const recs = await listVehicles();
  list.replaceChildren();
  empty.hidden = recs.length > 0;
  recs.sort((a, b) => (a.vehicle_id === focusId ? -1 : b.vehicle_id === focusId ? 1 : 0));
  // show cached state immediately, then update each from the server
  for (const rec of recs) {
    list.append(card(rec, rec.view ?? { status: rec.status ?? "pending" }));
  }
  await Promise.all(recs.map((r) => refresh(r.vehicle_id)));
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") render();
});
render();
