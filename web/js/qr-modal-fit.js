// Fit the embedded pass view to the modal without cropping controls or QR codes.
let frame;
const main = document.querySelector("main");

function fit() {
  if (!main) return;
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    const scale = Math.min(1, (innerHeight - 8) / Math.max(1, main.offsetHeight));
    main.style.transform = `scale(${scale})`;
  });
}

if (new URLSearchParams(location.search).get("embed") === "1" && main) {
  document.documentElement.classList.add("qr-fit-root");
  new ResizeObserver(fit).observe(main);
  new MutationObserver(fit).observe(main, { childList: true, subtree: true });
  globalThis.addEventListener("resize", fit);
  document.fonts.ready.then(fit);
  fit();
}
