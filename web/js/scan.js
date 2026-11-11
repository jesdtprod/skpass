import { requireStaff, sb, signOut } from "./auth.js";
import {
  describeFailure,
  describeResult,
  isAuthError,
  isForbidden,
  isNetworkError,
  isToken,
  SOUNDS,
  VIBRATION,
} from "./scan-ui.js";

const $ = (id) => document.getElementById(id);
const video = $("video");
const gateSel = $("gate");
const startBtn = $("start");
const torchBtn = $("torch");
const camErr = $("camerr");
const banner = $("banner");
const overlay = $("overlay");

let stream = null;
let torchOn = false;
let busy = false; // a scan request or result screen is active
let started = false;
let lastToken = "";
let lastTokenAt = 0;
let audioCtx = null;
let wakeLock = null;
let overlayTimer = null;

const detector = "BarcodeDetector" in globalThis
  ? new BarcodeDetector({ formats: ["qr_code"] })
  : null;
const canvas = document.createElement("canvas");
const g2d = canvas.getContext("2d", { willReadFrequently: true });

// ------------------------------------------------------------------ setup
const { profile } = await requireStaff();
$("who").textContent = profile.full_name;
$("signout").addEventListener("click", () => signOut());

function setBanner(msg) {
  banner.textContent = msg;
  banner.hidden = !msg;
}
addEventListener("offline", () => setBanner("You are offline. Scans cannot be recorded."));
addEventListener("online", () => setBanner(""));
if (!navigator.onLine) setBanner("You are offline. Scans cannot be recorded.");

async function loadGates() {
  const { data, error } = await sb.from("gates").select("id, code, name, direction_mode")
    .eq("active", true).order("name");
  gateSel.replaceChildren(new Option("Choose a gate…", ""));
  if (error) return setBanner("Could not load gates. Check your connection.");
  for (const g of data) {
    const label = g.direction_mode === "both" ? g.name : `${g.name} (${g.direction_mode} only)`;
    gateSel.append(new Option(label, g.id));
  }
  let saved = "";
  try {
    saved = localStorage.getItem("skpass.gate") ?? "";
  } catch { /* ignore */ }
  if (data.some((g) => g.id === saved)) gateSel.value = saved;
  if (data.length === 0) setBanner("No active gates. Ask an administrator to add one.");
  updateStart();
}
function updateStart() {
  startBtn.disabled = !gateSel.value;
}
gateSel.addEventListener("change", () => {
  try {
    localStorage.setItem("skpass.gate", gateSel.value);
  } catch { /* ignore */ }
  updateStart();
});
await loadGates();

// ------------------------------------------------------------------ feedback
function play(pattern) {
  if (!audioCtx) return;
  let t = audioCtx.currentTime;
  for (const [freq, ms, type] of pattern) {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = 0.25;
    o.connect(g).connect(audioCtx.destination);
    o.start(t);
    o.stop(t + ms / 1000);
    t += ms / 1000 + 0.06;
  }
}

// ------------------------------------------------------------------ camera
function showCamError(msg) {
  camErr.textContent = msg;
  camErr.hidden = !msg;
}

async function startCamera() {
  showCamError("");
  if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    return showCamError("The camera needs a secure (HTTPS) connection.");
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
      audio: false,
    });
  } catch (e) {
    const name = e?.name ?? "";
    return showCamError(
      name === "NotAllowedError" || name === "SecurityError"
        ? "Camera permission was denied. Allow camera access for this site in your browser settings, then reload."
        : name === "NotFoundError" || name === "OverconstrainedError"
        ? "No camera was found on this device."
        : "The camera could not be started. Close other apps using the camera and try again.",
    );
  }
  video.srcObject = stream;
  await video.play().catch(() => {});
  const track = stream.getVideoTracks()[0];
  torchBtn.hidden = !track.getCapabilities?.().torch;
  started = true;
  $("startbox").hidden = true;
  document.body.classList.add("scanning");
  try {
    wakeLock = await navigator.wakeLock?.request("screen");
  } catch { /* optional */ }
  loop();
}

function stopCamera() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  video.srcObject = null;
  started = false;
}

torchBtn.addEventListener("click", async () => {
  const track = stream?.getVideoTracks()[0];
  if (!track) return;
  torchOn = !torchOn;
  try {
    await track.applyConstraints({ advanced: [{ torch: torchOn }] });
    torchBtn.textContent = torchOn ? "Torch: on" : "Torch: off";
  } catch {
    torchOn = false;
  }
});

