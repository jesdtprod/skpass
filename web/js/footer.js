// Shared footer for every app page. Update content and policy links here.
// Styled to match the header (see header.js / header.css).
class SKPassFooter extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    const root = this.attachShadow({ mode: "open" });
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = new URL("../css/footer.css", import.meta.url).href;
    root.append(stylesheet);
    const logo = new URL("../icons/logo.png", import.meta.url).href;
    const template = document.createElement("template");
    template.innerHTML = `<footer>
  <div class="inner">
    <div class="brand">
      <img class="footer-logo" src="${logo}" width="40" height="40" alt="SKPass" />
      <span><strong>SKPass System</strong><small>Official Portal of the Provincial Government</small></span>
    </div>
    <div class="footer-links">
    <nav aria-label="Footer">
      <a href="#privacy"
        onclick="alert('Privacy Policy: All vehicle registration data is secured in compliance with the Data Privacy Act.'); return false;">Privacy Policy</a><span class="divider" aria-hidden="true">|</span><a href="#terms"
        onclick="alert('Terms of Clearance: All gate passes are non-transferable and subject to security marshal inspection upon perimeter entry.'); return false;">Terms of Clearance</a><span class="divider" aria-hidden="true">|</span><a href="#accessibility"
        onclick="alert('Accessibility: High-contrast responsive design optimized for standard screen readers and high-throughput checkpoint terminals.'); return false;">Accessibility</a><span class="divider" aria-hidden="true">|</span><a href="#gate-protocols"
        onclick="alert('Gate Protocols: Vehicles must slow down to 10 km/h at checkpoint scanners. Display your digital QR pass or physical placard to the guard camera.'); return false;">Gate Protocols</a>
      <span class="status" role="status"><i aria-hidden="true"></i><span class="status-text"></span></span>
    </nav>
    <p class="legal">All rights reserved. Unauthorized access is punishable by law.</p>
    </div>
  </div>
</footer>`;
    root.append(template.content.cloneNode(true));

    // The pill shows REAL connection state (not a made-up metric).
    const dot = root.querySelector(".status i");
    const text = root.querySelector(".status-text");
    const update = () => {
      let state = "ok";
      let label = location.protocol === "https:" ? "Secure connection" : "Local connection";
      if (location.protocol !== "https:") state = "warn";
      if (!navigator.onLine) {
        state = "warn";
        label = "Offline";
      }
      dot.dataset.state = state;
      text.textContent = label;
    };
    update();
    addEventListener("online", update);
    addEventListener("offline", update);
  }
}
customElements.define("skpass-footer", SKPassFooter);
