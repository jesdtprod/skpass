// Registers the service worker and exposes the "Add to Home Screen" prompt.
let deferredPrompt = null;

if ("serviceWorker" in navigator) {
  globalThis.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => {
      console.warn("Service worker registration failed", err);
    });
  });
}

globalThis.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  document.querySelectorAll("[data-install]").forEach((el) => el.hidden = false);
});

document.addEventListener("click", async (e) => {
  if (!e.target.closest("[data-install]") || !deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  document.querySelectorAll("[data-install]").forEach((el) => el.hidden = true);
});
