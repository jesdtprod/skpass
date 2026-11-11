import { approvalMetrics, localParts } from "./dashboard-calc.js";
import { confirmBox } from "./dialog.js";
import { notifyDecision } from "./notify-owner.js";
import { fmtTime, h, toast } from "./util.js";
import { approveVehicle, openVehicle, rejectVehicle } from "./vehicle-detail.js";

const ICON_REFRESH =
  "M4 4v6h6M20 20v-6h-6M5.6 9a8 8 0 0 1 13.6-2.4L20 10M18.4 15a8 8 0 0 1-13.6 2.4L4 14";
const ICON_CHECK = "M5 13l4 4L19 7";

function svgIcon(d) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (
    const [k, v] of Object.entries({
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
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

function ensureCss() {
  if (document.getElementById("approvals-css")) return;
  document.head.append(h("link", {
    id: "approvals-css",
    rel: "stylesheet",
    href: new URL("../../css/approvals.css", import.meta.url).href,
  }));
}

const two = (n) => String(n).padStart(2, "0");
function kpi(tone, label, value, unit, note, noteHl, fill) {
  return h(
    "div",
    { class: `ap-kpi ${tone}` },
    h("div", { class: "k" }, label),
    h(
      "div",
      { class: "v" },
      h("b", {}, value, unit ? h("small", {}, unit) : null),
      h("span", { class: noteHl ? "hl" : "" }, note),
    ),
    h("div", { class: "bar" }, h("i", { style: `width:${Math.max(0, Math.min(100, fill))}%` })),
  );
}

function avgText(ms) {
  if (ms == null) return ["—", ""];
  const min = Math.round(ms / 60000);
  return min < 60 ? [String(min), "min"] : [`${Math.floor(min / 60)}h ${two(min % 60)}`, "min"];
}

export async function render(root, ctx) {
  ensureCss();
  root.classList.add("approvals-view");
  const pill = h("span", { class: "ap-pill" });
  const refreshBtn = h(
    "button",
    { class: "ap-btn", type: "button" },
    svgIcon(ICON_REFRESH),
    "Refresh Queue",
  );
  const approveAll = h(
    "button",
    { class: "ap-btn primary", type: "button", disabled: true },
    svgIcon(ICON_CHECK),
    "Approve All",
  );
  const kpis = h("div", { class: "ap-kpis" });
  root.append(
    h(
      "header",
      { class: "ap-head" },
      h(
        "div",
        {},
        h("div", { class: "ap-title" }, h("h1", {}, "Approvals"), pill),
        h(
          "p",
          { class: "ap-sub" },
          "New registrations wait here. A QR code is only created and dispatched to the user when you approve.",
        ),
      ),
      h("div", { class: "ap-actions" }, refreshBtn, approveAll),
    ),
    kpis,
  );
  const box = h("div");
  root.append(box);
  let queue = [];

  async function paintKpis(pendingCount) {
    const since = new Date(Date.now() - 48 * 3600_000).toISOString();
    const [a, r] = await Promise.all([
      ctx.sb.from("vehicles").select("created_at,approved_at").is("deleted_at", null)
        .eq("status", "approved").gte("approved_at", since).limit(1000),
      ctx.sb.from("vehicles").select("updated_at").is("deleted_at", null)
        .eq("status", "rejected").gte("updated_at", since).limit(1000),
    ]);
    const m = approvalMetrics({
      pending: pendingCount,
      approved: a.data ?? [],
      rejected: r.data ?? [],
      tz: ctx.tz,
      todayIso: localParts(new Date(), ctx.tz).date,
    });
    const [avg, unit] = avgText(m.avgMs);
    const sign = m.approvedDelta > 0 ? "+" : "";
    kpis.replaceChildren(
      kpi(
        "warn",
        "Awaiting review",
        two(m.pending),
        "",
        m.pending ? "Requires action" : "All clear",
        m.pending > 0,
        m.pendingShare,
      ),
      kpi(
        "",
        "Approved today",
        two(m.approvedToday),
        "",
        `${sign}${m.approvedDelta} vs yesterday (${m.approvedYesterday})`,
        m.approvedDelta > 0,
        m.approvedShare,
      ),
      kpi(
        "bad",
        "Rejected today",
        two(m.rejectedToday),
        "",
        m.rejectedToday ? "Reasons sent to owners" : "None today",
        false,
        m.rejectedShare,
      ),
      kpi(
        "info",
        "Avg processing time",
        avg,
        unit,
        m.avgMs == null ? "No approvals today" : `${m.fastPct}% under 30 min`,
        m.avgMs != null,
        m.fastPct,
      ),
    );
  }

  async function load() {
    const { data, error } = await ctx.sb.from("vehicles")
      .select(
        "id,plate,owner_name,phone,category,vehicle_type,valid_from,valid_to,created_at,photo_path",
      )
      .eq("status", "pending").order("created_at", { ascending: true });
    if (error) {
      return box.replaceChildren(h("div", { class: "alert error" }, "Could not load approvals."));
    }
    queue = data;
    pill.textContent = data.length ? `${data.length} Pending Verification` : "Queue clear";
    pill.classList.toggle("clear", !data.length);
    approveAll.disabled = !data.length;
    approveAll.lastChild.textContent = data.length ? `Approve All (${data.length})` : "Approve All";
    paintKpis(data.length).catch(() => kpis.replaceChildren());
    if (!data.length) {
      return box.replaceChildren(
        h("div", { class: "panel empty" }, "Nothing is waiting for approval."),
      );
    }
    const tbody = h("tbody");
    for (const v of data) {
      tbody.append(h(
        "tr",
        {},
        h("td", {}, h("strong", {}, v.plate)),
        h("td", {}, v.owner_name, h("div", { class: "muted small" }, v.phone)),
        h("td", { class: "cat" }, v.category),
        h(
          "td",
          {},
          v.category === "visitor" ? `${v.valid_from ?? "?"} to ${v.valid_to ?? "?"}` : "—",
        ),
        h("td", {}, fmtTime(v.created_at, ctx.tz)),
        h(
          "td",
          {},
          h(
            "div",
            { class: "row-actions" },
            h("button", {
              class: "btn sm ghost",
              type: "button",
              onclick: () => openVehicle(ctx, v.id, load),
            }, "View"),
            h("button", {
              class: "btn sm",
              type: "button",
              onclick: async () =>
                await approveVehicle(ctx, v) && (await load(), ctx.refreshBadge()),
            }, "Approve"),
            h("button", {
              class: "btn sm danger",
              type: "button",
              onclick: async () =>
                await rejectVehicle(ctx, v) && (await load(), ctx.refreshBadge()),
            }, "Reject"),
          ),
        ),
      ));
    }
    box.replaceChildren(
      h(
        "div",
        { class: "tablewrap" },
        h(
          "table",
          { class: "data" },
          h(
            "thead",
            {},
            h(
              "tr",
              {},
              ["Plate", "Owner", "Category", "Visit dates", "Submitted", ""].map((t) =>
                h("th", {}, t)
              ),
            ),
          ),
          tbody,
        ),
      ),
    );
  }
  refreshBtn.addEventListener("click", async () => {
    refreshBtn.setAttribute("aria-busy", "true");
    await load();
    ctx.refreshBadge?.();
    refreshBtn.removeAttribute("aria-busy");
  });
  approveAll.addEventListener("click", async () => {
    const list = [...queue];
    if (!list.length) return;
    const visitors = list.filter((v) => v.category === "visitor").length;
    const okGo = await confirmBox({
      title: `Approve all ${list.length} registrations?`,
      message: `A QR code is created and sent to each owner.${
        visitors ? ` The ${visitors} visitor pass(es) use the dates the visitor entered.` : ""
      } Review the list first if unsure.`,
      okText: `Approve ${list.length}`,
    });
    if (!okGo) return;
    approveAll.disabled = true;
    let done = 0;
    const failed = [];
    for (const v of list) {
      try {
        const { error } = await ctx.sb.rpc("approve_vehicle", {
          p_vehicle_id: v.id,
          p_valid_from: v.category === "visitor" ? v.valid_from : null,
          p_valid_to: v.category === "visitor" ? v.valid_to : null,
        });
        if (error) throw error;
        done++;
        notifyDecision(ctx, v.id);
      } catch {
        failed.push(v.plate);
      }
    }
    toast(
      failed.length
        ? `${done} approved. Could not approve: ${failed.join(", ")}. Open them to check.`
        : `${done} approved. QR codes are now available.`,
      failed.length ? "error" : "ok",
    );
    await load();
    ctx.refreshBadge?.();
  });
  await load();
}
