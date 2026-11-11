import { requireStaff, sb, signOut } from "./auth.js";
import { enhanceGateSelect } from "./gate-dropdown.js";
import {
  createQueue,
  isNearExpiry,
  needsAttention,
  openStore,
  syncQueue,
} from "./offline-queue.js";
import {
  describeFailure,
  describeResult,
  isAuthError,
  isForbidden,
  isNetworkError,
  isToken,
  queuedResult,
  resultVehicleDetails,
  SOUNDS,
  syncBarState,
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
let starting = false;
let wantCamera = true;
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
// allowOffline: a guard must be able to open the scanner with no signal.
const { user, profile } = await requireStaff(["guard", "admin"], { allowOffline: true });
$("who").textContent = profile.full_name;

const store = await openStore();
const queue = createQueue(store);
const MAX_AGE_HOURS = 72; // mirrors the offline_max_age_hours setting (server is the authority)

function setBanner(msg) {
  banner.textContent = msg;
  banner.hidden = !msg;
}

// ---- gate list: cached so the scanner can start offline
const GATES_KEY = "skpass.gates.v1";
function saveGates(list) {
  try {
    localStorage.setItem(GATES_KEY, JSON.stringify({ at: Date.now(), list }));
  } catch { /* ignore */ }
}
function cachedGates() {
  try {
    return JSON.parse(localStorage.getItem(GATES_KEY) ?? "null")?.list ?? null;
  } catch {
    return null;
  }
}

async function loadGates() {
  gateSel.replaceChildren(new Option("Choose a gate…", ""));
  let list = null;
  let usedCache = false;
  const { data, error } = await sb.from("gates").select("id, code, name, location, direction_mode")
    .eq("active", true).order("name");
  if (!error) {
    list = data;
    saveGates(list);
  } else {
    list = cachedGates();
    usedCache = !!list;
    if (!list) return setBanner("Could not load gates. Check your connection.");
  }
  for (const g of list) {
    const lane = g.direction_mode === "in"
      ? "entrance only"
      : g.direction_mode === "out"
      ? "exit only"
      : null;
    const extra = [g.location, lane].filter(Boolean).join(" \u00b7 ");
    const label = extra ? `${g.name} (${extra})` : g.name;
    const option = new Option(label, g.id);
    option.dataset.name = g.name;
    option.dataset.detail = extra;
    gateSel.append(option);
  }
  let saved = "";
  try {
    saved = localStorage.getItem("skpass.gate") ?? "";
  } catch { /* ignore */ }
  if (list.some((g) => g.id === saved)) gateSel.value = saved;
  else if (list.length === 1) gateSel.value = list[0].id; // one assigned gate: nothing to choose
  if (list.length === 0) {
    setBanner("No gate is assigned to your account. Ask an administrator to assign one.");
  } else if (usedCache) setBanner("Offline: using the gate list saved on this device.");
  updateStart();
}
function updateStart() {
  startBtn.disabled = starting || !gateSel.value;
  $("camera-status").textContent = started
    ? "Camera active"
    : gateSel.value
    ? "Ready to scan"
    : "Select a gate";
}
gateSel.addEventListener("change", () => {
  try {
    localStorage.setItem("skpass.gate", gateSel.value);
  } catch { /* ignore */ }
  updateStart();
  if (gateSel.value) {
    wantCamera = true;
    startCamera();
  } else {
    stopCamera();
    wakeLock?.release?.().catch(() => {});
  }
});
await loadGates();
enhanceGateSelect(gateSel);

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
  if (msg) $("camera-status").textContent = "Camera unavailable";
}

async function startCamera() {
  if (started || starting || !gateSel.value || document.hidden) return;
  starting = true;
  startBtn.disabled = true;
  startBtn.setAttribute("aria-busy", "true");
  try {
    showCamError("");
    $("camera-status").textContent = "Starting camera…";
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
    if (!wantCamera || document.hidden || !gateSel.value) {
      stopCamera();
      return;
    }
    video.srcObject = stream;
    try {
      await video.play();
    } catch {
      stopCamera();
      return showCamError("Tap Start scanning to enable the camera on this device.");
    }
    if (!stream || !wantCamera || document.hidden || !gateSel.value) {
      stopCamera();
      return;
    }
    const track = stream.getVideoTracks()[0];
    torchBtn.hidden = !track.getCapabilities?.().torch;
    started = true;
    $("startbox").hidden = true;
    document.body.classList.add("scanning");
    $("camera-status").textContent = "Camera active";
    $("stop").hidden = false;
    try {
      wakeLock = await navigator.wakeLock?.request("screen");
    } catch { /* optional */ }
    loop();
  } finally {
    starting = false;
    startBtn.disabled = !gateSel.value;
    startBtn.removeAttribute("aria-busy");
  }
}

