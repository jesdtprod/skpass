import { dailyChart, gateBars, hourChart } from "./charts.js";
import {
  attentionItems,
  dailyTotals,
  denialLabel,
  fmtDuration,
  greeting,
  hourBuckets,
  localParts,
  pct,
  peakHour,
  relTime,
  trend,
} from "./dashboard-calc.js";
import { errMsg, h } from "./util.js";

const PERIODS = [7, 14, 30];
const DAY_KEY = "skpass.dash.days";
const CATEGORY_COLORS = { employee: "#a3e635", official: "#e7c57a", visitor: "#7dd3fc" };
const CATEGORY_LABEL = { employee: "Employees", official: "Officials", visitor: "Visitors" };
const LONG_INSIDE_MS = 12 * 3600_000;
const AUTO_REFRESH_MS = 60_000;
const LOG_SELECT =
  "id,direction,result,warning,scanned_at,vehicles!inner(plate,category),gates(name),profiles:scanned_by(full_name)";

const statIcons = {
  "Inside now": "M3 21h18M5 21V3h10v18M9 11h2m6-3 4 4-4 4m-3-4h7",
  "Scans today": "M4 8V4h4m8 0h4v4m0 8v4h-4M8 20H4v-4M4 12h16",
  "Waiting for approval": "M12 8v4l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  "Warnings today": "m12 3 10 18H2L12 3Zm0 6v5m0 3h.01",
  "Approved vehicles":
    "m5 10 2-5h10l2 5M3 17v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5H3Zm2 0v3m14-3v3M8 13h.01m8 0h.01",
  "Blocked vehicles": "m6 6 12 12M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
};

function svgIcon(d, stroke = "1.7") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (
    const [k, v] of Object.entries({
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": stroke,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
    })
  ) svg.setAttribute(k, v);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d);
  svg.append(path);
  return svg;
}

/** One metric card. `sub` is the context line shown under the number. */
function stat(href, n, label, cls = "", sub = null) {
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
      h("span", { class: "metric-icon" }, svgIcon(statIcons[label])),
    ),
    h(
      "div",
      { class: "metric-value-row" },
      h("div", { class: "n" }, String(n)),
      h("span", { class: "metric-arrow", "aria-hidden": "true" }, "↗"),
    ),
    sub ? h("div", { class: "metric-sub" }, sub) : null,
  );
}

const legend = () =>
  h(
    "div",
    { class: "legend" },
    h(
      "span",
      { class: "legend-item" },
      h("i", { class: "legend-dot in", style: "background:#a3e635" }),
      "Entries (IN)",
    ),
    h(
      "span",
      { class: "legend-item" },
      h("i", { class: "legend-dot out", style: "background:#748995" }),
      "Exits (OUT)",
    ),
  );

function ensureCss() {
  if (document.getElementById("dashboard-css")) return;
  document.head.append(
    h("link", {
      id: "dashboard-css",
      rel: "stylesheet",
      href: new URL("../../css/dashboard.css", import.meta.url).href,
    }),
  );
}

// ------------------------------------------------------------------ formatting
function clockText(now, tz) {
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(now);
  let off = "";
  try {
    off = new Intl.DateTimeFormat("en", { timeZone: tz, timeZoneName: "shortOffset" })
      .formatToParts(now).find((p) => p.type === "timeZoneName")?.value.replace("GMT", "UTC") ?? "";
  } catch { /* unknown zone */ }
  return { time, off };
}
const dateText = (now, tz) =>
  new Intl.DateTimeFormat("en-PH", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);
const shortDay = (day) =>
  new Date(`${day}T00:00:00`).toLocaleDateString("en", { month: "short", day: "numeric" });

// ------------------------------------------------------------------ data
const ago = (ms) => new Date(Date.now() - ms).toISOString();

