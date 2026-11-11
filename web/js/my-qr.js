import { myStatus } from "./api.js";
import { downloadQr, drawQr } from "./qr.js";
import { listVehicles, removeVehicle, updateVehicle } from "./store.js";
import { announceDecision, mountNotifyCard, refreshNotifyCard } from "./owner-alerts.js";

const list = document.getElementById("list");
const empty = document.getElementById("empty");
const welcome = document.getElementById("welcome");
const skeleton = document.getElementById("skeleton-loader");
const params = new URLSearchParams(location.search);
const focusId = params.get("v");
if (params.get("new") === "1" && welcome) welcome.hidden = false;

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

function svgIcon(kind, cls = "") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const baseAttrs = {
    fill: "none",
    stroke: "currentColor",
    viewBox: "0 0 24 24",
    "aria-hidden": "true",
  };
  for (const [k, v] of Object.entries(baseAttrs)) svg.setAttribute(k, v);
  if (cls) svg.setAttribute("class", cls);

  const paths = {
    vehicle: [
      { d: "M8 17a2 2 0 100-4 2 2 0 000 4zm8 0a2 2 0 100-4 2 2 0 000 4z", sw: "1.8" },
      {
        d: "M3 11l1.5-4.5A2 2 0 016.4 5h11.2a2 2 0 011.9 1.5L21 11v6a1 1 0 01-1 1h-1a1 1 0 01-1-1v-1H6v1a1 1 0 01-1 1H4a1 1 0 01-1-1v-6z",
        sw: "1.8",
      },
    ],
    copy: [
      {
        d: "M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z",
        sw: "2",
      },
    ],
    check: [
      { d: "M5 13l4 4L19 7", sw: "2.2" },
    ],
    download: [
      { d: "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4", sw: "2.2" },
    ],
    refresh: [
      {
        d: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15",
        sw: "2",
      },
    ],
    remove: [
      {
        d: "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16",
        sw: "2",
      },
    ],
    clock: [
      { d: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z", sw: "1.8" },
    ],
  };

  const pDefs = paths[kind] ?? [];
  for (const def of pDefs) {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", def.d);
    p.setAttribute("stroke-linecap", "round");
    p.setAttribute("stroke-linejoin", "round");
    if (def.sw) p.setAttribute("stroke-width", def.sw);
    svg.append(p);
  }
  return svg;
}

function renderStatusBadge(status, expired) {
  let badgeCls = "bg-slate-800 border-slate-700 text-slate-400";
  let dotCls = "bg-slate-400";
  let label = "Checking status";
  let isApproved = false;

  if (expired) {
    badgeCls = "bg-slate-800/90 border-slate-700 text-slate-400";
    dotCls = "bg-slate-400";
    label = "Expired";
  } else if (status === "approved") {
    badgeCls = "bg-emerald-950/60 border-emerald-500/30 text-emerald-400";
    dotCls = "bg-emerald-400";
    label = "Approved";
    isApproved = true;
  } else if (status === "pending") {
    badgeCls = "bg-amber-950/60 border-amber-500/30 text-amber-400";
    dotCls = "bg-amber-400 animate-pulse";
    label = "Pending Approval";
  } else if (status === "rejected") {
    badgeCls = "bg-rose-950/60 border-rose-500/30 text-rose-400";
    dotCls = "bg-rose-400";
    label = "Not Approved";
  } else if (status === "blocked") {
    badgeCls = "bg-red-950/60 border-red-500/30 text-red-400";
    dotCls = "bg-red-400";
    label = "Blocked";
  } else if (status === "gone") {
    badgeCls = "bg-slate-800/90 border-slate-700 text-slate-400";
    dotCls = "bg-slate-500";
    label = "Unavailable";
  }

  return h(
    "div",
    { class: "pass-approval mb-5" },
    h(
      "span",
      {
        class:
          `inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-semibold tracking-wide ${badgeCls} ${
            isApproved ? "neon-badge-glow" : ""
          }`,
      },
      h("span", { class: `w-2 h-2 rounded-full ${dotCls}` }),
      label,
    ),
  );
}

