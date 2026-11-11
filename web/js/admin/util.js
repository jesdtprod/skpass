// Small DOM/format helpers for the admin dashboard. All user data goes through textContent.

export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

export function fmtTime(iso, tz) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-PH", {
      timeZone: tz,
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return String(iso);
  }
}

export function toast(
  msg,
  kind = "ok",
  title = kind === "error" ? "Unable to complete action" : "System notification",
) {
  const box = document.getElementById("toasts");
  if (!box) return null;
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (
    const [key, value] of Object.entries({
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "1.8",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
    })
  ) icon.setAttribute(key, value);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute(
    "d",
    kind === "error"
      ? "m12 3 10 18H2L12 3Zm0 6v5m0 3h.01"
      : "M9 12l2 2 4-4M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  );
  icon.append(path);
  const close = h("button", {
    class: "toast-close",
    type: "button",
    "aria-label": "Dismiss notification",
  }, "×");
  const t = h(
    "div",
    { class: `toast ${kind}`, role: kind === "error" ? "alert" : "status" },
    h("span", { class: "toast-icon" }, icon),
    h("div", { class: "toast-copy" }, h("strong", {}, title), h("p", {}, msg)),
    close,
  );
  let remaining = kind === "error" ? 8000 : 6000;
  let started, timer;
  const dismiss = () => {
    clearTimeout(timer);
    t.remove();
  };
  const pause = () => {
    if (!timer) return;
    clearTimeout(timer);
    remaining -= performance.now() - started;
    timer = null;
  };
  const resume = () => {
    if (timer || t.matches(":hover") || t.contains(document.activeElement)) return;
    started = performance.now();
    timer = setTimeout(dismiss, Math.max(0, remaining));
  };
  close.addEventListener("click", (event) => {
    event.stopPropagation();
    dismiss();
  });
  t.addEventListener("pointerenter", pause);
  t.addEventListener("pointerleave", resume);
  t.addEventListener("focusin", pause);
  t.addEventListener("focusout", () => queueMicrotask(resume));
  box.append(t);
  resume();
  return t;
}

/** Make a database/RPC/function error readable. */
export function errMsg(err) {
  const m = String(err?.message ?? err ?? "");
  if (/forbidden|42501|permission denied/i.test(m) || err?.code === "42501") {
    return "You do not have permission to do that.";
  }
  if (/duplicate key|23505/.test(m) || err?.code === "23505") {
    return "That already exists (for example, this plate or gate code is in use).";
  }
  if (/fetch|network/i.test(m)) return "No connection. Check your internet and try again.";
  return m.replace(/^invalid_state: /, "") || "Something went wrong.";
}

/** Run an async action: toast the error and return null instead of throwing. */
export async function attempt(fn, okMsg) {
  try {
    const r = await fn();
    if (r?.error) throw r.error;
    if (okMsg) toast(okMsg);
    return r ?? true;
  } catch (e) {
    toast(errMsg(e), "error");
    return null;
  }
}

// ---- CSV (RFC 4180) with spreadsheet-formula protection
export function csvCell(v) {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // stop Excel/Sheets from running it as a formula
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}
export const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(",")).join("\r\n");

export function downloadText(name, text, type = "text/csv;charset=utf-8") {
  const blob = new Blob(["﻿", text], { type }); // BOM so Excel reads UTF-8
  const a = h("a", { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** Strip characters that would break PostgREST filter syntax. */
export const safeTerm = (q) => String(q ?? "").replace(/[,()*%\\:]/g, " ").trim().slice(0, 60);
export const normPlate = (p) => String(p ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
export const digits = (p) => String(p ?? "").replace(/\D/g, "");
/** Digits for searching phone_norm: drop a leading 0 / 63 so "0917…" and "+63917…" find "917…". */
export const phoneSearch = (p) => digits(p).replace(/^(63|0)/, "");

export function debounce(fn, ms = 300) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${
    String(d.getDate()).padStart(2, "0")
  }`;
};
export const todayLocal = () => addDays(new Date().toLocaleDateString("en-CA"), 0);
