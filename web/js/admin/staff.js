import { SUPABASE_URL } from "../config.js";
import { ask } from "./dialog.js";
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
  const box = h("div");
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
    if (r) load();
  }

  async function load() {
    const { data, error } = await ctx.sb.from("profiles").select(
      "id,full_name,email,role,active,created_at",
    ).order("created_at");
    if (error) {
      return box.replaceChildren(h("div", { class: "alert error" }, "Could not load staff."));
    }
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
          h("span", { class: `st ${p.active ? "ok" : "off"}` }, p.active ? "Active" : "Disabled"),
        ),
        h("td", {}, fmtTime(p.created_at, ctx.tz)),
        h(
          "td",
          {},
          h(
            "div",
            { class: "row-actions" },
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
              ["Name", "Email", "Role", "Status", "Created", ""].map((x) => h("th", {}, x)),
            ),
          ),
          tbody,
        ),
      ),
    );
  }
  await load();
}
