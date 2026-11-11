import { mountCaptcha } from "./captcha.js";
import { registerVehicle } from "./api.js";
import { saveVehicle } from "./store.js";
import { shrinkImage } from "./image.js";

const form = document.getElementById("reg-form");
const submitBtn = document.getElementById("submit");
const alertBox = document.getElementById("alert");
const now = new Date();
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${
  String(now.getDate()).padStart(2, "0")
}`;

// ---- category switch: show only the fields that apply
function showCategory(cat) {
  document.querySelectorAll("[data-cat]").forEach((el) => {
    const on = el.dataset.cat === cat;
    el.hidden = !on;
    el.querySelectorAll("input, select").forEach((i) => i.disabled = !on);
  });
}
form.querySelectorAll('input[name="category"]').forEach((r) =>
  r.addEventListener("change", () => showCategory(r.value))
);
showCategory(form.querySelector('input[name="category"]:checked').value);

form.valid_from.min = today;
form.valid_to.min = today;
form.valid_from.addEventListener(
  "change",
  () => form.valid_to.min = form.valid_from.value || today,
);

// ---- idempotency key survives a failed attempt, so a retry is safe
function requestKey() {
  try {
    let k = sessionStorage.getItem("skpass.reqkey");
    if (!k) {
      k = crypto.randomUUID();
      sessionStorage.setItem("skpass.reqkey", k);
    }
    return k;
  } catch {
    return crypto.randomUUID();
  }
}
function clearRequestKey() {
  try {
    sessionStorage.removeItem("skpass.reqkey");
  } catch { /* ignore */ }
}

// ---- Turnstile
const captcha = mountCaptcha("#captcha");

// ---- messages
function showAlert(msg) {
  alertBox.textContent = msg;
  alertBox.hidden = !msg;
  if (msg) alertBox.scrollIntoView({ behavior: "smooth", block: "center" });
}
function clearFieldErrors() {
  form.querySelectorAll(".field-error").forEach((e) => e.remove());
}
function fieldError(name, msg) {
  const input = form.elements[name];
  if (!input) return;
  const p = document.createElement("p");
  p.className = "field-error";
  p.textContent = msg;
  (input.closest(".field") ?? input).append(p);
}

const GENERIC = {
  captcha_failed: "Captcha check failed. Please try again.",
  rate_limited: "Too many attempts. Please wait a while and try again.",
  plate_already_registered: "This plate number is already registered or waiting for approval.",
  request_key_conflict: "Please reload the page and try again.",
  retry: "Please press Submit once more.",
  network: "No connection. Check your internet and try again.",
  photo_upload_failed: "The photo could not be saved. Try another photo.",
};

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  showAlert("");
  clearFieldErrors();
  if (!captcha.getToken()) return showAlert("Please complete the captcha check.");

  submitBtn.disabled = true;
  submitBtn.textContent = "Submitting…";
  try {
    const fd = new FormData(form);
    fd.set("idempotency_key", requestKey());
    fd.set("turnstile_token", captcha.getToken());
    const photo = form.photo.files[0];
    fd.delete("photo");
    if (photo) fd.set("photo", await shrinkImage(photo), "photo.jpg");

    const { status, data } = await registerVehicle(fd);

    if (status === 201 || status === 200) {
      await saveVehicle({
        vehicle_id: data.vehicle_id,
        claim_secret: data.claim_secret,
        plate: fd.get("plate").toString().toUpperCase(),
        category: fd.get("category"),
        status: data.status,
        details: Object.fromEntries(
          [
            "owner_name",
            "vehicle_type",
            "color",
            "office",
            "position",
            "agency",
            "host_name",
            "purpose",
            "valid_from",
            "valid_to",
          ].filter((key) => fd.has(key)).map((key) => [key, fd.get(key)]),
        ),
      });
      clearRequestKey();
      location.href = `../my-qr/?v=${encodeURIComponent(data.vehicle_id)}&new=1`;
      return;
    }
    if (status === 422 && data.fields) {
      for (const [name, msg] of Object.entries(data.fields)) fieldError(name, msg);
      showAlert("Please fix the highlighted fields.");
    } else {
      showAlert(GENERIC[data.error] ?? "Something went wrong. Please try again.");
    }
    captcha.reset();
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit registration";
  }
});
