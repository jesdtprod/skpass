// Shared site header; edit branding, links, and support behavior here.
class SKPassHeader extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    const root = this.attachShadow({ mode: "open" });
    const base = new URL("../", import.meta.url);
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = new URL("css/header.css?v=fade-1", base).href;
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
      </nav>
    </div></header>`;
    root.append(template.content.cloneNode(true));
    root.querySelector(".support").addEventListener("click", (event) => {
      event.preventDefault();
      alert(
        "Provincial Security Operations Center\n\nGate Marshal Support Hotline: (02) 8920-0000 loc. 4421\nEmail: security-clearance@skpass.gov\nHours: 24/7 Gate Patrol Dispatch",
      );
    });
  }
}
customElements.define("skpass-header", SKPassHeader);
