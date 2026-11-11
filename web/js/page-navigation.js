// One reusable secondary navigation for public portal pages.
class SKPassNavigation extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    const root = this.attachShadow({ mode: "open" });
    const base = new URL("../", import.meta.url);
    const current = location.pathname.replace(/\/$/, "").split("/").pop();
    const paths = {
      home: "M3 10 12 3l9 7v11h-6v-7H9v7H3Z",
      register: "M12 5v14M5 12h14",
      find: "M17 17l4 4M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
      qr: "M3 3h6v6H3Zm12 0h6v6h-6ZM3 15h6v6H3Zm12 0h3v3h3v3h-6Z",
    };
    const items = [
      ["", "Home", "home"],
      ["register", "Register another vehicle", "register"],
      ["my-qr", "My QR", "qr"],
      ["find", "Find my QR", "find"],
    ].filter(([route]) => route !== current);
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = new URL("css/page-navigation.css", base).href;
    root.append(css);
    const nav = document.createElement("nav");
    nav.setAttribute("aria-label", "Portal navigation");
    for (const [route, label, kind] of items) {
      const a = document.createElement("a");
      a.href = new URL(route ? `${route}/` : "./", base).href;
      a.innerHTML =
        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${
          paths[kind]
        }"/></svg>`;
      const text = document.createElement("span");
      text.textContent = label;
      a.append(text);
      nav.append(a);
    }
    root.append(nav);
  }
}
customElements.define("skpass-navigation", SKPassNavigation);
