// Shared footer for every app page. Update content and policy links here.
// Styled to match the header (see header.js / header.css).
class SKPassFooter extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    const root = this.attachShadow({ mode: "open" });
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = new URL("../css/footer.css?v=alignment-2", import.meta.url).href;
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
      <a href="#privacy" class="policy-link" data-policy="privacy">Privacy Policy</a><span class="divider" aria-hidden="true">|</span><a href="#terms" class="policy-link" data-policy="terms">Terms of Clearance</a><span class="divider" aria-hidden="true">|</span><a href="#accessibility" class="policy-link" data-policy="accessibility">Accessibility</a><span class="divider" aria-hidden="true">|</span><a href="#gate-protocols" class="policy-link" data-policy="protocols">Gate Protocols</a>
      <span class="status" role="status"><i aria-hidden="true"></i><span class="status-text"></span></span>
    </nav>
    <p class="legal">All rights reserved. Unauthorized access is punishable by law.</p>
    </div>
  </div>
</footer>
<dialog class="policy-modal" id="policy-modal" aria-labelledby="policy-dialog-title">
  <div class="modal-card">
    <div class="modal-glow-bar" aria-hidden="true"></div>
    <div class="modal-header">
      <div class="modal-header-info">
        <div class="modal-badge-icon" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            <path d="m9 12 2 2 4-4"/>
          </svg>
        </div>
        <div>
          <h2 id="policy-dialog-title" class="modal-title">Policy &amp; Compliance</h2>
          <p class="modal-subtitle" id="policy-dialog-subtitle">Provincial Security Operations Center</p>
        </div>
      </div>
      <button type="button" class="modal-close-btn" aria-label="Close policy dialog">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
    <div class="modal-body">
      <p class="policy-body-text" id="policy-dialog-content"></p>
      <div class="modal-notice">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="16" x2="12" y2="12"/>
          <line x1="12" y1="8" x2="12.01" y2="8"/>
        </svg>
        <span>Standard operational protocols apply to all vehicles, personnel, and visitors on provincial premises.</span>
      </div>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn-dismiss">Close</button>
    </div>
  </div>
</dialog>`;
    root.append(template.content.cloneNode(true));

    const policies = {
      privacy: {
        title: "Data Privacy Policy",
        subtitle: "Republic Act No. 10173 (Data Privacy Act of 2012)",
        content:
          "All vehicle registration data, driver credentials, phone numbers, and checkpoint timestamps are encrypted and securely stored. Collected information is strictly used for perimeter access validation, authorized vehicle tracking, and security auditing by the Provincial Government. Data is never disclosed to unauthorized parties.",
      },
      terms: {
        title: "Terms of Clearance",
        subtitle: "Perimeter Security & Access Regulations",
        content:
          "All issued gate passes are strictly non-transferable and remain the property of the Provincial Government. Gate passes are subject to physical security marshal inspection and scanner verification upon perimeter entry and departure. Any misuse or credential tampering constitutes automatic revocation and security investigation.",
      },
      accessibility: {
        title: "Accessibility Standards",
        subtitle: "Universal Accessibility & High-Contrast Interface",
        content:
          "SKPass is engineered with high-contrast UI tokens, full screen reader landmarks, keyboard-friendly navigation, and mobile-optimized touch controls to ensure seamless accessibility across high-throughput checkpoint terminals, mobile handsets, and assistive devices.",
      },
      protocols: {
        title: "Vehicle Gate Protocols",
        subtitle: "Checkpoint Clearance Guidelines",
        content:
          "Vehicles must reduce speed to 10 km/h or less when approaching checkpoint scanner lanes. Display your digital QR gate pass or physical permit toward the scanner camera or checkpoint marshal handheld. Wait for green signal confirmation and barrier lift before proceeding.",
      },
    };

    const modal = root.querySelector(".policy-modal");
    const titleEl = root.querySelector("#policy-dialog-title");
    const subtitleEl = root.querySelector("#policy-dialog-subtitle");
    const contentEl = root.querySelector("#policy-dialog-content");
    const closeBtn = root.querySelector(".modal-close-btn");
    const dismissBtn = root.querySelector(".btn-dismiss");

    root.querySelectorAll(".policy-link").forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const key = link.dataset.policy;
        const policy = policies[key];
        if (policy && modal) {
          titleEl.textContent = policy.title;
          subtitleEl.textContent = policy.subtitle;
          contentEl.textContent = policy.content;
          if (typeof modal.showModal === "function") {
            modal.showModal();
          }
        }
      });
    });

    closeBtn?.addEventListener("click", () => modal?.close());
    dismissBtn?.addEventListener("click", () => modal?.close());

    modal?.addEventListener("click", (event) => {
      const card = modal.querySelector(".modal-card");
      if (card && !card.contains(event.target)) {
        modal.close();
      }
    });

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
