// Reuse the complete pass view in a native, keyboard-accessible modal.
const trigger = document.querySelector('a[href="my-qr/"]');
if (trigger) {
  const dialog = document.createElement("dialog");
  dialog.className = "qr-modal";
  dialog.setAttribute("aria-labelledby", "qr-modal-title");
  dialog.innerHTML =
    `<div class="qr-modal-heading"><h2 id="qr-modal-title">My QR</h2><button type="button" aria-label="Close My QR">&times;</button></div><div class="qr-modal-body"></div>`;
  document.body.append(dialog);
  const close = () => dialog.close();
  dialog.querySelector("button").addEventListener("click", close);
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (
      event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    ) close();
  });
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.addEventListener("click", (event) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const frame = document.createElement("iframe");
    frame.title = "Saved vehicle QR passes";
    frame.src = new URL("my-qr/?embed=1", location.href).href;
    dialog.querySelector(".qr-modal-body").replaceChildren(frame);
    dialog.showModal();
    document.documentElement.classList.add("qr-modal-open");
  });
  dialog.addEventListener("close", () => {
    document.documentElement.classList.remove("qr-modal-open");
    dialog.querySelector(".qr-modal-body").replaceChildren();
    trigger.focus();
  });
  window.addEventListener("message", (event) => {
    if (
      event.origin === location.origin &&
      event.source === dialog.querySelector("iframe")?.contentWindow &&
      event.data === "skpass:close-qr"
    ) close();
  });
}
