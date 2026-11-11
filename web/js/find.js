import { findMyQr } from "./api.js";
import { saveVehicle } from "./store.js";
import { mountCaptcha } from "./captcha.js";

const form = document.getElementById("find-form");
const alertBox = document.getElementById("alert");
const btn = document.getElementById("submit");
const skeleton = document.getElementById("search-skeleton");
const captcha = mountCaptcha("#captcha");

const initialPlate = new URLSearchParams(location.search).get("plate");
if (initialPlate && form?.plate) {
  form.plate.value = initialPlate.toUpperCase();
}

form.plate.addEventListener("input", () => {
  const start = form.plate.selectionStart, end = form.plate.selectionEnd;
  form.plate.value = form.plate.value.toUpperCase();
  form.plate.setSelectionRange(start, end);
});

function show(msg, kind = "error") {
  alertBox.textContent = msg;
  alertBox.className = `alert ${kind}`;
  alertBox.hidden = !msg;
}

const MESSAGES = {
  captcha_failed: "Captcha check failed. Please try again.",
  rate_limited: "Too many attempts. Please wait a while and try again.",
  bad_request: "Please enter your plate number and the mobile number you registered with.",
  network: "No connection. Check your internet and try again.",
};

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  show("");
  if (!captcha.getToken()) return show("Please complete the captcha check.");
  btn.disabled = true;
  btn.innerHTML =
    '<span class="inline-block w-4 h-4 border-2 border-slate-950/30 border-t-slate-950 rounded-full animate-spin"></span> <span>Searching…</span>';
  if (skeleton) {
    skeleton.hidden = false;
    skeleton.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  try {
    const { status, data } = await findMyQr(form.plate.value, form.phone.value, captcha.getToken());
    if (status === 200 && data.found) {
      await saveVehicle({
        vehicle_id: data.vehicle_id,
        claim_secret: data.claim_secret,
        plate: data.plate,
        category: data.category,
        status: data.status,
        token: data.token,
        view: {
          status: data.status,
          category: data.category,
          plate: data.plate,
          owner_name: data.owner_name,
          vehicle_type: data.vehicle_type,
          color: data.color,
          office: data.office,
          position: data.position,
          agency: data.agency,
          host_name: data.host_name,
          purpose: data.purpose,
          created_at: data.created_at,
          valid_from: data.valid_from,
          valid_to: data.valid_to,
          token: data.token,
          expired: data.expired,
          not_yet_valid: data.not_yet_valid,
        },
      });
      location.href = `../my-qr/?v=${encodeURIComponent(data.vehicle_id)}`;
      return;
    }
    if (skeleton) skeleton.hidden = true;
    if (status === 200) {
      show(
        "No approved vehicle matches those details. Check the plate and number. If you registered recently, your request may still be waiting for approval.",
        "warn",
      );
    } else {
      show(MESSAGES[data.error] ?? "Something went wrong. Please try again.");
    }
    captcha.reset();
  } catch (_err) {
    if (skeleton) skeleton.hidden = true;
    show("No connection. Check your internet and try again.");
    captcha.reset();
  } finally {
    btn.disabled = false;
    btn.innerHTML =
      '<svg class="w-4 h-4 text-slate-950" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg> <span>Find my QR</span>';
  }
});
