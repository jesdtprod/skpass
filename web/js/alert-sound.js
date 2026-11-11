// Loud, repeated (3x) alert sounds generated with Web Audio (no audio files).
//
// Limits you should know about:
//  * Browsers only allow sound after the person has touched the page once. unlockAudio() runs on
//    the first tap/click/key automatically; until then playAlert() reports "blocked".
//  * The page cannot be louder than the device volume. We use the loudest safe signal (square
//    waves through a compressor at full gain) and also vibrate on phones.
//  * Sound plays only while a SKPass page is open. A closed app gets the operating system's own
//    notification sound, which web pages cannot change.

export const REPEATS = 3;

// One burst per repeat. Each note: [frequency Hz, length seconds].
const BURSTS = {
  new_registration: { notes: [[988, 0.18], [740, 0.18], [988, 0.18]], gap: 0.4 }, // ding-dong-ding
  approved: { notes: [[523, 0.14], [659, 0.14], [784, 0.14], [1047, 0.26]], gap: 0.4 }, // rising
  rejected: { notes: [[466, 0.28], [349, 0.28], [262, 0.34]], gap: 0.45 }, // falling, heavier
  test: { notes: [[880, 0.22]], gap: 0.4 },
};

export function soundKinds() {
  return Object.keys(BURSTS);
}

/**
 * Pure: the exact notes to play. Times are seconds from the start.
 * Returns { notes: [{ at, freq, dur }], total, vibrate }.
 */
export function buildSchedule(kind, repeats = REPEATS) {
  const b = BURSTS[kind] ?? BURSTS.test;
  const burstLen = b.notes.reduce((n, [, d]) => n + d, 0);
  const period = burstLen + b.gap;
  const notes = [];
  for (let r = 0; r < repeats; r++) {
    let t = r * period;
    for (const [freq, dur] of b.notes) {
      notes.push({ at: +t.toFixed(3), freq, dur });
      t += dur;
    }
  }
  // Phone vibration: one long buzz per repeat.
  const vibrate = [];
  for (let r = 0; r < repeats; r++) {
    vibrate.push(Math.round(burstLen * 1000), Math.round(b.gap * 1000));
  }
  vibrate.pop(); // no trailing pause
  return { notes, total: +((repeats - 1) * period + burstLen).toFixed(3), vibrate };
}

// ------------------------------------------------------------------ playback
const MUTE_KEY = "skpass.alert.muted";
let ctx = null;

export function isMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}
export function setMuted(m) {
  try {
    localStorage.setItem(MUTE_KEY, m ? "1" : "0");
  } catch { /* ignore */ }
}

/** Must run inside a user gesture the first time. Safe to call repeatedly. */
export async function unlockAudio() {
  const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!AC) return false;
  ctx ??= new AC();
  if (ctx.state !== "running") await ctx.resume().catch(() => {});
  return ctx.state === "running";
}
export const audioReady = () => !!ctx && ctx.state === "running";

/**
 * Plays kind 3 times. Resolves to the duration in ms, 0 if muted, or -1 if the browser still
 * blocks audio (the caller should show a "tap to enable sound" hint).
 */
export async function playAlert(kind, { force = false } = {}) {
  const s = buildSchedule(kind);
  navigator.vibrate?.(s.vibrate);
  if (isMuted() && !force) return 0;
  if (!audioReady()) await unlockAudio();
  if (!audioReady()) {
    globalThis.dispatchEvent?.(new CustomEvent("skpass:sound-blocked"));
    return -1;
  }
  const start = ctx.currentTime + 0.05;
  const comp = ctx.createDynamicsCompressor(); // keeps it loud without harsh clipping
  comp.threshold.value = -14;
  comp.knee.value = 8;
  comp.ratio.value = 6;
  comp.attack.value = 0.003;
  comp.release.value = 0.1;
  const master = ctx.createGain();
  master.gain.value = 1; // maximum; the device volume is the real limit
  comp.connect(master).connect(ctx.destination);
  for (const n of s.notes) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "square";
    o.frequency.value = n.freq;
    const t0 = start + n.at;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.9, t0 + 0.01); // quick attack, no click
    g.gain.setValueAtTime(0.9, t0 + Math.max(0.01, n.dur - 0.04));
    g.gain.linearRampToValueAtTime(0, t0 + n.dur); // short release
    o.connect(g).connect(comp);
    o.start(t0);
    o.stop(t0 + n.dur + 0.02);
  }
  return Math.round(s.total * 1000);
}

// First touch anywhere unlocks audio, so alerts are audible without a special button.
if (typeof document !== "undefined") {
  for (const ev of ["pointerdown", "keydown"]) {
    document.addEventListener(ev, () => unlockAudio(), { once: true, capture: true });
  }
}
