// Modal dialogs: a generic form dialog and a confirm box, built on <dialog>.
import { h } from "./util.js";

function open(dlg) {
  document.body.append(dlg);
  dlg.showModal();
  return new Promise((resolve) =>
    dlg.addEventListener("close", () => {
      dlg.remove();
      resolve(dlg.returnValue);
    })
  );
}

/**
 * Ask for form input. fields: [{ name, label, type, required, value, options, hint, min, max,
 * maxlength, minlength, autocomplete }]. Resolves to an object of values, or null if cancelled.
 */
export async function ask({ title, intro, fields = [], okText = "Save", danger = false }) {
  const form = h("form", { method: "dialog", class: "dlg-form", novalidate: false });
  const inputs = {};
  for (const f of fields) {
    let input;
    if (f.type === "select") {
      input = h(
        "select",
        { name: f.name, id: `f-${f.name}` },
        f.options.map((o) =>
          h("option", { value: o.value, selected: String(o.value) === String(f.value) }, o.label)
        ),
      );
    } else if (f.type === "textarea") {
      input = h("textarea", { name: f.name, id: `f-${f.name}`, rows: 3 }, f.value ?? "");
    } else {
      input = h("input", { name: f.name, id: `f-${f.name}`, type: f.type ?? "text" });
      if (f.value != null) input.value = f.value;
    }
    for (
      const k of ["required", "min", "max", "maxlength", "minlength", "autocomplete", "pattern"]
    ) {
      // Only real values: required:false must NOT become required="false" (which still means required).
      if (f[k] != null && f[k] !== false) input.setAttribute(k, f[k] === true ? "" : f[k]);
    }
    inputs[f.name] = input;
    form.append(
      h(
        "div",
        { class: "field" },
        h("label", { for: `f-${f.name}` }, f.label),
        input,
        f.hint ? h("p", { class: "muted small" }, f.hint) : null,
      ),
    );
  }
  const err = h("p", { class: "field-error", hidden: true });
  const dlg = h(
    "dialog",
    { class: "dlg" },
    h("h2", {}, title),
    intro ? h("p", { class: "muted" }, intro) : null,
    form,
    err,
    h(
      "div",
      { class: "dlg-actions" },
      h(
        "button",
        { class: "btn ghost", type: "button", onclick: () => dlg.close("cancel") },
        "Cancel",
      ),
      h(
        "button",
        { class: `btn ${danger ? "danger" : ""}`, type: "submit", form: "dlg-form-id" },
        okText,
      ),
    ),
  );
  form.id = "dlg-form-id";
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    // minlength is only enforced by browsers for typed input; check it ourselves (paste, autofill).
    for (const f of fields) {
      if (f.minlength && inputs[f.name].value.length < Number(f.minlength)) {
        err.textContent = `${f.label} must be at least ${f.minlength} characters.`;
        err.hidden = false;
        return;
      }
    }
    err.hidden = true;
    dlg.close("ok");
  });
  const done = open(dlg);
  inputs[fields[0]?.name]?.focus();
  const result = await done;
  if (result !== "ok") return null;
  const out = {};
  for (const f of fields) out[f.name] = inputs[f.name].value;
  return out;
}

export async function confirmBox({ title, message, okText = "Confirm", danger = false }) {
  const dlg = h(
    "dialog",
    { class: "dlg" },
    h("h2", {}, title),
    h("p", {}, message),
    h(
      "div",
      { class: "dlg-actions" },
      h(
        "button",
        { class: "btn ghost", type: "button", onclick: () => dlg.close("cancel") },
        "Cancel",
      ),
      h("button", {
        class: `btn ${danger ? "danger" : ""}`,
        type: "button",
        onclick: () => dlg.close("ok"),
      }, okText),
    ),
  );
  return (await open(dlg)) === "ok";
}

/** Show arbitrary content in a closeable panel. Returns { close, el }. */
export function panel(title, content) {
  const dlg = h(
    "dialog",
    { class: "dlg wide" },
    h(
      "div",
      { class: "dlg-head" },
      h("h2", {}, title),
      h("button", {
        class: "link-btn",
        type: "button",
        "aria-label": "Close",
        onclick: () => dlg.close(),
      }, "✕"),
    ),
    content,
  );
  open(dlg);
  return { close: () => dlg.close(), el: dlg };
}

/**
 * Tick any number of options. options: [{ value, label, hint }]. Resolves to an array of the
 * ticked values, or null if cancelled.
 */
export async function pickMany({ title, intro, options, selected = [], okText = "Save", empty }) {
  const picked = new Set(selected);
  const list = h(
    "div",
    { class: "pick-list" },
    options.length
      ? options.map((o) => {
        const box = h("input", { type: "checkbox", value: o.value });
        box.checked = picked.has(o.value);
        box.addEventListener("change", () =>
          box.checked ? picked.add(o.value) : picked.delete(o.value));
        return h(
          "label",
          { class: "pick-row" },
          box,
          h("span", {}, h("strong", {}, o.label), o.hint ? h("small", {}, o.hint) : null),
        );
      })
      : h("p", { class: "muted" }, empty ?? "Nothing to choose from."),
  );
  const dlg = h(
    "dialog",
    { class: "dlg" },
    h("h2", {}, title),
    intro ? h("p", { class: "muted" }, intro) : null,
    list,
    h(
      "div",
      { class: "dlg-actions" },
      h(
        "button",
        { class: "btn ghost", type: "button", onclick: () => dlg.close("cancel") },
        "Cancel",
      ),
      h("button", { class: "btn", type: "button", onclick: () => dlg.close("ok") }, okText),
    ),
  );
  return (await open(dlg)) === "ok" ? [...picked] : null;
}
