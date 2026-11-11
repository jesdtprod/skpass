// Gate menu backed by the native select used by scanner and offline logic.
export function enhanceGateSelect(select) {
  const wrapper = select.parentElement;
  const label = document.querySelector('label[for="gate"]');
  const choices = [...select.options].filter((option) => option.value && !option.disabled);
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.id = "gate-trigger";
  trigger.className = "gate-trigger";
  trigger.setAttribute("role", "combobox");
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", "gate-options");
  label.id = "assigned-gate-label";
  label.htmlFor = trigger.id;
  trigger.setAttribute("aria-labelledby", label.id + " " + trigger.id);
  trigger.disabled = choices.length === 0;
  const name = document.createElement("span");
  name.className = "gate-trigger-name";
  const detail = document.createElement("span");
  detail.className = "gate-trigger-detail";
  const chevron = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  chevron.setAttribute("viewBox", "0 0 24 24");
  chevron.setAttribute("aria-hidden", "true");
  chevron.innerHTML =
    '<path d="m7 10 5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>';
  trigger.append(name, detail, chevron);
  const list = document.createElement("div");
  list.id = "gate-options";
  list.className = "gate-menu";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-labelledby", label.id);
  list.hidden = true;
  let active = 0;
  const items = choices.map((option, index) => {
    const item = document.createElement("div");
    item.id = `gate-option-${index}`;
    item.className = "gate-menu-option";
    item.setAttribute("role", "option");
    const copy = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = option.dataset.name || option.textContent;
    const sub = document.createElement("small");
    sub.textContent = option.dataset.detail || "";
    sub.hidden = !sub.textContent;
    copy.append(title, sub);
    const check = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    check.setAttribute("viewBox", "0 0 24 24");
    check.setAttribute("aria-hidden", "true");
    check.innerHTML =
      '<path d="m5 12 4 4L19 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>';
    item.append(copy, check);
    item.addEventListener("click", () => choose(index));
    item.addEventListener("pointermove", () => {
      active = index;
      paint();
    });
    list.append(item);
    return item;
  });
  function paint() {
    const selected = select.selectedOptions[0];
    name.textContent = selected?.value
      ? selected.dataset.name || selected.textContent
      : choices.length
      ? "Select assigned gate"
      : "No assigned gates";
    detail.textContent = selected?.value ? selected.dataset.detail || "" : "";
    detail.hidden = !detail.textContent;
    items.forEach((item, index) => {
      item.setAttribute("aria-selected", String(choices[index].value === select.value));
      item.classList.toggle("is-active", index === active);
    });
    if (!list.hidden && items[active]) {
      trigger.setAttribute("aria-activedescendant", items[active].id);
    }
  }
  function position() {
    const rect = trigger.getBoundingClientRect();
    const below = innerHeight - rect.bottom - 16;
    const above = rect.top - 16;
    const up = below < 160 && above > below;
    list.style.width = `${Math.min(rect.width, innerWidth - 24)}px`;
    list.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - rect.width - 12))}px`;
    list.style.maxHeight = `${Math.min(300, Math.max(60, up ? above : below))}px`;
    list.style.top = up ? "auto" : `${rect.bottom + 6}px`;
    list.style.bottom = up ? `${innerHeight - rect.top + 6}px` : "auto";
  }
  function close() {
    list.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    trigger.removeAttribute("aria-activedescendant");
  }
  function open() {
    if (trigger.disabled) return;
    active = Math.max(0, choices.findIndex((option) => option.value === select.value));
    list.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    position();
    paint();
    items[active]?.scrollIntoView({ block: "nearest" });
  }
  function choose(index) {
    select.value = choices[index].value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    paint();
    close();
    trigger.focus({ preventScroll: true });
  }
  trigger.addEventListener("click", () => list.hidden ? open() : close());
  let search = "", searchTimer;
  trigger.addEventListener("keydown", (event) => {
    if (event.key === "Escape" || event.key === "Tab") {
      close();
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (list.hidden) open();
      else {active = event.key === "Home"
          ? 0
          : event.key === "End"
          ? choices.length - 1
          : (active + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length;}
      paint();
      items[active]?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (list.hidden) open();
      else choose(active);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      clearTimeout(searchTimer);
      search += event.key.toLocaleLowerCase();
      searchTimer = setTimeout(() => search = "", 700);
      const index = choices.findIndex((option) =>
        (option.dataset.name || option.textContent).toLocaleLowerCase().startsWith(search)
      );
      if (index >= 0) {
        if (list.hidden) open();
        active = index;
        paint();
        items[active].scrollIntoView({ block: "nearest" });
      }
    }
  });
  list.addEventListener("pointerdown", (event) => event.preventDefault());
  document.addEventListener("pointerdown", (event) => {
    if (!wrapper.contains(event.target) && !list.contains(event.target)) close();
  });
  trigger.addEventListener("blur", close);
  addEventListener("resize", () => {
    if (!list.hidden) position();
  });
  document.addEventListener("scroll", (event) => {
    if (!list.contains(event.target)) close();
  }, true);
  select.addEventListener("change", paint);
  select.hidden = true;
  wrapper.append(trigger);
  document.body.append(list);
  paint();
}
