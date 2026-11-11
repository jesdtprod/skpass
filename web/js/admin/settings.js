import { attempt, h, toast } from "./util.js";

// key -> how to edit/validate it. Values are stored as JSON in settings.value.
const DEFS = [
  { key: "org_name", label: "Organisation name", kind: "text", max: 100 },
  {
    key: "timezone",
    label: "Time zone",
    kind: "tz",
    hint: "Used for validity dates and daily totals, e.g. Asia/Manila.",
  },
  {
    key: "cooldown_seconds",
    label: "Duplicate-scan cooldown (seconds)",
    kind: "int",
    min: 0,
    max: 60,
    hint: "A second scan of the same vehicle within this time is ignored.",
  },
  {
    key: "anti_passback_mode",
    label: "Double entry / exit",
    kind: "select",
    options: [["warn", "Warn (record it, flag it)"], ["block", "Block (refuse the scan)"]],
    hint: "Applies to entry-only and exit-only gates.",
  },
  { key: "visitor_max_days", label: "Longest visitor pass (days)", kind: "int", min: 1, max: 365 },
  {
    key: "log_retention_days",
    label: "Log retention (days)",
    kind: "int",
    min: 30,
    max: 3650,
    hint: "Recorded for policy. Automatic deletion is not enabled yet.",
  },
];

function validTz(tz) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function render(root, ctx) {
  root.append(
    h("h1", {}, "Settings"),
    h("p", { class: "sub" }, "System-wide rules. Changes apply immediately."),
  );
  const { data, error } = await ctx.sb.from("settings").select("key,value");
  if (error) return root.append(h("div", { class: "alert error" }, "Could not load settings."));
  const cur = Object.fromEntries(data.map((r) => [r.key, r.value]));

  const form = h("form", { class: "card", novalidate: true });
  const inputs = {};
  for (const d of DEFS) {
    let input;
    if (d.kind === "select") {
      input = h(
        "select",
        { id: `s-${d.key}` },
        d.options.map(([v, l]) => h("option", { value: v, selected: cur[d.key] === v }, l)),
      );
    } else {
      input = h("input", { id: `s-${d.key}`, type: d.kind === "int" ? "number" : "text" });
      input.value = cur[d.key] ?? "";
      if (d.kind === "int") {
        input.min = d.min;
        input.max = d.max;
        input.step = 1;
      }
      if (d.max && d.kind === "text") input.maxLength = d.max;
    }
    inputs[d.key] = input;
    form.append(
      h(
        "div",
        { class: "field" },
        h("label", { for: `s-${d.key}` }, d.label),
        input,
        d.hint ? h("p", { class: "muted small" }, d.hint) : null,
      ),
    );
  }
  const err = h("p", { class: "field-error", hidden: true });
  form.append(err, h("button", { class: "btn", type: "submit" }, "Save settings"));
  root.append(h("div", { style: "max-width:520px" }, form));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.hidden = true;
    const changes = [];
    for (const d of DEFS) {
      const raw = inputs[d.key].value.trim();
      let val = raw;
      if (d.kind === "int") {
        val = Number(raw);
        if (!Number.isInteger(val) || val < d.min || val > d.max) {
          err.textContent = `${d.label} must be a whole number from ${d.min} to ${d.max}.`;
          err.hidden = false;
          return;
        }
      } else if (d.kind === "tz" && !validTz(raw)) {
        err.textContent = "That is not a valid time zone (try Asia/Manila).";
        err.hidden = false;
        return;
      } else if (d.kind === "text" && !raw) {
        err.textContent = `${d.label} cannot be empty.`;
        err.hidden = false;
        return;
      }
      if (JSON.stringify(val) !== JSON.stringify(cur[d.key])) changes.push([d.key, val]);
    }
    if (!changes.length) return toast("Nothing changed.");
    let ok = true;
    for (const [key, value] of changes) {
      const r = await attempt(() => ctx.sb.from("settings").update({ value }).eq("key", key));
      if (!r) ok = false;
      else cur[key] = value;
    }
    if (ok) {
      toast("Settings saved.");
      if (changes.some(([k]) => k === "timezone")) ctx.tz = cur.timezone;
    }
  });
}
