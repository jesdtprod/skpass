import { requireStaff, sb, signOut } from "../auth.js";
import { $, errMsg, h } from "./util.js";

const { profile } = await requireStaff(["admin"]);

// Site settings that views need (timezone for display).
const ctx = { sb, profile, tz: "Asia/Manila", badge: { pending: 0 } };
{
  const { data } = await sb.from("settings").select("value").eq("key", "timezone").maybeSingle();
  if (data?.value) ctx.tz = data.value;
}

const ROUTES = [
  { id: "dashboard", label: "Dashboard", icon: "▦", load: () => import("./dashboard.js") },
  { id: "pending", label: "Approvals", icon: "✓", load: () => import("./pending.js"), badge: true },
  { id: "vehicles", label: "Vehicles", icon: "🚗", load: () => import("./vehicles.js") },
  { id: "inside", label: "Inside now", icon: "⇥", load: () => import("./inside.js") },
  { id: "logs", label: "Logs", icon: "☰", load: () => import("./logs.js") },
  { id: "gates", label: "Gates", icon: "⛩", load: () => import("./gates.js") },
  { id: "staff", label: "Staff", icon: "👤", load: () => import("./staff.js") },
  { id: "settings", label: "Settings", icon: "⚙", load: () => import("./settings.js") },
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
$("#who").textContent = profile.full_name;
$("#signout").addEventListener("click", () => signOut());
$("#menu").addEventListener("click", () => document.body.classList.toggle("nav-open"));

ctx.refreshBadge = async () => {
  const { count } = await sb.from("vehicles").select("id", { count: "exact", head: true })
    .eq("status", "pending");
  ctx.badge.pending = count ?? 0;
  const pill = $("#pending-pill");
  pill.textContent = String(ctx.badge.pending);
  pill.hidden = !ctx.badge.pending;
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
