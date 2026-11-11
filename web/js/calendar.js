// Local-date picker. The native date input remains the submitted source of truth.
export function enhanceCalendar(input) {
  const wrapper = document.createElement("div");
  wrapper.className = "calendar-control";
  input.before(wrapper);
  wrapper.append(input);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "calendar-trigger";
  button.id = `${input.id}-trigger`;
  const label = document.querySelector(`label[for="${input.id}"]`);
  label.htmlFor = button.id;
  label.id = `${input.id}-label`;
  button.setAttribute("aria-labelledby", `${label.id} ${button.id}`);
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-expanded", "false");
  const panel = document.createElement("div");
  panel.className = "calendar-panel";
  panel.hidden = true;
  panel.id = `${input.id}-calendar`;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", label.textContent.replace("*", "").trim());
  button.setAttribute("aria-controls", panel.id);
  input.hidden = true;
  wrapper.append(button, panel);
  const dateString = (date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${
      String(date.getDate()).padStart(2, "0")
    }`;
  const parse = (value) => new Date(`${value}T12:00:00`);
  let month = new Date(), focusDate = "";
  function sync() {
    button.textContent = input.value
      ? parse(input.value).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
      : "Select date";
    button.disabled = input.disabled;
  }
  function close(restore = false) {
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
    if (restore) button.focus();
  }
  function isAllowed(value) {
    return (!input.min || value >= input.min) && (!input.max || value <= input.max);
  }
  function render(focus = false) {
    panel.replaceChildren();
    const header = document.createElement("div");
    header.className = "calendar-heading";
    const title = document.createElement("strong");
    title.textContent = month.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    title.setAttribute("aria-live", "polite");
    header.append(title);
    for (
      const [offset, text, name] of [[-1, "\u2039", "Previous month"], [1, "\u203a", "Next month"]]
    ) {
      const nav = document.createElement("button");
      nav.type = "button";
      nav.textContent = text;
      nav.setAttribute("aria-label", name);
      const adjacent = new Date(month.getFullYear(), month.getMonth() + offset, 1);
      const end = dateString(new Date(adjacent.getFullYear(), adjacent.getMonth() + 1, 0));
      nav.disabled = (input.min && end < input.min) ||
        (input.max && dateString(adjacent) > input.max);
      nav.addEventListener("click", () => {
        month = adjacent;
        render();
        panel.querySelector(`[aria-label="${name}"]`).focus();
      });
      header.append(nav);
    }
    panel.append(header);
    const grid = document.createElement("div");
    grid.className = "calendar-grid";
    for (const day of ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]) {
      const span = document.createElement("span");
      span.textContent = day;
      grid.append(span);
    }
    const year = month.getFullYear(), m = month.getMonth();
    const start = new Date(year, m, 1).getDay(), days = new Date(year, m + 1, 0).getDate();
    for (let i = 0; i < start; i++) grid.append(document.createElement("span"));
    const today = dateString(new Date());
    for (let day = 1; day <= days; day++) {
      const date = new Date(year, m, day), value = dateString(date);
      const cell = document.createElement("button");
      cell.type = "button";
      cell.textContent = day;
      cell.dataset.date = value;
      cell.disabled = !isAllowed(value);
      cell.setAttribute("aria-label", date.toLocaleDateString("en-US", { dateStyle: "full" }));
      if (value === today) cell.setAttribute("aria-current", "date");
      if (value === input.value) {
        cell.classList.add("selected");
        cell.setAttribute("aria-pressed", "true");
      }
      cell.addEventListener("click", () => {
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        sync();
        close(true);
      });
      cell.addEventListener("keydown", (event) => {
        const shifts = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
        if (!(event.key in shifts)) return;
        event.preventDefault();
        const next = new Date(year, m, day + shifts[event.key]);
        if (!isAllowed(dateString(next))) return;
        month = next;
        focusDate = dateString(next);
        render(true);
      });
      grid.append(cell);
    }
    panel.append(grid);
    if (focus) {
      (panel.querySelector(`[data-date="${focusDate}"]`) ||
        grid.querySelector("button:not(:disabled)"))?.focus();
    }
  }
  button.addEventListener("click", () => {
    if (!panel.hidden) return close();
    const value = input.value ||
      (input.min && dateString(new Date()) < input.min ? input.min : dateString(new Date()));
    month = parse(value);
    focusDate = value;
    render();
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
    render(true);
  });
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    }
  });
  wrapper.addEventListener("focusout", () =>
    setTimeout(() => {
      if (!wrapper.contains(document.activeElement)) close();
    }));
  document.addEventListener("click", (event) => {
    if (!wrapper.contains(event.target)) close();
  });
  new MutationObserver(sync).observe(input, {
    attributes: true,
    attributeFilter: ["disabled", "min", "max"],
  });
  input.addEventListener("change", sync);
  input.form.addEventListener("reset", () =>
    setTimeout(() => {
      sync();
      close();
    }));
  sync();
  return button;
}