/** Everything the page shows, fetched in parallel. A failing part never blocks the others. */
async function fetchAll(sb, days) {
  const approvedIn = (cat) =>
    sb.from("vehicles").select("id", { count: "exact", head: true })
      .is("deleted_at", null).eq("status", "approved").eq("category", cat);
  const [stats, inside, pending, activity, hourly, denials, e, o, v, new7, gates] = await Promise
    .all([
      sb.rpc("admin_stats", { p_days: days }),
      sb.from("v_vehicles_inside").select("vehicle_id,plate,owner_name,category,gate_id,entered_at")
        .order("entered_at", { ascending: true }).limit(200),
      sb.from("vehicles").select("id,plate,owner_name,category,created_at,valid_from,valid_to")
        .is("deleted_at", null).eq("status", "pending")
        .order("created_at", { ascending: true }).limit(6),
      sb.from("gate_logs").select(LOG_SELECT).is("deleted_at", null)
        .order("scanned_at", { ascending: false }).limit(8),
      sb.from("gate_logs").select("scanned_at,direction").is("deleted_at", null)
        .gte("scanned_at", ago(36 * 3600_000))
        .order("scanned_at", { ascending: false }).limit(5000),
      sb.from("audit_logs").select("created_at,entity_id,after").eq("action", "scan_denied")
        .gte("created_at", ago(24 * 3600_000)).order("created_at", { ascending: false }).limit(5),
      approvedIn("employee"),
      approvedIn("official"),
      approvedIn("visitor"),
      sb.from("vehicles").select("id", { count: "exact", head: true }).is("deleted_at", null)
        .eq("status", "approved").gte("approved_at", ago(7 * 86400_000)),
      sb.from("gates").select("id,name").is("deleted_at", null),
    ]);
  // plates for the denied scans (they only store the vehicle id)
  const ids = [...new Set((denials.data ?? []).map((d) => d.entity_id).filter(Boolean))];
  const plates = new Map();
  if (ids.length) {
    const { data } = await sb.from("vehicles").select("id,plate").in("id", ids);
    for (const r of data ?? []) plates.set(r.id, r.plate);
  }
  return {
    stats,
    inside,
    pending,
    activity,
    hourly,
    denials,
    plates,
    categories: { employee: e.count, official: o.count, visitor: v.count },
    new7: new7.error ? null : new7.count,
    gates: new Map((gates.data ?? []).map((g) => [g.id, g.name])),
  };
}

// ------------------------------------------------------------------ small building blocks
function actionIconFor(href) {
  if (href === "#/gates") {
    // Manage / gate settings icon (sliders)
    return svgIcon(
      "M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4",
      "1.8",
    );
  }
  if (href === "#/logs") {
    // Table logs / list lines icon
    return svgIcon("M4 6h16M4 10h16M4 14h16M4 18h16", "1.8");
  }
  if (href === "#/vehicles") {
    // Car icon
    return svgIcon(
      "M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1",
      "1.8",
    );
  }
  if (href === "#/pending") {
    // Approvals check
    return svgIcon("M5 13l4 4L19 7", "2.2");
  }
  if (href === "#/inside") {
    // Inside now
    return svgIcon(
      "M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1",
      "1.8",
    );
  }
  // Default: arrow-up-right
  return svgIcon("M7 17L17 7M7 7h10v10", "2");
}

const panel = (cls, title, note, linkHref, linkText, ...body) => {
  const headKids = [
    h(
      "div",
      { class: "panel-title-wrap" },
      h("h2", { class: "panel-title" }, title),
      note ? h("span", { class: "sub-note" }, note) : null,
    ),
  ];
  if (linkHref) {
    const cleanLabel = (linkText ?? "View").replace("→", "").trim();
    headKids.push(
      h(
        "a",
        {
          class: "panel-action-btn",
          href: linkHref,
          title: cleanLabel,
          "aria-label": cleanLabel,
        },
        actionIconFor(linkHref),
      ),
    );
  }
  return h(
    "section",
    { class: `panel ${cls}` },
    h("div", { class: "panel-head" }, headKids),
    ...body,
  );
};

const failed = (what) => h("div", { class: "panel-error" }, `Could not load ${what}.`);
const empty = (text) => h("div", { class: "panel-empty" }, text);
const catTag = (c) => h("span", { class: `tag cat-${c}` }, c);

function skeleton() {
  return [
    h("div", { class: "skeleton", style: "height:46px" }),
    h("div", { class: "skeleton", style: "height:76px" }),
    h("div", { class: "skeleton", style: "height:150px" }),
    h("div", { class: "skeleton", style: "height:320px" }),
  ];
}

