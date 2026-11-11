import { addDays, downloadText, fmtTime, h, safeTerm, toast, toCsv, todayLocal } from "./util.js";

const PAGE = 50;
const EXPORT_PAGE = 1000;
const EXPORT_MAX = 10000;
const SELECT =
  "id,direction,result,warning,scanned_at,vehicles!inner(plate,owner_name,category),gates(name),profiles:scanned_by(full_name)";

export async function render(root, ctx) {
  const today = todayLocal();
  const f = {
    from: addDays(today, -6),
    to: today,
    gate: "",
    direction: "",
    result: "",
    plate: "",
    page: 0,
  };

  const { data: gates } = await ctx.sb.from("gates").select("id,name").order("name");
  const sel = (opts) => opts.map(([v, l]) => h("option", { value: v }, l));
  const el = {
    from: h("input", { type: "date", value: f.from }),
    to: h("input", { type: "date", value: f.to }),
    gate: h("select", {}, sel([["", "All gates"], ...(gates ?? []).map((g) => [g.id, g.name])])),
    direction: h("select", {}, sel([["", "In & out"], ["IN", "IN only"], ["OUT", "OUT only"]])),
    result: h("select", {}, sel([["", "All results"], ["ok", "OK"], ["warning", "Warnings"]])),
    plate: h("input", { type: "search", placeholder: "Plate", "aria-label": "Plate" }),
  };
  const box = h("div");
  const note = h("p", { class: "muted small" });

  const field = (label, input) => h("div", { class: "field" }, h("label", {}, label), input);
  root.append(
    h("h1", {}, "Logs"),
    h(
      "p",
      { class: "sub" },
      "Every recorded movement, newest first. Dates use this device's local time.",
    ),
    h(
      "div",
      { class: "toolbar" },
      field("From", el.from),
      field("To", el.to),
      field("Gate", el.gate),
      field("Direction", el.direction),
      field("Result", el.result),
      field("Plate", el.plate),
      h("button", { class: "btn", type: "button", onclick: exportCsv }, "Export CSV"),
    ),
    note,
    box,
  );

  function query(count = false) {
    let q = ctx.sb.from("gate_logs").select(SELECT, count ? { count: "exact" } : undefined)
      .order("scanned_at", { ascending: false });
    if (f.from) q = q.gte("scanned_at", new Date(`${f.from}T00:00:00`).toISOString());
    if (f.to) q = q.lt("scanned_at", new Date(`${addDays(f.to, 1)}T00:00:00`).toISOString());
    if (f.gate) q = q.eq("gate_id", f.gate);
    if (f.direction) q = q.eq("direction", f.direction);
    if (f.result) q = q.eq("result", f.result);
    const p = safeTerm(f.plate);
    if (p) q = q.ilike("vehicles.plate", `%${p}%`);
    return q;
  }

  const gateOf = (r) => r.gates?.name ?? "(removed gate)";
  const pill = (r) => h("span", { class: `st ${r.direction}` }, r.direction);

  async function load() {
    const { data, count, error } = await query(true).range(f.page * PAGE, f.page * PAGE + PAGE - 1);
    if (error) {
      return box.replaceChildren(h("div", { class: "alert error" }, "Could not load logs."));
    }
    if (!data.length) {
      return box.replaceChildren(
        h("div", { class: "panel empty" }, "No movements match these filters."),
      );
    }
    const tbody = h("tbody");
    for (const r of data) {
      tbody.append(h(
        "tr",
        {},
        h("td", {}, fmtTime(r.scanned_at, ctx.tz)),
        h("td", {}, h("strong", {}, r.vehicles.plate)),
        h("td", {}, r.vehicles.owner_name),
        h("td", { class: "cat" }, r.vehicles.category),
        h("td", {}, pill(r)),
        h(
          "td",
          {},
          r.warning
            ? h("span", { class: "st warning", title: r.warning }, r.warning.replaceAll("_", " "))
            : h("span", { class: "st ok" }, "ok"),
        ),
        h("td", {}, gateOf(r)),
        h("td", {}, r.profiles?.full_name ?? ""),
      ));
    }
    const pages = Math.max(1, Math.ceil(count / PAGE));
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
              ["Time", "Plate", "Owner", "Category", "Direction", "Result", "Gate", "Guard"].map((
                x,
              ) => h("th", {}, x)),
            ),
          ),
          tbody,
        ),
      ),
      h(
        "div",
        { class: "pager" },
        h(
          "span",
          {},
          `${count} movement${count === 1 ? "" : "s"} · page ${f.page + 1} of ${pages}`,
        ),
        h(
          "span",
          { class: "row-actions" },
          h("button", {
            class: "btn sm ghost",
            type: "button",
            disabled: f.page === 0,
            onclick: () => {
              f.page--;
              load();
            },
          }, "Previous"),
          h("button", {
            class: "btn sm ghost",
            type: "button",
            disabled: f.page + 1 >= pages,
            onclick: () => {
              f.page++;
              load();
            },
          }, "Next"),
        ),
      ),
    );
  }

  async function exportCsv() {
    note.textContent = "Preparing export…";
    const rows = [[
      "Time",
      "Plate",
      "Owner",
      "Category",
      "Direction",
      "Result",
      "Warning",
      "Gate",
      "Guard",
    ]];
    let truncated = false;
    for (let from = 0;; from += EXPORT_PAGE) {
      const { data, error } = await query().range(from, from + EXPORT_PAGE - 1);
      if (error) {
        note.textContent = "";
        return toast("Export failed. Please try again.", "error");
      }
      for (const r of data) {
        rows.push([
          fmtTime(r.scanned_at, ctx.tz),
          r.vehicles.plate,
          r.vehicles.owner_name,
          r.vehicles.category,
          r.direction,
          r.result,
          r.warning ?? "",
          gateOf(r),
          r.profiles?.full_name ?? "",
        ]);
      }
      if (data.length < EXPORT_PAGE) break;
      if (rows.length - 1 >= EXPORT_MAX) {
        truncated = true;
        break;
      }
    }
    downloadText(`skpass-logs-${f.from || "all"}_to_${f.to || "now"}.csv`, toCsv(rows));
    note.textContent = truncated
      ? `Exported the newest ${EXPORT_MAX} rows. Narrow the dates to export the rest.`
      : `Exported ${rows.length - 1} rows.`;
  }

  const apply = () => {
    f.from = el.from.value;
    f.to = el.to.value;
    f.gate = el.gate.value;
    f.direction = el.direction.value;
    f.result = el.result.value;
    f.plate = el.plate.value;
    f.page = 0;
    load();
  };
  for (const k of ["from", "to", "gate", "direction", "result"]) {
    el[k].addEventListener("change", apply);
  }
  let t;
  el.plate.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(apply, 300);
  });
  await load();
}
