// Enhance the vehicle selector while preserving its native form value.
const select = document.querySelector("#vehicle_type");
if (select) {
  const wrapper = select.parentElement;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "dropdown-trigger";
  button.setAttribute("role", "combobox");
  button.id = "vehicle-type-trigger";
  button.setAttribute("aria-haspopup", "listbox");
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-labelledby", "vehicle-type-label vehicle-type-trigger");
  const label = document.querySelector('label[for="vehicle_type"]');
  label.id = "vehicle-type-label";
  label.htmlFor = button.id;
  const list = document.createElement("div");
  list.id = "vehicle-type-options";
  list.className = "dropdown-options";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-labelledby", label.id);
  list.hidden = true;
  button.setAttribute("aria-controls", list.id);
  let active = select.selectedIndex;
  const options = [...select.options].map((option, index) => {
    const item = document.createElement("div");
    item.id = `vehicle-type-option-${index}`;
    item.setAttribute("role", "option");
    item.textContent = option.textContent;
    item.addEventListener("click", () => choose(index));
    list.append(item);
    return item;
  });
  function render() {
    button.textContent = select.selectedOptions[0]?.textContent || "";
    options.forEach((option, index) => {
      option.setAttribute("aria-selected", String(index === select.selectedIndex));
      option.classList.toggle("active", index === active);
    });
    button.setAttribute("aria-activedescendant", options[active].id);
  }
  function open() {
    active = select.selectedIndex;
    list.hidden = false;
    button.setAttribute("aria-expanded", "true");
    render();
    options[active].scrollIntoView({ block: "nearest" });
  }
  function close() {
    list.hidden = true;
    button.setAttribute("aria-expanded", "false");
    button.removeAttribute("aria-activedescendant");
  }
  function choose(index) {
    select.selectedIndex = active = index;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    render();
    close();
    button.focus();
  }
  button.addEventListener("click", () => list.hidden ? open() : close());
  let search = "", searchTimer;
  button.addEventListener("keydown", (event) => {
    const key = event.key;
    if (key === "Escape" || key === "Tab") {
      close();
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(key)) {
      event.preventDefault();
      if (list.hidden) open();
      else {active = key === "Home"
          ? 0
          : key === "End"
          ? options.length - 1
          : (active + (key === "ArrowDown" ? 1 : -1) + options.length) % options.length;}
      render();
      options[active].scrollIntoView({ block: "nearest" });
    } else if (key === "Enter" || key === " ") {
      event.preventDefault();
      if (list.hidden) open();
      else choose(active);
    } else if (key.length === 1 && !event.ctrlKey && !event.metaKey) {
      clearTimeout(searchTimer);
      search += key.toLowerCase();
      searchTimer = setTimeout(() => search = "", 600);
      const index = options.findIndex((item) => item.textContent.toLowerCase().startsWith(search));
      if (index >= 0) {
        if (list.hidden) open();
        active = index;
        render();
        options[active].scrollIntoView({ block: "nearest" });
      }
    }
  });
  document.addEventListener("click", (event) => {
    if (!wrapper.contains(event.target)) close();
  });
  select.addEventListener("change", render);
  select.form.addEventListener("reset", () =>
    setTimeout(() => {
      active = select.selectedIndex;
      render();
      close();
    }));
  select.hidden = true;
  wrapper.classList.add("custom-dropdown");
  wrapper.append(button, list);
  render();
}