// ------------------------------------------------------------------ render
export async function render(root, ctx) {
  ensureCss();
  root.classList.add("dashboard-view");
  let saved = 14;
  try {
    saved = Number(localStorage.getItem(DAY_KEY)) || 14;
  } catch { /* storage unavailable */ }
  const state = {
    days: PERIODS.includes(saved) ? saved : 14,
    updated: null,
    live: ctx.live ?? "connecting",
  };
  const first = (ctx.profile?.full_name ?? "").split(" ")[0] || "there";

  // ---- header (built once; the clock and pills inside it update in place)
  const clockEl = h("span", { class: "dash-clock" });
  const offEl = h("span", {}, "");
  const dateEl = h("span", {});
  const greetEl = h("p", { class: "dash-sub" });
  const liveEl = h(
    "span",
    { class: "live-pill", role: "status" },
    h("i", { "aria-hidden": "true" }),
    h("span", {}),
  );
  const updatedEl = h("span", { class: "dash-updated" }, "Loading…");
  const refreshBtn = h(
    "button",
    { class: "dash-btn", type: "button", title: "Refresh now" },
    svgIcon(
      "M4 4v6h6M20 20v-6h-6M5.6 9a8 8 0 0 1 13.6-2.4L20 10M18.4 15a8 8 0 0 1-13.6 2.4L4 14",
      "2",
    ),
    "Refresh",
  );
  const seg = h(
    "div",
    { class: "seg", role: "group", "aria-label": "Chart period" },
    PERIODS.map((d) =>
      h(
        "button",
        { type: "button", "data-days": d, "aria-pressed": String(d === state.days) },
        `${d} days`,
      )
    ),
  );
  const head = h(
    "header",
    { class: "dash-head" },
    h(
      "div",
      { class: "dash-top" },
      h(
        "div",
        {},
        h("h1", {}, "Dashboard"),
        h(
          "p",
          { class: "dash-sub" },
          "Live overview of gate activity, vehicle access, and pending requests.",
        ),
      ),
      h(
        "div",
        { class: "dash-controls" },
        h("div", { class: "dash-row" }, liveEl, updatedEl, refreshBtn),
        seg,
      ),
    ),
  );
  const body = h("div", { class: "dash" }, ...skeleton());
  root.append(head, body);

  const tick = () => {
    const now = new Date();
    const c = clockText(now, ctx.tz);
    clockEl.textContent = c.time;
    offEl.textContent = c.off;
    dateEl.textContent = dateText(now, ctx.tz);
    greetEl.replaceChildren(
      `${greeting(localParts(now, ctx.tz).hour)}, `,
      h("b", {}, first),
      ". Here is what is happening at the gates.",
    );
    updatedEl.textContent = state.updated
      ? `Updated ${clockText(state.updated, ctx.tz).time}`
      : "Loading…";
    const labels = {
      live: "Live",
      connecting: "Connecting…",
      closed: "Reconnecting…",
      problem: "Reconnecting…",
    };
    liveEl.dataset.state = state.live;
    liveEl.lastChild.textContent = labels[state.live] ?? "Reconnecting…";
  };
  tick();
  const clock = setInterval(tick, 1000);
  const onLive = (e) => {
    state.live = e.detail;
    tick();
  };
  addEventListener("skpass:live", onLive);

  // ---- data + body
  let busy = false;
  async function load() {
    if (busy) return;
    busy = true;
    refreshBtn.setAttribute("aria-busy", "true");
    try {
      const d = await fetchAll(ctx.sb, state.days);
      state.updated = new Date();
      body.replaceChildren(...paint(d, ctx, state.days));
    } catch (e) {
      body.replaceChildren(
        h("div", { class: "alert error" }, `Could not load the dashboard. ${errMsg(e)}`),
      );
    } finally {
      busy = false;
      refreshBtn.removeAttribute("aria-busy");
      tick();
    }
  }
  refreshBtn.addEventListener("click", load);
  seg.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-days]");
    if (!b) return;
    state.days = Number(b.dataset.days);
    try {
      localStorage.setItem(DAY_KEY, String(state.days));
    } catch { /* ignore */ }
    seg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    load();
  });
  const auto = setInterval(() => {
    if (!document.hidden) {
      load();
      ctx.refreshBadge?.();
    }
  }, AUTO_REFRESH_MS);
  await load();

  return () => {
    clearInterval(clock);
    clearInterval(auto);
    removeEventListener("skpass:live", onLive);
  };
}

