import { requireStaff, sb, signOut } from "../auth.js";
import { $, errMsg, h } from "./util.js";

const { profile } = await requireStaff(["admin"]);

// Site settings that views need (timezone for display).
const ctx = { sb, profile, tz: "Asia/Manila", badge: { pending: 0 } };
{
  const { data } = await sb.from("settings").select("value").eq("key", "timezone").maybeSingle();
  if (data?.value) ctx.tz = data.value;
}

function makeIcon(d, strokeWidth = "2") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "w-4 h-4");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("viewBox", "0 0 24 24");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d);
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  path.setAttribute("stroke-width", strokeWidth);
  svg.append(path);
  return svg;
}

const ROUTES = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: makeIcon(
      "M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z",
    ),
    load: () => import("./dashboard.js"),
  },
  {
    id: "pending",
    label: "Approvals",
    icon: makeIcon("M5 13l4 4L19 7", "2.5"),
    load: () => import("./pending.js"),
    badge: true,
  },
  {
    id: "vehicles",
    label: "Vehicles",
    icon: makeIcon(
      "M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0",
    ),
    load: () => import("./vehicles.js"),
  },
  {
    id: "inside",
    label: "Inside now",
    icon: makeIcon(
      "M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1",
    ),
    load: () => import("./inside.js"),
  },
  {
    id: "logs",
    label: "Logs",
    icon: makeIcon("M4 6h16M4 10h16M4 14h16M4 18h16"),
    load: () => import("./logs.js"),
  },
  {
    id: "gates",
    label: "Gates",
    icon: makeIcon("M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z"),
    load: () => import("./gates.js"),
  },
  {
    id: "staff",
    label: "Staff",
    icon: makeIcon(
      "M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z",
    ),
    load: () => import("./staff.js"),
  },
  {
    id: "settings",
    label: "Settings",
    icon: makeIcon(
      "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
    ),
    load: () => import("./settings.js"),
  },
];

const nav = $("#nav");
for (const r of ROUTES) {
  nav.append(
    h(
      "a",
      { href: `#/${r.id}`, "data-route": r.id, class: "nav-item" },
      h("span", { class: "ic", "aria-hidden": "true" }, r.icon),
      h("span", {}, r.label),
      r.badge ? h("span", { class: "pill", id: "pending-pill", hidden: true }, "0") : null,
    ),
  );
}

const who = $("#who");
if (who) who.textContent = profile.full_name || "Administrator";

const avatar = $("#avatar-initials");
if (avatar && profile.full_name) {
  const parts = profile.full_name.trim().split(/\s+/);
  avatar.textContent = parts.length > 1
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : parts[0].slice(0, 2).toUpperCase();
}

$("#signout")?.addEventListener("click", () => signOut());
$("#menu")?.addEventListener("click", () => document.body.classList.toggle("nav-open"));

ctx.refreshBadge = async () => {
  const { count } = await sb.from("vehicles").select("id", { count: "exact", head: true })
    .eq("status", "pending");
  ctx.badge.pending = count ?? 0;
  const pill = $("#pending-pill");
  if (pill) {
    pill.textContent = String(ctx.badge.pending);
    pill.hidden = !ctx.badge.pending;
  }
};

let cleanup = null;
let seq = 0;
async function route() {
  const id = (location.hash.match(/^#\/([a-z]+)/) ?? [])[1] ?? "dashboard";
  const r = ROUTES.find((x) => x.id === id) ?? ROUTES[0];
  const mine = ++seq;
  document.body.classList.remove("nav-open");
  nav.querySelectorAll(".nav-item").forEach((a) =>
    a.classList.toggle("active", a.dataset.route === r.id)
  );
  document.title = `${r.label} · SKPass Admin`;
  cleanup?.();
  cleanup = null;
  const root = $("#content");
  root.replaceChildren(h("p", { class: "muted" }, "Loading…"));
  try {
    const mod = await r.load();
    const view = h("section", { class: "view" });
    const result = await mod.render(view, ctx);
    if (mine !== seq) return; // user navigated away while loading
    cleanup = typeof result === "function" ? result : null;
    root.replaceChildren(view);
    root.focus({ preventScroll: true });
  } catch (e) {
    if (mine !== seq) return;
    root.replaceChildren(
      h("div", { class: "alert error" }, `Could not load this page. ${errMsg(e)}`),
    );
  }
  ctx.refreshBadge();
}
addEventListener("hashchange", route);
route();
