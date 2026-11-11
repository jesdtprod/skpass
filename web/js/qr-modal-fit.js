// Fit the embedded pass view to the modal without cropping controls or QR codes.
if (new URLSearchParams(location.search).get("embed") === "1") {
  const main = document.querySelector("main");
  document.documentElement.classList.add("qr-fit-root");
  let frame;
  function fit() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const scale = Math.min(1, (innerHeight - 8) / Math.max(1, main.offsetHeight));
      main.style.transform = `scale(${scale})`;
    });
  }
  new ResizeObserver(fit).observe(main);
  new MutationObserver(fit).observe(main, { childList: true, subtree: true });
  window.addEventListener("resize", fit);
  document.fonts.ready.then(fit);
  fit();
}
