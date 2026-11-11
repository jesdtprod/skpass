import { ask, confirmBox } from "./dialog.js";
import { bone } from "./skeleton.js";
import { attempt, h } from "./util.js";

const MODES = [
  { value: "both", label: "Entrance and exit (auto IN / OUT)" },
  { value: "in", label: "Entrance only (IN)" },
  { value: "out", label: "Exit only (OUT)" },
];
const MODE_TEXT = { both: "Entrance + exit", in: "Entrance only", out: "Exit only" };

export async function render(root, ctx) {
  const box = h(
    "div",
    { style: "display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px" },
    bone("100%", "140px", 14),
    bone("100%", "140px", 14),
    bone("100%", "140px", 14),
  );
  root.append(
    h("h1", {}, "Gates"),
    h(
      "p",
      { class: "sub" },
      "Add as many gates as you need. Give each gate a location and a lane type (entrance, exit, or both). Assign gates to guards under Staff; a guard only sees the gates assigned to them.",
    ),
    h(
      "div",
      { class: "toolbar" },
      h("button", { class: "btn", type: "button", onclick: add }, "+ Add gate"),
    ),
    box,
  );

  async function add() {
    const a = await ask({
      title: "Add gate",
      okText: "Add gate",
      fields: [
        {
          name: "name",
          label: "Name",
          required: true,
          maxlength: 60,
          hint: "Shown to guards, e.g. Main Gate.",
        },
        {
          name: "code",
          label: "Short code",
          required: true,
          maxlength: 12,
          hint: "Unique, e.g. G3.",
        },
        {
          name: "location",
          label: "Location",
          maxlength: 120,
          hint: "Where this gate is, e.g. North Wing, Capitol Road side.",
        },
        {
          name: "direction_mode",
          label: "Lane type",
          type: "select",
          options: MODES,
          value: "both",
        },
      ],
    });
    if (!a) return;
    if (
      await attempt(() =>
        ctx.sb.from("gates").insert({
          name: a.name.trim(),
          code: a.code.trim(),
          location: a.location?.trim() || null,
          direction_mode: a.direction_mode,
        }), "Gate added.")
    ) load();
  }

  async function edit(g) {
    const a = await ask({
      title: `Edit ${g.name}`,
      fields: [
        { name: "name", label: "Name", required: true, maxlength: 60, value: g.name },
        { name: "code", label: "Short code", required: true, maxlength: 12, value: g.code },
        {
          name: "location",
          label: "Location",
          maxlength: 120,
          hint: "Where this gate is, e.g. North Wing, Capitol Road side.",
          value: g.location ?? "",
        },
        {
          name: "direction_mode",
          label: "Lane type",
          type: "select",
          options: MODES,
          value: g.direction_mode,
        },
      ],
    });
    if (!a) return;
    if (
      await attempt(() =>
        ctx.sb.from("gates").update({
          name: a.name.trim(),
          code: a.code.trim(),
          location: a.location?.trim() || null,
          direction_mode: a.direction_mode,
        }).eq("id", g.id), "Saved.")
    ) load();
  }

  async function load() {
    const [{ data, error }, { data: links }] = await Promise.all([
      ctx.sb.from("gates").select("id,code,name,location,active,direction_mode").order("name"),
      ctx.sb.from("staff_gates").select("gate_id,profiles(full_name)"),
    ]);
    const staffByGate = new Map();
    for (const l of links ?? []) {
      const list = staffByGate.get(l.gate_id) ?? [];
      list.push(l.profiles?.full_name ?? "?");
      staffByGate.set(l.gate_id, list);
    }
    if (error) {
      return box.replaceChildren(h("div", { class: "alert error" }, "Could not load gates."));
    }
    if (!data.length) {
      return box.replaceChildren(
        h("div", { class: "panel empty" }, "No gates yet. Add your first gate."),
      );
    }
    const tbody = h("tbody");
    for (const g of data) {
      tbody.append(h(
        "tr",
        {},
        h("td", {}, h("strong", {}, g.name)),
        h("td", {}, g.code),
        h("td", {}, g.location ?? "\u2014"),
        h("td", {}, MODE_TEXT[g.direction_mode]),
        h(
          "td",
          {},
          staffByGate.get(g.id)?.join(", ") ?? h("span", { class: "muted" }, "No guard yet"),
        ),
        h(
          "td",
          {},
          h("span", { class: `st ${g.active ? "ok" : "off"}` }, g.active ? "Active" : "Inactive"),
        ),
        h(
          "td",
          {},
          h(
            "div",
            { class: "row-actions" },
            h("button", { class: "btn sm ghost", type: "button", onclick: () => edit(g) }, "Edit"),
            h("button", {
              class: "btn sm ghost",
              type: "button",
              onclick: async () =>
                await attempt(
                  () => ctx.sb.from("gates").update({ active: !g.active }).eq("id", g.id),
                  g.active ? "Gate deactivated." : "Gate activated.",
                ) && load(),
            }, g.active ? "Deactivate" : "Activate"),
            h("button", {
              class: "btn sm ghost danger-text",
              type: "button",
              onclick: async () => {
                const ok = await confirmBox({
                  title: "Delete gate",
                  message:
                    `${g.name} will disappear from the scanner and lists. Its past scans are kept.`,
                  okText: "Delete",
                  danger: true,
                });
                if (
                  ok &&
                  await attempt(
                    () => ctx.sb.rpc("soft_delete", { p_table: "gates", p_id: g.id }),
                    "Gate deleted.",
                  )
                ) load();
              },
            }, "Delete"),
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
              ["Name", "Code", "Location", "Lane type", "Guards", "Status", ""].map((x) =>
                h("th", {}, x)
              ),
            ),
          ),
          tbody,
        ),
      ),
    );
  }
  await load();
}
