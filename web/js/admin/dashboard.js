import { dailyChart, gateBars } from "./charts.js";
import { errMsg, h } from "./util.js";

const statIcons = {
  "Inside now": "M3 21h18M5 21V3h10v18M9 11h2m6-3 4 4-4 4m-3-4h7",
  "Scans today": "M4 8V4h4m8 0h4v4m0 8v4h-4M8 20H4v-4M4 12h16",
  "Waiting for approval": "M12 8v4l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  "Warnings today": "m12 3 10 18H2L12 3Zm0 6v5m0 3h.01",
  "Approved vehicles":
    "m5 10 2-5h10l2 5M3 17v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5H3Zm2 0v3m14-3v3M8 13h.01m8 0h.01",
  "Blocked vehicles": "m6 6 12 12M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
};
function stat(href, n, label, cls = "") {
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
  path.setAttribute("d", statIcons[label]);
  svg.append(path);
  const tone = label === "Blocked vehicles" && n
    ? "critical"
    : label === "Approved vehicles"
    ? "positive"
    : cls;
  return h(
    "a",
    { class: `stat metric-card ${tone}`, href },
    h(
      "div",
      { class: "metric-heading" },
      h("div", { class: "l" }, label),
      h("span", { class: "metric-icon" }, svg),
    ),
    h(
      "div",
      { class: "metric-value-row" },
      h("div", { class: "n" }, String(n)),
      h("span", { class: "metric-arrow", "aria-hidden": "true" }, "\u2197"),
    ),
  );
}

const legend = () =>
  h(
    "div",
    { class: "legend" },
    h("span", {}, h("i", { style: "background:#a3e635" }), "Entries (IN)"),
    h("span", {}, h("i", { style: "background:#748995" }), "Exits (OUT)"),
  );

export async function render(root, ctx) {
  root.classList.add("dashboard-view");
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
