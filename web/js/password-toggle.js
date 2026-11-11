// Adds a show/hide (eye) button to every <input type="password"> on the page, including ones
// created later (e.g. inside dialogs). Works with or without form-controls.js icon wrappers.
// Pair with css/password-toggle.css.

const EYE =
  '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>';
const EYE_OFF =
  '<path d="M3 3l18 18"/><path d="M10.6 6.1A10.7 10.7 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.2 3.9M6.6 6.6A17 17 0 0 0 2 12s3.5 6 10 6a10.5 10.5 0 0 0 4-.8"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>';

const svg = (inner) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;

/** Reflect the input's current state on its toggle button. */
function paint(button, input) {
  const shown = input.type === "text";
  button.innerHTML = svg(shown ? EYE_OFF : EYE);
  button.setAttribute("aria-pressed", String(shown));
  button.setAttribute("aria-label", shown ? "Hide password" : "Show password");
  button.title = shown ? "Hide password" : "Show password";
}

export function enhancePassword(input) {
  if (!(input instanceof HTMLInputElement) || input.dataset.pwToggle) return;
  input.dataset.pwToggle = "1";

  // Use the existing icon wrapper if there is one; otherwise wrap just the input.
  let wrap = input.parentElement;
  if (!wrap.matches(".input-with-icon, .password-field, .relative")) {
    wrap = document.createElement("div");
    wrap.className = "password-field";
    input.before(wrap);
    wrap.append(input);
  }
  wrap.classList.add("has-password-toggle");
  input.classList.add("has-trailing-toggle");

  const button = document.createElement("button");
  button.type = "button";
  button.className = "password-toggle";
  if (input.id) button.setAttribute("aria-controls", input.id);
  paint(button, input);
  wrap.append(button);

  // Keep keyboard focus and the caret in the field when using the mouse/touch.
  button.addEventListener("mousedown", (e) => e.preventDefault());
  button.addEventListener("click", () => {
    const start = input.selectionStart, end = input.selectionEnd;
    input.type = input.type === "password" ? "text" : "password";
    paint(button, input);
    input.focus({ preventScroll: true });
    if (start !== null && end !== null) input.setSelectionRange(start, end);
  });

  // Never leave a password visible after the form is sent (e.g. after a failed sign-in).
  input.form?.addEventListener("submit", () => {
    if (input.type === "text") {
      input.type = "password";
      paint(button, input);
    }
  });
}

export function enhanceAll(root = document) {
  root.querySelectorAll('input[type="password"]').forEach(enhancePassword);
}

enhanceAll();
// Dialogs and other late-created fields.
new MutationObserver((records) => {
  for (const r of records) {
    for (const n of r.addedNodes) {
      if (n.nodeType !== 1) continue;
      if (n.matches?.('input[type="password"]')) enhancePassword(n);
      else enhanceAll(n);
    }
  }
}).observe(document.documentElement, { childList: true, subtree: true });