function card(rec, view, note) {
  view = { ...rec.details, ...view };
  const s = view.status;
  if (s === "approved" && (focusId === rec.vehicle_id || !focusId) && welcome) {
    welcome.hidden = true;
  }

  const kids = [];
  kids.push(
    h(
      "div",
      { class: "pass-section-heading" },
      h("h2", { class: "pass-section-title" }, "Vehicle Pass Details"),
      h(
        "p",
        { class: "pass-section-description" },
        "Review your vehicle information, holder details, and gate access QR.",
      ),
    ),
  );

  // Top Ambient Glow Accent
  kids.push(
    h("div", {
      class:
        "absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-brand-500 to-transparent opacity-80 pointer-events-none",
    }),
  );

  // Card Header: Vehicle Icon, Large Plate / Terminal Pass ID, and Category Tag
  const displayPlate = view.plate ?? rec.plate ?? "—";
  const displayCategory = (view.category ?? rec.category ?? "VEHICLE").toUpperCase();

  kids.push(
    h(
      "div",
      { class: "pass-card-header flex items-center justify-between gap-3 mb-4" },
      h(
        "div",
        { class: "flex items-center space-x-3.5" },
        h(
          "div",
          {
            class:
              "w-12 h-12 rounded-2xl bg-surface-750 border border-emerald-500/25 flex items-center justify-center text-emerald-400 shadow-inner flex-shrink-0",
          },
          svgIcon("vehicle", "w-6 h-6 stroke-emerald-400"),
        ),
        h(
          "div",
          {},
          h(
            "span",
            {
              class:
                "block text-xl sm:text-2xl md:text-3xl font-extrabold tracking-tight text-white font-mono leading-none break-all",
            },
            displayPlate,
          ),
          h(
            "span",
            {
              class:
                "block mt-0.5 leading-tight text-[10px] text-slate-400 uppercase tracking-widest font-mono",
            },
            "Terminal Pass ID",
          ),
        ),
      ),
      h(
        "div",
        {
          class: "category-chip flex-shrink-0",
        },
        h(
          "span",
          { class: "text-[11px] font-bold tracking-widest text-slate-300 uppercase" },
          displayCategory,
        ),
      ),
    ),
  );

  // Approval Status Badge
  kids.push(renderStatusBadge(s, view.expired));

  // Authorized Holder Section
  if (view.owner_name) {
    kids.push(
      h(
        "div",
        { class: "pass-holder mb-4" },
        h(
          "p",
          { class: "text-xs uppercase tracking-wider text-slate-400 font-semibold mb-0.5" },
          "Authorized Holder",
        ),
        h(
          "h2",
          { class: "text-lg font-bold text-white tracking-wide font-sans" },
          view.owner_name.toUpperCase(),
        ),
      ),
    );
  }

  // Divider Line
  kids.push(h("div", { class: "w-full h-px bg-slate-800 my-4" }));

  // Pass Reference Container with Clipboard Copy Handler
  const copyBtn = h(
    "button",
    {
      class:
        "text-slate-500 hover:text-slate-300 ml-2 focus:outline-none cursor-pointer p-1 rounded hover:bg-surface-750 transition-colors",
      title: "Copy Reference",
      type: "button",
      "aria-label": "Copy Reference",
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(rec.vehicle_id);
          copyBtn.replaceChildren(svgIcon("check", "w-3.5 h-3.5 text-emerald-400"));
          setTimeout(() => {
            copyBtn.replaceChildren(svgIcon("copy", "w-3.5 h-3.5"));
          }, 2000);
        } catch {
          // Clipboard write failed or denied
        }
      },
    },
    svgIcon("copy", "w-3.5 h-3.5"),
  );

  kids.push(
    h(
      "div",
      { class: "pass-reference mb-5" },
      h(
        "span",
        { class: "block text-[11px] uppercase tracking-wider text-slate-400 font-mono mb-1" },
        "Pass reference",
      ),
      h(
        "div",
        {
          class:
            "flex items-center justify-between bg-surface-900/60 px-3 py-2 rounded-lg border border-slate-800",
        },
        h(
          "span",
          {
            class:
              "font-mono text-xs sm:text-sm text-slate-300 font-medium tracking-wider select-all break-all",
          },
          rec.vehicle_id,
        ),
        copyBtn,
      ),
    ),
  );

  // Vehicle and Registration Details Grid
  const typeNames = {
    car: "Car",
    suv: "SUV / Crossover",
    van: "Van / MPV",
    truck: "Pickup / Truck",
    motorcycle: "Motorcycle",
    tricycle: "Tricycle",
    other: "Other",
  };

  function displayDate(value) {
    if (!value) return null;
    const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
    return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString("en-PH", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  const details = [
    ["Office / Department", view.office],
    ["Position / Title", view.position],
    ["Agency / Office", view.agency],
    ["Visiting", view.host_name],
    ["Purpose of visit", view.purpose],
    ["Registered", displayDate(view.created_at)],
    ["Valid from", displayDate(view.valid_from)],
    ["Valid until", displayDate(view.valid_to)],
  ].filter(([, value]) => value);

  if (details.length) {
    kids.push(
      h(
        "div",
        {
          class: "grid grid-cols-2 gap-3 py-3 mb-5 border-t border-b border-slate-800/80 text-xs",
        },
        details.map(([label, value]) =>
          h(
            "div",
            { class: "min-w-0" },
            h(
              "span",
              {
                class:
                  "text-[10px] font-mono text-slate-400 uppercase tracking-wider block mb-0.5 truncate",
              },
              label,
            ),
            h("span", { class: "text-slate-200 font-medium break-words" }, value),
          )
        ),
      ),
    );
  }

  // Warning or informational note (offline fallback, etc.)
  if (note) {
    kids.push(
      h(
        "div",
        {
          class:
            "p-3 mb-4 rounded-xl border border-amber-500/30 bg-amber-950/40 text-amber-200 text-xs font-medium",
        },
        note,
      ),
    );
  }

  // Dynamic State Content
  if (s === "pending") {
    kids.push(
      h(
        "div",
        {
          class:
            "bg-surface-900/90 border border-slate-800/90 rounded-2xl p-6 flex flex-col items-center justify-center text-center mb-6",
        },
        h(
          "div",
          {
            class:
              "w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mb-3",
          },
          svgIcon("clock", "w-6 h-6"),
        ),
        h(
          "h3",
          { class: "text-sm font-semibold text-white mb-1" },
          "Your registration is being reviewed",
        ),
        h(
          "p",
          { class: "text-xs text-slate-400 max-w-xs leading-relaxed" },
          "Your QR will appear here once approved by gate security.",
        ),
      ),
    );
  } else if (s === "rejected") {
    kids.push(
      h(
        "div",
        {
          class:
            "p-4 rounded-xl border border-rose-500/30 bg-rose-950/40 text-rose-200 text-xs font-medium mb-4",
        },
        `Not approved${view.reject_reason ? `: ${view.reject_reason}` : "."}`,
      ),
    );
    kids.push(
      h(
        "a",
        {
          class:
            "w-full py-3 px-4 bg-surface-800 hover:bg-surface-750 active:bg-surface-700 text-slate-200 font-semibold text-xs rounded-xl border border-slate-700 flex items-center justify-center gap-2 mb-4 transition-colors",
          href: "../register/",
        },
        "Register again",
      ),
    );
  } else if (s === "blocked") {
    kids.push(
      h(
        "div",
        {
          class:
            "p-4 rounded-xl border border-red-500/30 bg-red-950/40 text-red-200 text-xs font-medium mb-4",
        },
        "This pass is blocked. Please contact the administrator at the Gate Security Desk.",
      ),
    );
  } else if (s === "approved" && view.token) {
    if (view.expired) {
      kids.push(
        h(
          "div",
          {
            class:
              "p-3 mb-4 rounded-xl border border-rose-500/30 bg-rose-950/40 text-rose-200 text-xs font-medium",
          },
          "This pass has expired.",
        ),
      );
    }
    if (view.not_yet_valid) {
      kids.push(
        h(
          "div",
          {
            class:
              "p-3 mb-4 rounded-xl border border-amber-500/30 bg-amber-950/40 text-amber-200 text-xs font-medium",
          },
          `Valid from ${view.valid_from}.`,
        ),
      );
    }

    const canvas = h("canvas", {
      class: "w-full h-full block rounded-lg aspect-square",
      "aria-label": `QR Code for ${rec.plate}`,
      width: "200",
      height: "200",
    });
    drawQr(canvas, view.token);

    kids.push(
      h(
        "div",
        {
          class:
            "pass-qr-section bg-surface-900/90 border border-slate-800/90 rounded-2xl p-5 flex flex-col items-center justify-center qr-container-glow mb-6",
        },
        h(
          "p",
          {
            class: "text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-4",
          },
          "VEHICLE GATE PASS",
        ),
        h(
          "div",
          {
            class:
              "qr-paper relative bg-white rounded-2xl flex items-center justify-center w-full aspect-square",
          },
          canvas,
          h(
            "div",
            {
              class:
                "absolute inset-0 flex items-center justify-center pointer-events-none select-none",
            },
            h(
              "div",
              {
                class: "qr-logo-backing bg-white flex items-center justify-center relative",
              },
              h("img", {
                src: new URL("../icons/logo.png", import.meta.url).href,
                alt: "SKPass Security Seal",
                class: "w-full h-full object-contain filter drop-shadow-sm select-none",
                draggable: "false",
              }),
            ),
          ),
        ),
        h(
          "p",
          { class: "text-xs text-slate-400 mt-4 text-center font-medium" },
          "Show this QR to the guard at the gate.",
        ),
      ),
    );
  } else if (s === "gone") {
    kids.push(
      h(
        "div",
        {
          class:
            "p-4 rounded-xl border border-slate-700 bg-slate-900/60 text-slate-400 text-xs font-medium mb-4",
        },
        "This registration is no longer available.",
      ),
    );
  }

  // Control Actions Group
  const actionGroupKids = [];

  // Primary Action: Download QR (Shown when approved with token)
  if (s === "approved" && view.token) {
    actionGroupKids.push(
      h(
        "button",
        {
          class:
            "w-full py-3.5 px-4 bg-brand-bright hover:bg-brand-400 active:bg-brand-500 text-slate-950 font-bold text-sm tracking-wide rounded-xl shadow-lg transition-colors flex items-center justify-center gap-2 cursor-pointer",
          type: "button",
          onclick: () => downloadQr(view.token, rec.plate),
        },
        svgIcon("download", "w-4 h-4 text-slate-950"),
        "Download QR",
      ),
    );
  }

  // Secondary Action Grid: Refresh & Remove
  const secondaryGridKids = [];
  if (s !== "gone") {
    secondaryGridKids.push(
      h(
        "button",
        {
          class:
            "py-2.5 px-3 bg-surface-800 hover:bg-surface-750 active:bg-surface-700 border border-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer",
          type: "button",
          onclick: () => refresh(rec.vehicle_id),
        },
        svgIcon("refresh", "w-3.5 h-3.5 text-slate-400"),
        "Refresh",
      ),
    );
  }

  secondaryGridKids.push(
    h(
      "button",
      {
        class:
          "py-2.5 px-3 bg-surface-800 hover:bg-red-950/30 active:bg-red-950/50 border border-slate-700 hover:border-red-900/60 text-slate-200 hover:text-red-300 text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer",
        type: "button",
        onclick: async () => {
          if (
            confirm(
              "Remove this vehicle from this device? You can get the QR back with Find my QR.",
            )
          ) {
            await removeVehicle(rec.vehicle_id);
            render();
          }
        },
      },
      svgIcon("remove", "w-3.5 h-3.5 text-slate-400"),
      "Remove from this device",
    ),
  );

  actionGroupKids.push(
    h(
      "div",
      {
        class: `grid ${secondaryGridKids.length > 1 ? "grid-cols-2" : "grid-cols-1"} gap-3 pt-1`,
      },
      secondaryGridKids,
    ),
  );

  kids.push(h("div", { class: "space-y-3" }, actionGroupKids));

  const article = h(
    "article",
    {
      class:
        "bg-surface-850/95 backdrop-blur-xl border border-slate-700/60 rounded-3xl p-5 sm:p-7 shadow-2xl relative overflow-hidden transition-all",
      "data-purpose": "vehicle-gate-pass-card",
      "data-id": rec.vehicle_id,
    },
    kids,
  );
  const header = article.querySelector(".pass-card-header");
  const vehicleSummary = [typeNames[view.vehicle_type] ?? view.vehicle_type, view.color]
    .filter(Boolean).join(" \u00b7 ");
  if (vehicleSummary) {
    header.firstElementChild.lastElementChild.append(
      h("span", { class: "pass-vehicle-summary" }, vehicleSummary),
    );
  }
  const holder = article.querySelector(".pass-holder");
  const status = article.querySelector(".pass-approval");
  const qrSection = article.querySelector(".pass-qr-section");
  const reference = article.querySelector(".pass-reference");
  const identity = h("div", { class: "pass-holder-panel" });
  const holderRow = h("div", { class: "pass-holder-row" });
  if (holder) holderRow.append(holder);
  if (status) holderRow.append(status);
  identity.append(holderRow);
  identity.append(
    h(
      "dl",
      { class: "pass-vehicle-fields" },
      h(
        "div",
        {},
        h("dt", {}, "Vehicle type"),
        h("dd", {}, typeNames[view.vehicle_type] ?? view.vehicle_type ?? "Not available"),
      ),
      h("div", {}, h("dt", {}, "Color"), h("dd", {}, view.color || "Not available")),
    ),
  );
  if (reference) identity.append(reference);
  const layout = h("div", { class: `pass-identity-layout ${qrSection ? "with-qr" : ""}` });
  if (qrSection) layout.append(qrSection);
  layout.append(identity);
  header.after(layout);
  identity.prepend(header);
  article.classList.add("formatted-pass");
  return article;
}

async function viewFor(rec) {
  const { status, data } = await myStatus(rec.vehicle_id, rec.claim_secret);
  if (status === 200) {
    const wasPending = (rec.status ?? "pending") === "pending";
    if (wasPending && (data.status === "approved" || data.status === "rejected")) {
      announceDecision({
        vehicle_id: rec.vehicle_id,
        status: data.status,
        plate: data.plate ?? rec.plate,
      });
    }
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
  const old = list?.querySelector(`[data-id="${id}"]`);
  if (old?.getAttribute("aria-busy") === "true") return;
  old?.setAttribute("aria-busy", "true");
  try {
    const { view, note } = await viewFor(rec);
    const fresh = card(rec, view, note);
    if (old?.isConnected) old.replaceWith(fresh);
    else if (!list?.querySelector(`[data-id="${id}"]`)) list?.append(fresh);
  } catch {
    // Keep the saved pass and its QR readable if the status service is unavailable.
    if (old?.isConnected && !old.querySelector(".refresh-status-note")) {
      old.append(
        h(
          "p",
          { class: "refresh-status-note text-xs text-slate-400 mt-3", role: "status" },
          "Could not update the status. Your saved pass is still displayed.",
        ),
      );
    }
  } finally {
    old?.removeAttribute("aria-busy");
    old?.classList.remove("opacity-60", "pointer-events-none");
  }
}

async function render() {
  const recs = await listVehicles();
  if (skeleton) skeleton.hidden = true;
  if (!list || !empty) return;
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

// While this page is open, check pending registrations every 20 s so a decision shows (and
// sounds) within seconds, even without push notifications.
setInterval(async () => {
  if (document.hidden) return;
  for (const r of await listVehicles()) {
    if ((r.status ?? "pending") === "pending") await refresh(r.vehicle_id);
  }
}, 20000);

// A push that arrives while the page is open: update straight away.
navigator.serviceWorker?.addEventListener("message", (e) => {
  if (e.data?.type === "skpass-push" && e.data.kind === "decision" && e.data.vehicle_id) {
    refresh(e.data.vehicle_id);
  }
});

mountNotifyCard(list, listVehicles);
await render();
refreshNotifyCard();
