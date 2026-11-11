import { ask } from "./dialog.js";
import { attempt, debounce, fmtTime, h, normPlate, phoneSearch, safeTerm } from "./util.js";
import { openVehicle, statusBadge, VEHICLE_TYPES } from "./vehicle-detail.js";

const PAGE = 25;

async function addPass(ctx, onDone) {
  const c = await ask({
    title: "Add a pass",
    intro: "Admin-created passes are approved immediately and get a QR right away.",
    okText: "Next",
    fields: [{
      name: "category",
      label: "Type of pass",
      type: "select",
      options: [
        { value: "visitor", label: "Visitor (date range)" },
        { value: "official", label: "Official" },
        { value: "employee", label: "Employee" },
      ],
    }],
  });
  if (!c) return;
  const common = [
    { name: "plate", label: "Plate number", required: true, maxlength: 15 },
    { name: "owner_name", label: "Owner name", required: true, maxlength: 100 },
    { name: "phone", label: "Phone", type: "tel", required: true, maxlength: 20 },
    {
      name: "vehicle_type",
      label: "Vehicle type",
      type: "select",
      options: VEHICLE_TYPES,
      value: "car",
    },
    { name: "color", label: "Color (optional)", maxlength: 30 },
  ];
  const special = {
    employee: [
      { name: "office", label: "Office", required: true },
      { name: "id_number", label: "Employee ID (optional)" },
      { name: "valid_to", label: "Valid until (optional)", type: "date" },
    ],
    official: [
      { name: "position", label: "Position", required: true },
      { name: "agency", label: "Agency", required: true },
      { name: "valid_to", label: "Valid until (optional)", type: "date" },
    ],
    visitor: [
      { name: "host_name", label: "Who they are visiting", required: true },
      { name: "purpose", label: "Purpose", required: true },
      { name: "valid_from", label: "Valid from", type: "date", required: true },
      { name: "valid_to", label: "Valid until", type: "date", required: true },
    ],
  }[c.category];
  const a = await ask({
    title: `New ${c.category} pass`,
    okText: "Create pass",
    fields: [...special, ...common],
  });
  if (!a) return;
  const payload = { category: c.category, idempotency_key: crypto.randomUUID() };
  for (const [k, v] of Object.entries(a)) {
    if (String(v).trim() !== "") payload[k] = String(v).trim();
  }
  const r = await attempt(
    () => ctx.sb.rpc("admin_create_vehicle", { p: payload }),
    "Pass created.",
  );
  if (r?.data?.id) {
    onDone();
    openVehicle(ctx, r.data.id, onDone);
  }
}

export async function render(root, ctx) {
  const state = { page: 0, status: "", category: "", term: "" };
  const search = h("input", {
    type: "search",
    placeholder: "Plate, name or phone",
    "aria-label": "Search",
  });
  const status = h(
    "select",
    { "aria-label": "Status" },
    [["", "All statuses"], ["pending", "Pending"], ["approved", "Approved"], [
      "rejected",
      "Rejected",
    ], ["blocked", "Blocked"]].map(([v, l]) => h("option", { value: v }, l)),
  );
  const category = h(
    "select",
    { "aria-label": "Category" },
    [["", "All categories"], ["employee", "Employee"], ["official", "Official"], [
      "visitor",
      "Visitor",
    ]].map(([v, l]) => h("option", { value: v }, l)),
  );
  const list = h("div");

  root.append(
    h("h1", {}, "Vehicles"),
    h("p", { class: "sub" }, "Every registered vehicle. Click a row for details and actions."),
    h(
      "div",
      { class: "toolbar" },
      h("div", { class: "field grow" }, h("label", {}, "Search"), search),
      h("div", { class: "field" }, h("label", {}, "Status"), status),
      h("div", { class: "field" }, h("label", {}, "Category"), category),
      h(
        "button",
        { class: "btn", type: "button", onclick: () => addPass(ctx, load) },
        "+ Add pass",
      ),
    ),
    list,
  );

  async function load() {
    let q = ctx.sb.from("vehicles")
      .select(
        "id,plate,owner_name,phone,category,status,vehicle_type,valid_from,valid_to,created_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(state.page * PAGE, state.page * PAGE + PAGE - 1);
    if (state.status) q = q.eq("status", state.status);
    if (state.category) q = q.eq("category", state.category);
    const t = safeTerm(state.term);
    if (t) {
      const parts = [`owner_name.ilike.*${t}*`];
      if (normPlate(t)) parts.push(`plate_norm.ilike.*${normPlate(t)}*`);
      if (phoneSearch(t).length >= 3) parts.push(`phone_norm.ilike.*${phoneSearch(t)}*`);
      q = q.or(parts.join(","));
    }
    const { data, count, error } = await q;
    if (error) {
      return list.replaceChildren(h("div", { class: "alert error" }, "Could not load vehicles."));
    }
    if (!data.length) {
      return list.replaceChildren(h("div", { class: "panel empty" }, "No vehicles match."));
    }
    const tbody = h("tbody");
    for (const v of data) {
      tbody.append(h(
        "tr",
        {
          class: "click",
          onclick: () => openVehicle(ctx, v.id, load),
          tabindex: 0,
          onkeydown: (e) => e.key === "Enter" && openVehicle(ctx, v.id, load),
        },
        h("td", {}, h("strong", {}, v.plate)),
        h("td", {}, v.owner_name),
        h("td", { class: "cat" }, v.category),
        h("td", {}, statusBadge(v.status)),
        h(
          "td",
          {},
          v.valid_from || v.valid_to ? `${v.valid_from ?? "…"} to ${v.valid_to ?? "…"}` : "—",
        ),
        h("td", {}, fmtTime(v.created_at, ctx.tz)),
      ));
    }
    const pages = Math.max(1, Math.ceil(count / PAGE));
    list.replaceChildren(
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
              ["Plate", "Owner", "Category", "Status", "Valid", "Registered"].map((x) =>
                h("th", {}, x)
              ),
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
          `${count} vehicle${count === 1 ? "" : "s"} · page ${state.page + 1} of ${pages}`,
        ),
        h(
          "span",
          { class: "row-actions" },
          h("button", {
            class: "btn sm ghost",
            type: "button",
            disabled: state.page === 0,
            onclick: () => {
              state.page--;
              load();
            },
          }, "Previous"),
          h("button", {
            class: "btn sm ghost",
            type: "button",
            disabled: state.page + 1 >= pages,
            onclick: () => {
              state.page++;
              load();
            },
          }, "Next"),
        ),
      ),
    );
  }

  const reset = () => {
    state.page = 0;
    load();
  };
  search.addEventListener(
    "input",
    debounce(() => {
      state.term = search.value;
      reset();
    }),
  );
  status.addEventListener("change", () => {
    state.status = status.value;
    reset();
  });
  category.addEventListener("change", () => {
    state.category = category.value;
    reset();
  });
  await load();
  // Deep link from the dashboard's "Add a pass" action: #/vehicles?add=1
  if (location.hash.includes("?add=1")) {
    history.replaceState(null, "", "#/vehicles");
    addPass(ctx, load);
  }
}
