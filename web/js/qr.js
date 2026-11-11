// QR drawing/downloading shared by My QR and the admin dashboard.
// Requires vendor/qrcode.js (global `qrcode`) to be loaded first.

export function drawQr(canvas, token, label) {
  const qr = globalThis.qrcode(0, "H");
  qr.addData(token);
  qr.make();
  const n = qr.getModuleCount();
  const cell = 10;
  const quiet = 4;
  const size = (n + quiet * 2) * cell;
  const footer = label ? 64 : 0;
  canvas.width = size;
  canvas.height = size + footer;
  const g = canvas.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = "#000";
  const eyes = [[0, 0], [n - 7, 0], [0, n - 7]];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (eyes.some(([x, y]) => c >= x && c < x + 7 && r >= y && r < y + 7)) continue;
      if (qr.isDark(r, c)) {
        g.beginPath();
        g.roundRect(
          (c + quiet) * cell + .4,
          (r + quiet) * cell + .4,
          cell - .8,
          cell - .8,
          cell * .32,
        );
        g.fill();
      }
    }
  }
  // Rounded finder rings retain the standard 7:5:3 module proportions.
  for (const [c, r] of eyes) {
    const x = (c + quiet) * cell, y = (r + quiet) * cell;
    for (
      const [inset, width, radius, color] of [[0, 7, 1.3, "#000"], [1, 5, .8, "#fff"], [
        2,
        3,
        .6,
        "#000",
      ]]
    ) {
      g.fillStyle = color;
      g.beginPath();
      g.roundRect(x + inset * cell, y + inset * cell, width * cell, width * cell, radius * cell);
      g.fill();
    }
  }
  if (label) {
    g.fillStyle = "#1c2024";
    g.font = "bold 34px system-ui, sans-serif";
    g.textAlign = "center";
    g.fillText(label, size / 2, size + 40);
  }
}

export function downloadQr(token, plate) {
  const c = document.createElement("canvas");
  drawQr(c, token, plate);
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    try {
      const g = c.getContext("2d");
      const qrSize = c.width;
      const logoSize = Math.round(qrSize * 0.18);
      const x = Math.round((qrSize - logoSize) / 2);
      const y = Math.round((qrSize - logoSize) / 2);
      const pad = Math.max(1, Math.round(logoSize * 0.025));
      // A narrow circular quiet backing around the original full-color logo.
      g.fillStyle = "#ffffff";
      g.beginPath();
      g.arc(qrSize / 2, qrSize / 2, logoSize / 2 + pad, 0, Math.PI * 2);
      g.fill();

      // Draw the official logo
      g.drawImage(img, x, y, logoSize, logoSize);
    } catch {
      // ignore compositing error and proceed
    }
    saveBlob();
  };
  img.onerror = () => saveBlob();
  img.src = new URL("../icons/logo.png", import.meta.url).href;

  function saveBlob() {
    c.toBlob((blob) => {
      const a = document.createElement("a");
      Object.assign(a, { href: URL.createObjectURL(blob), download: `skpass-${plate}.png` });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, "image/png");
  }
}

// ------------------------------------------------------------------ pass image (JPG)
const MONO = '"JetBrains Mono", ui-monospace, Consolas, monospace';
const SANS = '"Plus Jakarta Sans", system-ui, "Segoe UI", sans-serif';

function loadLogo() {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = new URL("../icons/logo.png", import.meta.url).href;
  });
}

function pill(g, text, right, y, { color, bg, border, font }) {
  g.font = font;
  const w = g.measureText(text).width + 24;
  const x = right - w;
  g.fillStyle = bg;
  g.strokeStyle = border;
  g.lineWidth = 1;
  g.beginPath();
  g.roundRect(x, y, w, 26, 13);
  g.fill();
  g.stroke();
  g.fillStyle = color;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, x + w / 2, y + 14);
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
}

/**
 * Renders the whole pass (QR, plate, holder, vehicle, status, reference) to a canvas.
 * pass: { token, plate, category, holder, vehicleType, color, status, reference, validity }
 */
