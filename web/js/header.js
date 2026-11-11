// Shared site header; edit branding, links, and support behavior here.
class SKPassHeader extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    const root = this.attachShadow({ mode: "open" });
    const base = new URL("../", import.meta.url);
    // Font faces must load in the document, including pages without theme.css.
    if (!document.getElementById("skpass-shared-fonts")) {
      const fonts = document.createElement("link");
      fonts.id = "skpass-shared-fonts";
      fonts.rel = "stylesheet";
      fonts.href = new URL("css/fonts.css", base).href;
      document.head.append(fonts);
    }
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = new URL("css/header.css?v=fonts-3", base).href;
    root.append(css);
    const template = document.createElement("template");
    template.innerHTML = `<header><div class="inner">
      <a class="brand" href="${base.href}" aria-label="SKPass home">
        <img src="${new URL("icons/logo.png", base).href}" width="40" height="40" alt="SKPass" />
        <span><strong>Provincial Government</strong><small>Digital Access &amp; Security Division</small></span>
      </a>
      <nav aria-label="Site navigation">
        <span class="status"><i aria-hidden="true"></i><span>All Gates Active</span><span class="divider">|</span><b>0.4s Scan Avg</b></span>
        <a class="support" href="#support"><svg class="w-4 h-4" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 14v-3a9 9 0 0 1 18 0v3" />
              <rect x="3" y="11" width="4" height="7" rx="2" />
              <rect x="17" y="11" width="4" height="7" rx="2" />
              <path d="M21 16v2a4 4 0 0 1-4 4h-3" />
              <path d="M11 22h3" />
            </svg><span>Support Desk</span></a>
        <a class="staff" href="${new URL("login/", base).href}">Official Staff Portal &rarr;</a>
        <slot name="header-actions"></slot>
      </nav>
    </div></header>
    <dialog class="support-modal" id="support-modal" aria-labelledby="support-dialog-title">
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
              <h2 id="support-dialog-title" class="modal-title">Provincial Security Operations Center</h2>
              <p class="modal-subtitle">Gate Marshal Support &amp; Perimeter Clearance Desk</p>
            </div>
          </div>
          <button type="button" class="modal-close-btn" aria-label="Close support dialog">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div class="modal-status-strip">
          <span class="live-dot" aria-hidden="true"></span>
          <span class="status-msg">24/7 Gate Patrol Dispatch Active</span>
          <span class="status-pill">Normal Operations</span>
        </div>

        <div class="modal-body">
          <div class="contact-card">
            <div class="card-icon phone" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
              </svg>
            </div>
            <div class="card-details">
              <span class="card-label">Gate Marshal Support Hotline</span>
              <a class="card-link mono" href="tel:0289200000">(02) 8920-0000 <span class="ext">loc. 4421</span></a>
            </div>
          </div>

          <div class="contact-card">
            <div class="card-icon email" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect width="20" height="16" x="2" y="4" rx="2"/>
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
              </svg>
            </div>
            <div class="card-details">
              <span class="card-label">Official Clearance &amp; Verification</span>
              <a class="card-link mono" href="mailto:security-clearance@skpass.gov">security-clearance@skpass.gov</a>
            </div>
          </div>

          <div class="contact-card">
            <div class="card-icon clock" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
            </div>
            <div class="card-details">
              <span class="card-label">Operating Hours</span>
              <span class="card-text">24/7 Gate Patrol Dispatch</span>
            </div>
          </div>

          <div class="modal-notice">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="16" x2="12" y2="12"/>
              <line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
            <span>Present your active QR pass to the nearest gate marshal scanner for immediate checkpoint clearance.</span>
          </div>
        </div>

        <div class="modal-actions">
          <button type="button" class="btn-dismiss">Close Support Desk</button>
        </div>
      </div>
    </dialog>`;
    root.append(template.content.cloneNode(true));

    const modal = root.querySelector(".support-modal");
    const openBtn = root.querySelector(".support");
    const closeBtn = root.querySelector(".modal-close-btn");
    const dismissBtn = root.querySelector(".btn-dismiss");

    openBtn?.addEventListener("click", (event) => {
      event.preventDefault();
      if (typeof modal?.showModal === "function") {
        modal.showModal();
      }
    });

    closeBtn?.addEventListener("click", () => modal?.close());
    dismissBtn?.addEventListener("click", () => modal?.close());

    modal?.addEventListener("click", (event) => {
      const card = modal.querySelector(".modal-card");
      if (card && !card.contains(event.target)) {
        modal.close();
      }
    });
  }
}
customElements.define("skpass-header", SKPassHeader);
