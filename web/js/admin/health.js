import { fmtTime, h } from "./util.js";

const DAY = 864e5;
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();

async function count(q) {
  const { count: n, error } = await q;
  return error ? null : n ?? 0;
}

const card = (n, label, hint, warn = false) =>
  h(
    "div",
    { class: `stat ${warn ? "warn" : ""}`, title: hint },
    h("div", { class: "n" }, n === null ? "?" : String(n)),
    h("div", { class: "l" }, label),
  );

export async function render(root, ctx) {
  const sb = ctx.sb;
  root.append(
    h("h1", {}, "System health"),
    h("p", { class: "sub" }, "What went wrong recently, and how the offline scanners are doing."),
  );

  const [errors24, errors7, offline7, denied24, warnings24] = await Promise.all([
    count(
      sb.from("client_errors").select("id", { count: "exact", head: true }).gte(
        "created_at",
        iso(DAY),
      ),
    ),
    count(
      sb.from("client_errors").select("id", { count: "exact", head: true }).gte(
        "created_at",
        iso(7 * DAY),
      ),
    ),
    count(
      sb.from("gate_logs").select("id", { count: "exact", head: true }).eq("source", "offline").gte(
        "created_at",
        iso(7 * DAY),
      ),
    ),
    count(
      sb.from("audit_logs").select("id", { count: "exact", head: true }).eq("action", "scan_denied")
        .gte("created_at", iso(DAY)),
    ),
    count(
      sb.from("gate_logs").select("id", { count: "exact", head: true }).eq("result", "warning").gte(
        "created_at",
        iso(DAY),
      ),
    ),
  ]);

  root.append(
    h(
      "div",
      { class: "stats" },
      card(
        errors24,
        "App errors (24 h)",
        "Unexpected browser errors reported by the apps",
        errors24 > 0,
      ),
      card(errors7, "App errors (7 days)", "", false),
      card(
        offline7,
        "Offline scans synced (7 days)",
        "Scans recorded by guards while offline, sent later",
      ),
      card(
        denied24,
        "Denied scans (24 h)",
        "Blocked, expired, unregistered or unapproved QR codes",
        false,
      ),
      card(warnings24, "Gate warnings (24 h)", "Double entries / exits and similar", false),
    ),
  );

  const { data, error } = await sb.from("client_errors")
    .select("id,app,message,stack,url,user_agent,count,created_at")
    .order("created_at", { ascending: false }).limit(50);

  root.append(h("h2", {}, "Recent app errors"));
  if (error) {
    root.append(h("div", { class: "alert error" }, "Could not load the error list."));
    return;
  }
  if (!data.length) {
    root.append(h("div", { class: "panel empty" }, "No errors have been reported. 🎉"));
    return;
  }

  const tbody = h("tbody");
  for (const e of data) {
    const row = h(
      "tr",
      { class: "click", tabindex: 0 },
      h("td", {}, fmtTime(e.created_at, ctx.tz)),
      h("td", {}, h("span", { class: "st off" }, e.app)),
      h("td", {}, e.message),
      h("td", {}, shortUa(e.user_agent)),
    );
    const detail = h(
      "tr",
      { hidden: true },
      h(
        "td",
        { colspan: 4 },
        h(
          "pre",
          { class: "small", style: "white-space:pre-wrap;margin:0" },
          [e.url ?? "", "", e.stack ?? "(no stack)"].join("\n"),
        ),
      ),
    );
    const toggle = () => {
      detail.hidden = !detail.hidden;
    };
    row.addEventListener("click", toggle);
    row.addEventListener("keydown", (ev) => ev.key === "Enter" && toggle());
    tbody.append(row, detail);
  }
  root.append(
    h(
      "div",
      { class: "tablewrap" },
      h(
        "table",
        { class: "data" },
        h("thead", {}, h("tr", {}, ["Time", "App", "Error", "Device"].map((x) => h("th", {}, x)))),
        tbody,
      ),
    ),
    h(
      "p",
      { class: "muted small" },
      "Click a row for details. Tokens, emails and long numbers are removed before anything is stored. The same error from one device is stored at most 3 times an hour.",
    ),
  );
}

/** "Mozilla/5.0 (Linux; Android 14; ...) Chrome/126" -> "Android · Chrome" */
export function shortUa(ua) {
  const s = String(ua ?? "");
  const os = /Android/.test(s)
    ? "Android"
    : /iPhone|iPad/.test(s)
    ? "iOS"
    : /Windows/.test(s)
    ? "Windows"
    : /Mac OS/.test(s)
    ? "macOS"
    : /Linux/.test(s)
    ? "Linux"
    : "";
  const br = /Edg\//.test(s)
    ? "Edge"
    : /Firefox\//.test(s)
    ? "Firefox"
    : /Chrome\//.test(s)
    ? "Chrome"
    : /Safari\//.test(s)
    ? "Safari"
    : "";
  return [os, br].filter(Boolean).join(" · ") || "unknown";
}
