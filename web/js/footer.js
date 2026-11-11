// Shared footer for every app page. Update content and policy links here.
class SKPassFooter extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    const root = this.attachShadow({ mode: "open" });
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = new URL("../css/footer.css", import.meta.url).href;
    root.append(stylesheet);
    const template = document.createElement("template");
    template.innerHTML = `<footer>
  <div class="inner">
    <div class="identity">
      <img class="footer-logo" src="${
      new URL("../icons/logo.png", import.meta.url).href
    }" width="32" height="32" alt="SKPass" />
      <div><span class="name">SKPass System</span> &mdash; Official Portal of the <strong>Provincial Government</strong>.
        <span class="rights">All rights reserved. Unauthorized access is punishable by law.</span>
      </div>
    </div>
    <nav aria-label="Footer"><a href="#privacy"
            onclick="alert('Privacy Policy: All vehicle registration data is secured in compliance with the Data Privacy Act.'); return false;">Privacy Policy</a><span class="separator" aria-hidden="true">&bull;</span><a href="#terms"
            onclick="alert('Terms of Clearance: All gate passes are non-transferable and subject to security marshal inspection upon perimeter entry.'); return false;">Terms of Clearance</a><span class="separator" aria-hidden="true">&bull;</span><a href="#accessibility"
            onclick="alert('Accessibility: High-contrast responsive design optimized for standard screen readers and high-throughput checkpoint terminals.'); return false;">Accessibility</a><span class="separator" aria-hidden="true">&bull;</span><a href="#gate-protocols"
            onclick="alert('Gate Protocols: Vehicles must slow down to 10 km/h at checkpoint scanners. Display your digital QR pass or physical placard to the guard camera.'); return false;">Gate Protocols</a></nav>
  </div>
</footer>`;
    root.append(template.content.cloneNode(true));
  }
}
customElements.define("skpass-footer", SKPassFooter);