function stopCamera() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  video.srcObject = null;
  started = false;
  document.body.classList.remove("scanning");
  $("startbox").hidden = false;
  $("stop").hidden = true;
  torchBtn.hidden = true;
  torchOn = false;
  torchBtn.textContent = "Torch: Off";
  updateStart();
}

$("stop").addEventListener("click", () => {
  // Ignore a tap that lands right after a result screen closes (a finger still on its way down).
  if (Date.now() - lastDismissAt < 800) return;
  wantCamera = false;
  stopCamera();
  wakeLock?.release?.().catch(() => {});
});

torchBtn.addEventListener("click", async () => {
  const track = stream?.getVideoTracks()[0];
  if (!track) return;
  torchOn = !torchOn;
  try {
    await track.applyConstraints({ advanced: [{ torch: torchOn }] });
    torchBtn.textContent = torchOn ? "Torch: On" : "Torch: Off";
  } catch {
    torchOn = false;
  }
});

// Release the camera when the page is hidden (battery, privacy) and resume when it returns.
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "hidden") {
    stopCamera();
    wakeLock?.release?.().catch(() => {});
  } else {
    if (wantCamera && !started) await startCamera();
    syncNow("visible");
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
  const r = await scan(text);
  showResult(r, r.result !== "queued");
}

/** One call to the server with a timeout, so a dead connection fails fast instead of hanging. */
async function callScan(params, ms = 8000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await sb.rpc("scan_vehicle", params).abortSignal(ac.signal);
  } catch (e) {
    return { data: null, error: { message: String(e?.message ?? e), code: "" } };
  } finally {
    clearTimeout(t);
  }
}

async function scan(token) {
  const key = crypto.randomUUID(); // reused on every retry AND on offline replay: never recorded twice
  const at = new Date().toISOString();
  const params = { p_token: token, p_gate_id: gateSel.value, p_idempotency_key: key };

  if (navigator.onLine) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const { data, error } = await callScan(params);
      if (!error) {
        if (!document.hidden) setTimeout(() => syncNow("scan"), 400); // also flush any backlog
        return data;
      }
      if (isAuthError(error)) {
        const { error: refreshErr } = await sb.auth.refreshSession();
        if (refreshErr) {
          if (isNetworkError(refreshErr)) break; // no signal after all: save it offline
          return describeFailure("session");
        }
        continue;
      }
      if (isForbidden(error)) return describeFailure("forbidden");
      if (!isNetworkError(error)) return describeFailure("server");
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // No connection (or it failed twice): keep the scan on the phone and send it later.
  const gateName = gateSel.selectedOptions[0]?.textContent ?? null;
  await queue.add({
    key,
    token,
    gate_id: gateSel.value,
    gate_name: gateName,
    user_id: user.id,
    scanned_at: at,
  });
  refreshBar();
  return queuedResult(gateName);
}

// ------------------------------------------------------------------ offline sync
let syncing = false;
let stopped = null; // why the last run stopped early: network | auth | forbidden
let syncedJustNow = 0;
let syncedTimer = null;
const reports = [];

/** Send one queued scan. Idempotent: the same key always returns the same answer. */
async function send(item) {
  const params = {
    p_token: item.token,
    p_gate_id: item.gate_id,
    p_idempotency_key: item.key,
    p_scanned_at: item.scanned_at,
    p_offline: true,
  };
  let { data, error } = await callScan(params, 10000);
  if (error && isAuthError(error)) {
    const { error: refreshErr } = await sb.auth.refreshSession();
    if (refreshErr) return { kind: isNetworkError(refreshErr) ? "network" : "auth" };
    ({ data, error } = await callScan(params, 10000));
  }
  if (!error) return { kind: "result", data };
  if (isAuthError(error)) return { kind: "auth" };
  if (isForbidden(error)) return { kind: "forbidden" };
  if (isNetworkError(error)) return { kind: "network" };
  return { kind: "error", message: error.message };
}

async function doSync() {
  const before = await queue.counts(user.id);
  if (!before.pending) return refreshBar();
  syncing = true;
  stopped = null;
  let done = 0;
  refreshBar({ pending: before.pending });
  const summary = await syncQueue(queue, user.id, send, {
    onItem: () => {
      done += 1;
      refreshBar({ pending: Math.max(0, before.pending - done) });
    },
  });
  syncing = false;
  stopped = summary.stopped;
  if (summary.sent > 0) {
    syncedJustNow = summary.sent;
    clearTimeout(syncedTimer);
    syncedTimer = setTimeout(() => {
      syncedJustNow = 0;
      refreshBar();
    }, 8000);
  }
  if (needsAttention(summary)) {
    reports.push(summary);
    maybeShowReport();
  }
  await refreshBar();
  await refreshHistory();
}

