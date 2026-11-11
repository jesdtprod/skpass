import { enhanceCalendar } from "./calendar.js";

const upper = new Set(["owner_name", "plate", "agency", "id_number"]);
const proper = new Set(["office", "position", "purpose", "host_name", "color"]);
function normalize(input) {
  const start = input.selectionStart, end = input.selectionEnd;
  if (upper.has(input.name)) input.value = input.value.toLocaleUpperCase("en");
  if (proper.has(input.name)) {
    input.value = input.value.toLocaleLowerCase("en").replace(
      /(^|[\s\-/])(\p{L})/gu,
      (_, separator, letter) => separator + letter.toLocaleUpperCase("en"),
    );
  }
  if (start !== null && end !== null) input.setSelectionRange(start, end);
}
const form = document.querySelector("#reg-form");
if (form) {
  form.addEventListener("input", (event) => {
    if (event.target instanceof HTMLInputElement && !event.isComposing) normalize(event.target);
  });
  form.addEventListener("compositionend", (event) => normalize(event.target));
  form.addEventListener("submit", () => {
    form.querySelectorAll('input[type="text"]').forEach(normalize);
  }, true);
  form.addEventListener("formdata", (event) => {
    for (const input of form.querySelectorAll('input[type="text"]')) {
      if (!input.disabled && (upper.has(input.name) || proper.has(input.name))) {
        normalize(input);
        event.formData.set(input.name, input.value);
      }
    }
  });
}

const paths = {
  person: '<circle cx="12" cy="8" r="4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
  office:
    '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 21v-4h6v4M8 7h1m6 0h1M8 11h1m6 0h1"/>',
  card:
    '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8" cy="11" r="2"/><path d="M5 16a3 3 0 0 1 6 0m3-7h4m-4 4h4"/>',
  briefcase:
    '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12a20 20 0 0 0 18 0m-9 0v3"/>',
  note: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6m-6 4h6m-6 4h4"/>',
  car:
    '<path d="m5 10 2-5h10l2 5M3 17v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5H3Zm2 0v3m14-3v3M6 13h2m8 0h2"/>',
  palette:
    '<circle cx="8" cy="10" r=".5"/><circle cx="12" cy="7" r=".5"/><circle cx="16" cy="10" r=".5"/><path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-4 2 2 0 0 1 1-4h3a3 3 0 0 0 3-3c0-4-4-7-9-7Z"/>',
  phone:
    '<path d="M7 3H4a1 1 0 0 0-1 1 17 17 0 0 0 17 17 1 1 0 0 0 1-1v-3l-5-2-2 2a13 13 0 0 1-7-7l2-2-2-5Z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',
  lock:
    '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>',
  calendar:
    '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2"/>',
};
const fields = {
  owner_name: "person",
  office: "office",
  id_number: "card",
  position: "briefcase",
  agency: "office",
  host_name: "person",
  purpose: "note",
  plate: "car",
  color: "palette",
  phone: "phone",
  email: "mail",
  password: "lock",
  "vehicle-type-trigger": "car",
};
function addIcon(control, kind) {
  const wrapper = control.parentElement;
  wrapper.classList.add("input-with-icon");
  const icon = document.createElement("span");
  icon.className = "input-leading-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML =
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${
      paths[kind]
    }</svg>`;
  wrapper.append(icon);
  control.classList.add("has-leading-icon");
}
for (const [id, kind] of Object.entries(fields)) {
  const control = document.getElementById(id);
  if (!control) continue;
  if (id === "owner_name") control.parentElement.querySelector(".absolute")?.remove();
  if (
    !control.parentElement.classList.contains("relative") &&
    control.parentElement.classList.contains("field")
  ) {
    const wrapper = document.createElement("div");
    control.before(wrapper);
    wrapper.append(control);
  }
  addIcon(control, kind);
}
document.querySelectorAll('input[type="date"]').forEach((input) => {
  const button = enhanceCalendar(input);
  addIcon(button, "calendar");
});
