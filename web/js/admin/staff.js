import { SUPABASE_URL } from "../config.js";
import { ask, pickMany } from "./dialog.js";
import { tableSkeleton } from "./skeleton.js";
import { attempt, fmtTime, h } from "./util.js";

const FN = `${SUPABASE_URL}/functions/v1/create-staff`;

async function callStaff(ctx, body) {
  const { data: { session } } = await ctx.sb.auth.getSession();
  try {
    const res = await fetch(FN, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.message ??
        ({
          email_exists: "That email already has an account.",
          forbidden: "Only administrators can do this.",
          rate_limited: "Too many requests. Try again later.",
        })[data.error] ??
        "Could not complete the request.";
      throw new Error(msg);
    }
    return { data };
  } catch (e) {
    return { error: e };
  }
}

const PASSWORD_FIELD = {
  name: "password",
  label: "Temporary password",
  type: "password",
  required: true,
  minlength: 10,
  maxlength: 72,
  autocomplete: "new-password",
  hint:
    "At least 10 characters with letters and numbers. Share it securely; they should change it after signing in.",
};

export async function render(root, ctx) {
  const box = h(
    "div",
    {},
    tableSkeleton({
      cols: ["140px", "160px", "80px", "130px", "110px"],
      rows: 5,
      actions: 2,
    }),
  );
  root.append(
    h("h1", {}, "Staff"),
    h("p", { class: "sub" }, "Guards scan at the gates. Administrators manage everything."),
    h(
      "div",
      { class: "toolbar" },
      h("button", { class: "btn", type: "button", onclick: add }, "+ Add staff"),
    ),
    box,
  );

  async function add() {
    const a = await ask({
      title: "Add staff account",
      okText: "Create account",
      fields: [
        { name: "full_name", label: "Full name", required: true, maxlength: 100 },
        { name: "email", label: "Email", type: "email", required: true, autocomplete: "off" },
        {
          name: "role",
          label: "Role",
          type: "select",
          value: "guard",
          options: [{ value: "guard", label: "Guard (scanner only)" }, {
            value: "admin",
            label: "Administrator",
          }],
        },
        PASSWORD_FIELD,
      ],
    });
    if (!a) return;
    const r = await attempt(() => callStaff(ctx, { action: "create", ...a }), "Account created.");
    if (r) {
      await load();
      // a new guard cannot scan until a gate is assigned, so offer that straight away
      const id = r.data?.id;
      if (id && a.role === "guard") {
        await assignGates({ id, full_name: a.full_name, role: "guard" });
      }
    }
  }

  async function assignGates(p) {
    const [{ data: gates }, { data: mine }] = await Promise.all([
      ctx.sb.from("gates").select("id,name,code,location,direction_mode,active").order("name"),
      ctx.sb.from("staff_gates").select("gate_id").eq("profile_id", p.id),
    ]);
    const lane = { both: "entrance + exit", in: "entrance only", out: "exit only" };
    const chosen = await pickMany({
      title: `Gates for ${p.full_name}`,
      intro: "Tick every gate this person may scan at. They only see these on the scanner.",
      options: (gates ?? []).map((g) => ({
        value: g.id,
        label: `${g.name}${g.active ? "" : " (inactive)"}`,
        hint: [g.location, lane[g.direction_mode]].filter(Boolean).join(" \u00b7 "),
      })),
      selected: (mine ?? []).map((m) => m.gate_id),
      okText: "Save gates",
      empty: "No gates yet. Add gates first under Gates.",
    });
    if (!chosen) return;
    await attempt(
      () => ctx.sb.rpc("set_staff_gates", { p_profile_id: p.id, p_gate_ids: chosen }),
      "Gates updated.",
    );
    load();
  }

  async function load() {
    const { data, error } = await ctx.sb.from("profiles").select(
      "id,full_name,email,role,active,created_at",
    ).order("created_at");
    if (error) {
      return box.replaceChildren(h("div", { class: "alert error" }, "Could not load staff."));
    }
    const [{ data: links }, { data: gateList }] = await Promise.all([
      ctx.sb.from("staff_gates").select("profile_id,gate_id"),
      ctx.sb.from("gates").select("id,name"),
    ]);
    const gateName = new Map((gateList ?? []).map((g) => [g.id, g.name]));
    const gatesOf = (id) =>
      (links ?? []).filter((l) => l.profile_id === id).map((l) => gateName.get(l.gate_id))
        .filter(Boolean);
    const tbody = h("tbody");
    for (const p of data) {
      const me = p.id === ctx.profile.id;
      tbody.append(h(
        "tr",
        {},
        h(
          "td",
          {},
          h("strong", {}, p.full_name),
          me ? h("span", { class: "muted" }, " (you)") : null,
        ),
        h("td", {}, p.email ?? "—"),
        h("td", { class: "cat" }, p.role),
        h(
          "td",
          {},
          p.role === "admin" ? h("span", { class: "muted" }, "All gates") : (() => {
            const g = gatesOf(p.id);
            return g.length
              ? h("div", { class: "gate-chips" }, g.map((n) => h("span", {}, n)))
              : h("span", { class: "muted" }, "None assigned");
          })(),
        ),
        h(
          "td",
          {},
          h("span", { class: `st ${p.active ? "ok" : "off"}` }, p.active ? "Active" : "Disabled"),
        ),
        h("td", {}, fmtTime(p.created_at, ctx.tz)),
        h(
          "td",
          {},
          h(
            "div",
            { class: "row-actions" },
            p.role === "guard"
              ? h("button", {
                class: "btn sm",
                type: "button",
                onclick: () => assignGates(p),
              }, "Assign gates")
              : null,
            h("button", {
              class: "btn sm ghost",
              type: "button",
              onclick: async () => {
                const a = await ask({
                  title: `New password for ${p.full_name}`,
                  okText: "Set password",
                  fields: [PASSWORD_FIELD],
                });
                if (a) {
                  await attempt(
                    () =>
                      callStaff(ctx, {
                        action: "set_password",
                        user_id: p.id,
                        password: a.password,
                      }),
                    "Password updated.",
                  );
                }
              },
            }, "Set password"),
            me ? null : h("button", {
              class: "btn sm ghost",
              type: "button",
              onclick: async () =>
                await attempt(
                  () => ctx.sb.from("profiles").update({ active: !p.active }).eq("id", p.id),
                  p.active ? "Account disabled." : "Account enabled.",
                ) && load(),
            }, p.active ? "Disable" : "Enable"),
            me ? null : h("button", {
              class: "btn sm ghost",
              type: "button",
              onclick: async () =>
                await attempt(
                  () =>
                    ctx.sb.from("profiles").update({ role: p.role === "admin" ? "guard" : "admin" })
                      .eq("id", p.id),
                  "Role changed.",
                ) && load(),
            }, p.role === "admin" ? "Make guard" : "Make admin"),
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
              ["Name", "Email", "Role", "Gates", "Status", "Created", ""].map((x) =>
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