// Release the camera when the page is hidden (battery, privacy) and resume when it returns.
let wantCamera = false;
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "hidden") {
    stopCamera();
    wakeLock?.release?.().catch(() => {});
  } else if (wantCamera && !started) {
    await startCamera();
  }
});

async function decodeFrame() {
  if (!video.videoWidth) return null;
  if (detector) {
    const codes = await detector.detect(video);
    return codes[0]?.rawValue ?? null;
  }
  const scale = Math.min(1, 640 / video.videoWidth);
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  g2d.drawImage(video, 0, 0, canvas.width, canvas.height);
  const img = g2d.getImageData(0, 0, canvas.width, canvas.height);
  return globalThis.jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" })
    ?.data ?? null;
}

async function loop() {
  if (!started) return;
  if (!busy) {
    try {
      const text = await decodeFrame();
      if (text) await onCode(text.trim());
    } catch { /* transient decode error: keep scanning */ }
  }
  setTimeout(loop, 120);
}

// ------------------------------------------------------------------ scanning
async function onCode(text) {
  const now = Date.now();
  if (text === lastToken && now - lastTokenAt < 4000) return; // same QR still in view
  lastToken = text;
  lastTokenAt = now;
  busy = true;
  if (!isToken(text)) return showResult(describeFailure("notQr"));
  showResult(await scan(text), true);
}

async function scan(token) {
  const key = crypto.randomUUID(); // reused on retry => the server never records it twice
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await sb.rpc("scan_vehicle", {
      p_token: token,
      p_gate_id: gateSel.value,
      p_idempotency_key: key,
    });
    if (!error) return data;
    if (isAuthError(error)) {
      const { error: refreshErr } = await sb.auth.refreshSession();
      if (refreshErr) return describeFailure("session");
      continue;
    }
    if (isForbidden(error)) return describeFailure("forbidden");
    if (isNetworkError(error) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 800));
      continue;
    }
    return describeFailure(isNetworkError(error) ? "offline" : "server");
  }
  return describeFailure("server");
}

// ------------------------------------------------------------------ result screen
function showResult(r, fromServer = false) {
  const d = describeResult(r);
  overlay.className = `overlay ${d.tone}`;
  $("ov-dir").textContent = d.title;
  $("ov-msg").textContent = r.message ?? "";
  $("ov-gate").textContent = r.gate?.name ?? "";
  const v = r.vehicle;
  $("ov-plate").textContent = v?.plate ?? "";
  $("ov-owner").textContent = v?.owner_name ?? "";
  const cat = $("ov-cat");
  cat.textContent = v ? v.category : "";
  cat.className = `badge cat-${v?.category ?? "none"}`;
  cat.hidden = !v;
  const meta = [];
  if (v?.vehicle_type) meta.push(v.vehicle_type + (v.color ? `, ${v.color}` : ""));
  if (v?.category === "visitor" && v.host_name) meta.push(`Visiting ${v.host_name}`);
  if (v?.valid_to) meta.push(`Valid until ${v.valid_to}`);
  $("ov-meta").textContent = meta.join(" · ");
  const photo = $("ov-photo");
  photo.hidden = true;
  photo.removeAttribute("src");
  photo.onerror = () => photo.hidden = true; // never show a broken-image box to the guard
  overlay.hidden = false;

  play(SOUNDS[d.sound]);
  navigator.vibrate?.(VIBRATION[d.sound]);

  if (fromServer && v?.photo_path) {
    sb.storage.from("vehicle-photos").createSignedUrl(v.photo_path, 60).then(({ data }) => {
      if (data?.signedUrl && !overlay.hidden) {
        photo.src = data.signedUrl;
        photo.hidden = false;
      }
    });
  }
  clearTimeout(overlayTimer);
  overlayTimer = setTimeout(dismiss, d.hold);
}

function dismiss() {
  clearTimeout(overlayTimer);
  overlay.hidden = true;
  busy = false;
}
overlay.addEventListener("click", dismiss);

startBtn.addEventListener("click", async () => {
  audioCtx ??= new (globalThis.AudioContext ?? globalThis.webkitAudioContext)();
  await audioCtx.resume?.();
  wantCamera = true;
  await startCamera();
});
