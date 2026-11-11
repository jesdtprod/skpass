import { fmtTime, h } from "./util.js";
import { openVehicle } from "./vehicle-detail.js";

function since(iso) {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${m} min`;
  const hrs = Math.floor(m / 60);
  return hrs < 24 ? `${hrs} h ${m % 60} min` : `${Math.floor(hrs / 24)} d ${hrs % 24} h`;
}

export async function render(root, ctx) {
  const count = h("span", { class: "muted" });
  const box = h("div");
  root.append(
    h("h1", {}, "Inside now"),
    h(
      "p",
      { class: "sub" },
      "Vehicles whose last scan was an entry. Updates every 30 seconds. ",
      count,
    ),
    box,
  );

  const { data: gates } = await ctx.sb.from("gates").select("id,name");
  const gateName = new Map((gates ?? []).map((g) => [g.id, g.name]));

  async function load() {
    const { data, error } = await ctx.sb.from("v_vehicles_inside")
      .select("vehicle_id,plate,owner_name,category,vehicle_type,color,gate_id,entered_at")
      .order("entered_at", { ascending: false });
    if (error) {
      return box.replaceChildren(h("div", { class: "alert error" }, "Could not load the list."));
    }
    count.textContent = `${data.length} vehicle${data.length === 1 ? "" : "s"} inside.`;
    if (!data.length) {
      return box.replaceChildren(
        h("div", { class: "panel empty" }, "No vehicles are inside right now."),
      );
    }
    const tbody = h("tbody");
    for (const v of data) {
      tbody.append(h(
        "tr",
        { class: "click", onclick: () => openVehicle(ctx, v.vehicle_id) },
        h("td", {}, h("strong", {}, v.plate)),
        h("td", {}, v.owner_name),
        h("td", { class: "cat" }, v.category),
        h("td", {}, [v.vehicle_type, v.color].filter(Boolean).join(", ")),
        h("td", {}, gateName.get(v.gate_id) ?? "—"),
        h("td", {}, fmtTime(v.entered_at, ctx.tz)),
        h("td", {}, since(v.entered_at)),
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
              ["Plate", "Owner", "Category", "Vehicle", "Entered at", "Since", "Inside for"].map((
                x,
              ) => h("th", {}, x)),
            ),
          ),
          tbody,
        ),
      ),
    );
  }
  await load();
  const timer = setInterval(() => !document.hidden && load(), 30000);
  return () => clearInterval(timer);
}
