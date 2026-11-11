import { ask, confirmBox } from "./dialog.js";
import { attempt, h } from "./util.js";

const MODES = [
  { value: "both", label: "Both (auto IN / OUT)" },
  { value: "in", label: "Entry only" },
  { value: "out", label: "Exit only" },
];
const MODE_TEXT = { both: "Both", in: "Entry only", out: "Exit only" };

export async function render(root, ctx) {
  const box = h("div");
  root.append(
    h("h1", {}, "Gates"),
    h(
      "p",
      { class: "sub" },
      "Add as many gates as you need. Guards pick their gate on the scanner. Entry-only and exit-only lanes enable double-entry and double-exit warnings.",
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
          direction_mode: a.direction_mode,
        }).eq("id", g.id), "Saved.")
    ) load();
  }

  async function load() {
    const { data, error } = await ctx.sb.from("gates").select("id,code,name,active,direction_mode")
      .order("name");
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
        h("td", {}, MODE_TEXT[g.direction_mode]),
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
            h("tr", {}, ["Name", "Code", "Lane type", "Status", ""].map((x) => h("th", {}, x))),
          ),
          tbody,
        ),
      ),
    );
  }
  await load();
}