/** Run a sync once at a time, even with several tabs open (Web Locks where available). */
function syncNow(_reason) {
  if (syncing || !navigator.onLine) return Promise.resolve();
  if (navigator.locks?.request) {
    return navigator.locks.request("skpass-sync", { ifAvailable: true }, async (lock) => {
      if (lock) await doSync();
    });
  }
  return doSync();
}

// ---- sync bar + review list
const bar = $("syncbar");
async function refreshBar(override = {}) {
  const c = await queue.counts(user.id);
  const s = syncBarState({
    online: navigator.onLine,
    pending: override.pending ?? c.pending,
    failed: c.failed,
    others: c.others,
    syncing,
    syncedJustNow,
    nearExpiry: isNearExpiry(c.oldest, MAX_AGE_HOURS),
    stopped,
    degraded: !!store.degraded,
  });
  bar.hidden = !s.visible;
  bar.dataset.tone = s.tone;
  $("sync-text").textContent = s.text;
  $("sync-now").hidden = !s.canSync;
  $("sync-retry").hidden = !s.canRetry;
}

const fmtTime = (iso) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

async function refreshHistory() {
  const h = (await queue.history()).slice(0, 15);
  const list = $("synclist");
  list.replaceChildren();
  $("synchist").hidden = h.length === 0;
  for (const e of h) {
    const li = document.createElement("li");
    li.dataset.result = e.result;
    li.textContent = `${fmtTime(e.scanned_at)} · ${e.plate ?? "unknown QR"}${
      e.gate ? ` · ${e.gate}` : ""
    } · ${
      e.result === "ok"
        ? (e.direction === "IN"
          ? "Entry Recorded"
          : e.direction === "OUT"
          ? "Exit Recorded"
          : "Recorded")
        : (e.message ?? e.result)
    }`;
    list.append(li);
  }
}

$("sync-now").addEventListener("click", () => syncNow("button"));
$("sync-retry").addEventListener("click", async () => {
  await queue.retryFailed(user.id);
  await refreshBar();
  syncNow("retry");
});

addEventListener("online", () => {
  setBanner("");
  refreshBar();
  syncNow("online");
});
addEventListener("offline", () => {
  setBanner("You are offline. Scans are saved on this device and sent when you reconnect.");
  refreshBar();
});
if (!navigator.onLine) {
  setBanner("You are offline. Scans are saved on this device and sent when you reconnect.");
}
setInterval(() => {
  if (!document.hidden) syncNow("timer");
}, 20000);

// ---- sign out: do not silently strand saved scans
$("signout").addEventListener("click", async () => {
  const c = await queue.counts(user.id);
  if (
    c.pending + c.failed > 0 &&
    !confirm(
      `${
        c.pending + c.failed
      } saved scan(s) have not been sent yet. They stay on this device and ` +
        "are sent after you sign in again. Sign out anyway?",
    )
  ) return;
  signOut();
});

// ------------------------------------------------------------------ result screen
let resultVersion = 0;
function showResult(r, fromServer = false) {
  const version = ++resultVersion;
  const d = describeResult(r);
  overlay.className = `overlay ${d.tone}`;
  overlay.dataset.direction = r.direction ?? "";
  $("ov-dir").textContent = d.title;
  $("ov-msg").textContent = r.message ?? "";
  $("ov-gate").textContent = r.gate?.name ?? "";
  const v = r.vehicle;
  const details = resultVehicleDetails(v);
  $("ov-identity").hidden = !v;
  $("ov-media").hidden = !v;
  $("ov-gate-row").hidden = !r.gate?.name;
  $("ov-type").textContent = details.type;
  $("ov-color").textContent = details.color;
  $("ov-plate").textContent = v?.plate ?? "";
  $("ov-owner").textContent = v?.owner_name ?? "";
  const cat = $("ov-cat");
  cat.textContent = details.category;
  cat.className = `badge cat-${v?.category ?? "none"}`;
  cat.hidden = !v;
  const meta = [];
  if (v?.category === "visitor" && v.host_name) meta.push(`Visiting ${v.host_name}`);
  if (v?.valid_to) meta.push(`Valid until ${v.valid_to}`);
  $("ov-meta").textContent = meta.join(" · ");
  $("ov-meta").hidden = !meta.length;
  const list = $("ov-list");
  list.replaceChildren();
  for (const line of r.list ?? []) {
    const li = document.createElement("li");
    li.textContent = line;
    list.append(li);
  }
  list.hidden = !(r.list?.length);
  const photo = $("ov-photo");
  photo.hidden = true;
  photo.removeAttribute("src");
  photo.alt = v?.plate ? `Registered vehicle ${v.plate}` : "Registered vehicle";
  $("ov-photo-empty").hidden = false;
  $("ov-photo-status").textContent = fromServer && v?.photo_path
    ? "Loading vehicle photo…"
    : "No vehicle photo provided";
  photo.onload = () => {
    if (version !== resultVersion || overlay.hidden) return;
    photo.hidden = false;
    $("ov-photo-empty").hidden = true;
  };
  photo.onerror = () => {
    if (version !== resultVersion) return;
    photo.hidden = true;
    $("ov-photo-empty").hidden = false;
    $("ov-photo-status").textContent = "Vehicle photo unavailable";
  };
  overlay.hidden = false;
  $("ov-continue").focus({ preventScroll: true });

  play(SOUNDS[d.sound]);
  navigator.vibrate?.(VIBRATION[d.sound]);

  if (fromServer && v?.photo_path) {
    sb.storage.from("vehicle-photos").createSignedUrl(v.photo_path, 60).then(({ data }) => {
      if (version !== resultVersion || overlay.hidden) return;
      if (data?.signedUrl) {
        photo.src = data.signedUrl;
      } else {
        $("ov-photo-status").textContent = "Vehicle photo unavailable";
      }
    }).catch(() => {
      if (version === resultVersion) $("ov-photo-status").textContent = "Vehicle photo unavailable";
    });
  }
  clearTimeout(overlayTimer);
  if (d.hold > 0) overlayTimer = setTimeout(dismiss, d.hold); // reports stay until tapped
}