export async function drawPassImage(pass) {
  const S = 2; // render at 2x so it stays sharp on phones
  const W = 700;
  const extra = pass.validity ? 54 : 0;
  const H = 336 + extra;
  const c = document.createElement("canvas");
  c.width = W * S;
  c.height = H * S;
  const g = c.getContext("2d");
  g.scale(S, S);
  g.fillStyle = "#12181c"; // opaque: JPEG has no transparency
  g.fillRect(0, 0, W, H);
  g.fillStyle = "#a3e63533"; // top accent line
  g.fillRect(0, 0, W, 2);

  // ---- left panel: QR
  g.fillStyle = "#1a2227";
  g.strokeStyle = "#ffffff1a";
  g.beginPath();
  g.roundRect(16, 16, 220, H - 32, 16);
  g.fill();
  g.stroke();
  g.fillStyle = "#8fa1ac";
  g.font = `700 10px ${MONO}`;
  g.textAlign = "center";
  g.fillText("VEHICLE GATE PASS", 126, 42);
  const qrCanvas = document.createElement("canvas");
  drawQr(qrCanvas, pass.token, null);
  const logo = await loadLogo();
  if (logo) {
    const q = qrCanvas.getContext("2d");
    const size = Math.round(qrCanvas.width * 0.18);
    const pos = Math.round((qrCanvas.width - size) / 2);
    q.fillStyle = "#fff";
    q.beginPath();
    q.arc(qrCanvas.width / 2, qrCanvas.height / 2, size / 2 + 4, 0, Math.PI * 2);
    q.fill();
    q.drawImage(logo, pos, pos, size, size);
  }
  const boxH = 196;
  const boxY = 54 + Math.max(0, (H - 32 - 54 - 56 - boxH) / 2);
  g.fillStyle = "#fff";
  g.beginPath();
  g.roundRect(32, boxY, 188, boxH, 14);
  g.fill();
  g.drawImage(qrCanvas, 40, boxY + 8, 172, 172 + 16 - 16);
  g.fillStyle = "#8fa1ac";
  g.font = `500 10px ${SANS}`;
  g.fillText("Show this QR to the guard at the gate.", 126, H - 30);
  g.textAlign = "left";

  // ---- right: identity
  const x0 = 264;
  g.fillStyle = "#222c32";
  g.strokeStyle = "#a3e63540";
  g.beginPath();
  g.roundRect(x0, 28, 52, 52, 14);
  g.fill();
  g.stroke();
  if (logo) g.drawImage(logo, x0 + 9, 37, 34, 34);
  g.fillStyle = "#fff";
  g.font = `800 34px ${MONO}`;
  g.fillText(pass.plate, x0 + 68, 58);
  g.fillStyle = "#8fa1ac";
  g.font = `700 10px ${MONO}`;
  g.fillText("TERMINAL PASS ID", x0 + 68, 76);
  const summary = [pass.vehicleType, pass.color].filter(Boolean).join(" · ");
  g.font = `500 12px ${SANS}`;
  g.fillText(summary, x0 + 68, 96);
  pill(g, pass.category.toUpperCase(), W - 24, 30, {
    color: "#a3e635",
    bg: "#a3e6351a",
    border: "#a3e63566",
    font: `700 11px ${MONO}`,
  });

  // ---- holder + status
  g.fillStyle = "#8fa1ac";
  g.font = `700 10px ${MONO}`;
  g.fillText("AUTHORIZED HOLDER", x0, 138);
  g.fillStyle = "#fff";
  g.font = `800 19px ${SANS}`;
  g.fillText((pass.holder || "").toUpperCase(), x0, 166);
  pill(g, `● ${pass.status}`, W - 24, 144, {
    color: "#4ade80",
    bg: "#22c55e1f",
    border: "#22c55e77",
    font: `700 12px ${SANS}`,
  });

  // ---- vehicle type / color
  g.fillStyle = "#8fa1ac";
  g.font = `700 10px ${MONO}`;
  g.fillText("VEHICLE TYPE", x0, 204);
  g.fillText("COLOR", x0 + 210, 204);
  g.fillStyle = "#fff";
  g.font = `700 14px ${SANS}`;
  g.fillText(pass.vehicleType || "Not available", x0, 226);
  g.fillText(pass.color || "Not available", x0 + 210, 226);

  let y = 258;
  if (pass.validity) {
    g.fillStyle = "#8fa1ac";
    g.font = `700 10px ${MONO}`;
    g.fillText("VALID", x0, y);
    g.fillStyle = "#fff";
    g.font = `700 14px ${SANS}`;
    g.fillText(pass.validity, x0, y + 22);
    y += extra;
  }

  // ---- reference
  g.fillStyle = "#8fa1ac";
  g.font = `700 10px ${MONO}`;
  g.fillText("PASS REFERENCE", x0, y);
  g.fillStyle = "#1a2227";
  g.strokeStyle = "#ffffff1a";
  g.beginPath();
  g.roundRect(x0, y + 10, W - 24 - x0, 38, 10);
  g.fill();
  g.stroke();
  g.fillStyle = "#e8eef2";
  g.font = `700 13px ${MONO}`;
  g.fillText(pass.reference, x0 + 14, y + 34);
  return c;
}

/** Downloads the pass picture as a JPG (white-free dark card, 2x resolution). */
export async function downloadPassJpg(pass) {
  const canvas = await drawPassImage(pass);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (!blob) throw new Error("The browser could not create the pass image.");
  const safe = String(pass.plate).replace(/[^A-Za-z0-9-]+/g, "") || "pass";
  const a = document.createElement("a");
  Object.assign(a, { href: URL.createObjectURL(blob), download: `skpass-${safe}.jpg` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
