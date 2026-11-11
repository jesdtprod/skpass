import { dailyChart, gateBars } from "./charts.js";
import { errMsg, h } from "./util.js";

const stat = (href, n, label, cls = "") =>
  h(
    "a",
    { class: `stat ${cls}`, href },
    h("div", { class: "n" }, String(n)),
    h("div", { class: "l" }, label),
  );

const legend = () =>
  h(
    "div",
    { class: "legend" },
    h("span", {}, h("i", { style: "background:#2d9a0f" }), "Entries (IN)"),
    h("span", {}, h("i", { style: "background:#2b2f33" }), "Exits (OUT)"),
  );

export async function render(root, ctx) {
  root.append(
    h("h1", {}, "Dashboard"),
    h("p", { class: "sub" }, "Live overview of gate activity."),
  );
  const { data: s, error } = await ctx.sb.rpc("admin_stats", { p_days: 14 });
  if (error || !s) {
    root.append(h("div", { class: "alert error" }, `Could not load statistics. ${errMsg(error)}`));
    return;
  }
  root.append(
    h(
      "div",
      { class: "stats" },
      stat("#/inside", s.inside, "Inside now"),
      stat("#/logs", s.scans_today, "Scans today"),
      stat("#/pending", s.pending, "Waiting for approval", s.pending ? "warn" : ""),
      stat("#/logs", s.warnings_today, "Warnings today", s.warnings_today ? "warn" : ""),
      stat("#/vehicles", s.approved, "Approved vehicles"),
      stat("#/vehicles", s.blocked, "Blocked vehicles"),
    ),
    h(
      "div",
      { class: "panels" },
      h("div", { class: "panel" }, h("h2", {}, "Last 14 days"), dailyChart(s.daily), legend()),
      h(
        "div",
        { class: "panel" },
        h("h2", {}, "Today by gate"),
        s.by_gate_today.length
          ? gateBars(s.by_gate_today)
          : h("p", { class: "muted" }, "No gates yet."),
        legend(),
      ),
    ),
  );
  const timer = setInterval(() => {
    if (document.hidden) return;
    ctx.refreshBadge();
  }, 60000);
  return () => clearInterval(timer);
}