// ------------------------------------------------------------------ the page body
function paint(d, ctx, days) {
  const s = d.stats.data;
  if (d.stats.error || !s) {
    return [
      h("div", { class: "alert error" }, `Could not load statistics. ${errMsg(d.stats.error)}`),
    ];
  }
  const now = Date.now();
  const inside = d.inside.data ?? [];
  const longest = inside[0] ?? null; // ordered oldest entry first
  const longInside =
    inside.filter((r) => now - new Date(r.entered_at).getTime() > LONG_INSIDE_MS).length;
  const pend = d.pending.data ?? [];
  const oldestPendingMs = pend[0] ? now - new Date(pend[0].created_at).getTime() : 0;
  const daily = s.daily ?? [];
  const today = daily.at(-1);
  const yesterday = daily.length > 1 ? daily.at(-2) : null;
  const tr = trend(
    today ? today.in + today.out : s.scans_today,
    yesterday ? yesterday.in + yesterday.out : null,
  );
  const totalVehicles = s.approved + s.pending + s.blocked;

  // ---- needs attention
  const items = attentionItems({
    pending: s.pending,
    oldestPendingMs,
    warnings: s.warnings_today,
    blocked: s.blocked,
    longInside,
  });
  const attention = h(
    "section",
    { class: "attention", "aria-label": "Needs attention" },
    h("span", { class: "attention-label" }, "Needs attention"),
    items.length
      ? items.map((i) =>
        h(
          "a",
          { class: `chip ${i.tone}`, href: i.href },
          i.text,
          h("span", { class: "cta" }, `${i.cta} →`),
        )
      )
      : h("span", { class: "chip ok" }, "All clear. Nothing needs your attention right now."),
  );

  // ---- quick actions
  const act = (href, icon, title, hint, hot = false) =>
    h(
      "a",
      { class: `action${hot ? " hot" : ""}`, href },
      h("span", { class: "ai" }, svgIcon(icon)),
      h("span", {}, h("strong", {}, title), h("small", {}, hint)),
    );
  const actions = h(
    "nav",
    { class: "actions", "aria-label": "Quick actions" },
    act(
      "#/pending",
      "M5 13l4 4L19 7",
      "Review approvals",
      s.pending ? `${s.pending} waiting` : "Queue is clear",
      s.pending > 0,
    ),
    act("#/vehicles?add=1", "M12 5v14M5 12h14", "Add a pass", "Visitor, official or employee"),
    act(
      "../scan/",
      "M4 8V4h4m8 0h4v4m0 8v4h-4M8 20H4v-4M4 12h16",
      "Open scanner",
      "Guard camera view",
    ),
    act("#/logs", "M4 6h16M4 10h16M4 14h16M4 18h10", "Export logs", "CSV for any date range"),
    act(
      "#/gates",
      "M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z",
      "Manage gates",
      `${d.gates.size} gate${d.gates.size === 1 ? "" : "s"}`,
    ),
  );

  // ---- metric cards (each with a context line)
  const trendLine = h(
    "span",
    { class: tr.dir === "flat" ? "" : tr.dir },
    tr.dir === "up" ? "▲ " : tr.dir === "down" ? "▼ " : "",
    tr.text,
  );
  const stats = h(
    "div",
    { class: "stats" },
    stat(
      "#/inside",
      s.inside,
      "Inside now",
      "",
      longest
        ? [
          "Longest: ",
          h("b", {}, longest.plate),
          ` · ${fmtDuration(now - new Date(longest.entered_at).getTime())}`,
        ]
        : "No vehicles inside",
    ),
    stat("#/logs", s.scans_today, "Scans today", "", trendLine),
    stat(
      "#/pending",
      s.pending,
      "Waiting for approval",
      s.pending ? "warn" : "",
      pend[0] ? ["Oldest waiting ", h("b", {}, fmtDuration(oldestPendingMs))] : "Queue is clear",
    ),
    stat(
      "#/logs",
      s.warnings_today,
      "Warnings today",
      s.warnings_today ? "warn" : "",
      s.scans_today
        ? `${pct(s.warnings_today, s.scans_today)}% of today's scans`
        : "No scans yet today",
    ),
    stat(
      "#/vehicles",
      s.approved,
      "Approved vehicles",
      "",
      d.new7 == null ? "" : [h("b", {}, `+${d.new7}`), " approved in the last 7 days"],
    ),
    stat(
      "#/vehicles",
      s.blocked,
      "Blocked vehicles",
      "",
      totalVehicles
        ? `${pct(s.blocked, totalVehicles)}% of registered vehicles`
        : "No vehicles yet",
    ),
  );

  // ---- activity chart
  const tot = dailyTotals(daily);
  const activityPanel = panel(
    "span-8",
    `Activity, last ${days} days`,
    null,
    "#/logs",
    "Open logs →",
    h(
      "div",
      { class: "totals" },
      h(
        "div",
        { class: "total-chip total-all" },
        h("span", { class: "total-dot" }),
        h("b", {}, tot.total),
        h("span", { class: "total-lbl" }, "movements"),
      ),
      h(
        "div",
        { class: "total-chip total-in" },
        h("span", { class: "total-arrow" }, "↑"),
        h("b", {}, tot.in),
        h("span", { class: "total-lbl" }, "IN"),
      ),
      h(
        "div",
        { class: "total-chip total-out" },
        h("span", { class: "total-arrow" }, "↓"),
        h("b", {}, tot.out),
        h("span", { class: "total-lbl" }, "OUT"),
      ),
      h(
        "div",
        { class: "total-chip total-avg" },
        h("b", {}, tot.avg),
        h("span", { class: "total-lbl" }, "/ day"),
      ),
      tot.busiest
        ? h(
          "div",
          { class: "total-chip total-peak" },
          h("span", { class: "total-lbl" }, "Peak:"),
          h("b", {}, shortDay(tot.busiest.day)),
          h("span", { class: "total-sub" }, `(${tot.busiest.in + tot.busiest.out})`),
        )
        : null,
    ),
    dailyChart(daily),
    legend(),
  );
  const gatePanel = panel(
    "span-4",
    "Today by gate",
    null,
    "#/gates",
    "Manage →",
    s.by_gate_today.length
      ? gateBars(s.by_gate_today)
      : empty("No gates yet. Add one under Gates."),
    legend(),
  );

  // ---- hour chart
  const buckets = hourBuckets(d.hourly.data ?? [], ctx.tz, s.today);
  const peak = peakHour(buckets);
  const hourPanel = panel(
    "span-7",
    "Today by hour",
    peak ? `Peak ${peak.label} · ${peak.count} movements` : "No movements yet today",
    null,
    null,
    d.hourly.error
      ? failed("hourly activity")
      : hourChart(buckets, { nowHour: localParts(new Date(), ctx.tz).hour, peak }),
    legend(),
  );

  // ---- category mix
  const cats = d.categories;
  const catTotal = (cats.employee ?? 0) + (cats.official ?? 0) + (cats.visitor ?? 0);
  const catPanel = panel(
    "span-5",
    "Approved vehicles by category",
    null,
    "#/vehicles",
    "All vehicles →",
    catTotal
      ? [
        h(
          "div",
          { class: "catbar", role: "img", "aria-label": "Share of approved vehicles by category" },
          Object.keys(CATEGORY_COLORS).map((k) =>
            h("span", {
              style: `width:${pct(cats[k] ?? 0, catTotal)}%;background:${CATEGORY_COLORS[k]}`,
              title: `${CATEGORY_LABEL[k]}: ${cats[k] ?? 0}`,
            })
          ),
        ),
        h(
          "ul",
          { class: "catlist" },
          Object.keys(CATEGORY_COLORS).map((k) =>
            h(
              "li",
              {},
              h("i", { style: `background:${CATEGORY_COLORS[k]}` }),
              h("span", {}, CATEGORY_LABEL[k]),
              h("span", { class: "n" }, String(cats[k] ?? 0)),
              h("span", { class: "p" }, `${pct(cats[k] ?? 0, catTotal)}%`),
            )
          ),
        ),
        h(
          "div",
          { class: "cattotal" },
          h("span", {}, "Total approved"),
          h("b", {}, String(catTotal)),
        ),
      ]
      : empty("No approved vehicles yet."),
  );

  // ---- recent activity feed
  const acts = d.activity.data ?? [];
  const activityFeed = panel(
    "span-6",
    "Recent activity",
    null,
    "#/logs",
    "View all →",
    d.activity.error ? failed("recent activity") : acts.length
      ? h(
        "ul",
        { class: "rows" },
        acts.map((r) =>
          h(
            "li",
            {},
            h("span", { class: `lead ${r.direction === "IN" ? "in" : "out"}` }, r.direction),
            h(
              "div",
              { class: "main" },
              h(
                "div",
                { class: "t" },
                h("span", { class: "plate" }, r.vehicles.plate),
                catTag(r.vehicles.category),
                r.warning ? h("span", { class: "tag warn" }, r.warning.replaceAll("_", " ")) : null,
              ),
              h(
                "div",
                { class: "s" },
                `${r.gates?.name ?? "(removed gate)"}${
                  r.profiles?.full_name ? ` · ${r.profiles.full_name}` : ""
                }`,
              ),
            ),
            h("div", { class: "end" }, relTime(r.scanned_at, now)),
          )
        ),
      )
      : empty("No movements recorded yet."),
  );

  // ---- approval queue
  const queue = panel(
    "span-6",
    "Waiting for approval",
    s.pending > pend.length ? `Showing ${pend.length} of ${s.pending}` : null,
    "#/pending",
    "Review all →",
    d.pending.error ? failed("the approval queue") : pend.length
      ? h(
        "ul",
        { class: "rows" },
        pend.map((v) => {
          const waited = now - new Date(v.created_at).getTime();
          return h(
            "li",
            {},
            h("span", { class: "lead dot warn", "aria-hidden": "true" }),
            h(
              "div",
              { class: "main" },
              h("div", { class: "t" }, h("span", { class: "plate" }, v.plate), catTag(v.category)),
              h(
                "div",
                { class: "s" },
                v.category === "visitor" && v.valid_from
                  ? `${v.owner_name} · visit ${v.valid_from} to ${v.valid_to ?? "?"}`
                  : v.owner_name,
              ),
            ),
            h(
              "div",
              { class: "end" },
              h("b", { class: waited > 24 * 3600_000 ? "long" : "" }, fmtDuration(waited)),
              "waiting",
            ),
          );
        }),
      )
      : empty("Nothing is waiting. New registrations appear here instantly."),
  );

  // ---- longest inside
  const lon = inside.slice(0, 5);
  const insidePanel = panel(
    "span-6",
    "Longest inside",
    inside.length ? `${inside.length} vehicle${inside.length === 1 ? "" : "s"} inside now` : null,
    "#/inside",
    "Inside now →",
    d.inside.error ? failed("who is inside") : lon.length
      ? h(
        "ul",
        { class: "rows" },
        lon.map((r) => {
          const ms = now - new Date(r.entered_at).getTime();
          return h(
            "li",
            {},
            h("span", { class: "lead in" }, "IN"),
            h(
              "div",
              { class: "main" },
              h("div", { class: "t" }, h("span", { class: "plate" }, r.plate), catTag(r.category)),
              h("div", { class: "s" }, `${d.gates.get(r.gate_id) ?? "—"} · ${r.owner_name}`),
            ),
            h(
              "div",
              { class: "end" },
              h("b", { class: ms > LONG_INSIDE_MS ? "long" : "" }, fmtDuration(ms)),
              "inside",
            ),
          );
        }),
      )
      : empty("No vehicles are inside right now."),
  );

  // ---- recent denials
  const den = d.denials.data ?? [];
  const denialPanel = panel(
    "span-6",
    "Denied scans, last 24 hours",
    null,
    null,
    null,
    d.denials.error ? failed("denied scans") : den.length
      ? h(
        "ul",
        { class: "rows" },
        den.map((r) =>
          h(
            "li",
            {},
            h("span", { class: "lead dot red", "aria-hidden": "true" }),
            h(
              "div",
              { class: "main" },
              h("div", { class: "t" }, denialLabel(r.after?.code)),
              h("div", { class: "s" }, d.plates.get(r.entity_id) ?? "Unknown QR code"),
            ),
            h("div", { class: "end" }, relTime(r.created_at, now)),
          )
        ),
      )
      : empty("No denied scans in the last 24 hours."),
  );

  return [
    stats,
    attention,
    actions,
    h(
      "div",
      { class: "dash-grid" },
      activityPanel,
      gatePanel,
      hourPanel,
      catPanel,
      activityFeed,
      queue,
      insidePanel,
      denialPanel,
    ),
  ];
}