/** After offline scans were replayed: anything denied or flagged must be seen by a person. */
function maybeShowReport() {
  if (!reports.length || !overlay.hidden) return; // show after the current screen is dismissed
  const merged = reports.splice(0).reduce((a, s) => ({
    sent: a.sent + s.sent,
    denied: a.denied.concat(s.denied),
    warnings: a.warnings.concat(s.warnings),
    parked: a.parked + s.parked,
  }), { sent: 0, denied: [], warnings: [], parked: 0 });
  const line = (e, label) =>
    `${fmtTime(e.scanned_at)} · ${e.plate ?? "unknown QR"}${
      e.gate ? ` · ${e.gate}` : ""
    } · ${label}: ${e.message ?? e.code ?? ""}`;
  const list = [
    ...merged.denied.map((e) => line(e, "NOT ALLOWED")),
    ...merged.warnings.map((e) => line(e, "Warning")),
  ];
  if (merged.parked) {
    list.push(`${merged.parked} scan(s) could not be sent. Tap "Retry" under the camera.`);
  }
  busy = true;
  showResult({
    result: "report",
    code: merged.denied.length ? "sync_denied" : "sync_warn",
    message: `${merged.sent} saved scan(s) were sent. ${list.length} need your attention:`,
    list,
    vehicle: null,
    gate: null,
  });
}

let lastDismissAt = 0;
function dismiss() {
  clearTimeout(overlayTimer);
  overlay.hidden = true;
  resultVersion++;
  busy = false;
  maybeShowReport();
  lastDismissAt = Date.now();
  if (overlay.hidden) {
    // While scanning, never park focus on "Stop Camera": a stray Enter/Space (or a scanner
    // wedge) would switch the camera off. Drop focus on the camera view instead, which does
    // nothing when activated.
    if (started) {
      const view = $("video").closest(".viewport") ?? $("video");
      view.tabIndex = -1;
      view.focus({ preventScroll: true });
    } else startBtn.focus({ preventScroll: true });
  }
}
overlay.addEventListener("click", (event) => {
  if (event.target === overlay || event.target.closest("#ov-continue")) dismiss();
});
overlay.addEventListener("keydown", (event) => {
  if (event.key === "Escape") dismiss();
  if (event.key === "Tab") {
    event.preventDefault();
    $("ov-continue").focus();
  }
});

startBtn.addEventListener("click", async () => {
  if (startBtn.disabled) return;
  unlockFeedbackAudio();
  wantCamera = true;
  await startCamera();
});

function unlockFeedbackAudio() {
  try {
    audioCtx ??= new (globalThis.AudioContext ?? globalThis.webkitAudioContext)();
    audioCtx.resume?.().catch(() => {});
  } catch { /* Camera scanning does not depend on audio support. */ }
}
document.addEventListener("pointerdown", unlockFeedbackAudio, { once: true });
document.addEventListener("keydown", unlockFeedbackAudio, { once: true });

// First paint of the offline status, then flush anything left from an earlier session.
await refreshBar();
await refreshHistory();
syncNow("start");
if (gateSel.value && !document.hidden) startCamera();
