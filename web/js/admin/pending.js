import { fmtTime, h } from "./util.js";
import { approveVehicle, openVehicle, rejectVehicle } from "./vehicle-detail.js";

export async function render(root, ctx) {
  root.append(
    h("h1", {}, "Approvals"),
    h(
      "p",
      { class: "sub" },
      "New registrations wait here. A QR code is only created when you approve.",
    ),
  );
  const box = h("div");
  root.append(box);

  async function load() {
    const { data, error } = await ctx.sb.from("vehicles")
      .select(
        "id,plate,owner_name,phone,category,vehicle_type,valid_from,valid_to,created_at,photo_path",
      )
      .eq("status", "pending").order("created_at", { ascending: true });
    if (error) {
      return box.replaceChildren(h("div", { class: "alert error" }, "Could not load approvals."));
    }
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
  await load();
}
