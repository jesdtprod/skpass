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

// ------------------------------------------------------------------ pass image (PNG)
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

function pill(g, text, right, y, { color, bg, border, font, radius = 13 }) {
  g.font = font;
  const w = g.measureText(text).width + 24;
  const x = right - w;
  g.fillStyle = bg;
  g.strokeStyle = border;
  g.lineWidth = 1;
  g.beginPath();
  g.roundRect(x, y, w, 26, radius);
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
  await document.fonts?.ready;
  const S = 2; // render at 2x so it stays sharp on phones
  const W = 674;
  const H = 302;
  const headingHeight = 76;
  const totalHeight = H + headingHeight;
  const c = document.createElement("canvas");
  c.width = W * S;
  c.height = totalHeight * S;
  const g = c.getContext("2d");
  g.scale(S, S);
  // Leave the canvas transparent outside the rounded pass frame.
  g.save();
  g.beginPath();
  g.roundRect(0.5, 0.5, W - 1, totalHeight - 1, 22);
  g.fillStyle = "#1a2227";
  g.fill();
  g.strokeStyle = "#36424a";
  g.lineWidth = 1;
  g.stroke();
  g.clip();
  g.fillStyle = "#a3e635";
  g.fillRect(0, 0, W, 2);

  g.fillStyle = "#dce6ec";
  g.font = `700 16px ${SANS}`;
  g.fillText("Vehicle Pass Details", 22, 31);
  g.fillStyle = "#94a3b8";
  g.font = `500 12px ${SANS}`;
  g.fillText("Review your vehicle information, holder details, and gate access QR.", 22, 51);
  g.strokeStyle = "#ffffff12";
  g.beginPath();
  g.moveTo(22, 67);
  g.lineTo(W - 22, 67);
  g.stroke();
  g.translate(0, headingHeight);

  // ---- left panel: QR
  g.fillStyle = "#11181d";
  g.strokeStyle = "#36424a";
  g.beginPath();
  g.roundRect(12, 16, 220, H - 32, 16);
  g.fill();
  g.stroke();
  g.fillStyle = "#8fa1ac";
  g.font = `700 10px ${MONO}`;
  g.textAlign = "center";
  g.fillText("VEHICLE GATE PASS", 122, 39);
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
  const boxH = 194;
  const boxY = 54;
  g.fillStyle = "#fff";
  g.beginPath();
  g.roundRect(25, boxY, 194, boxH, 20);
  g.fill();
  g.save();
  g.clip();
  g.drawImage(qrCanvas, 25, boxY, 194, 194);
  g.restore();
  g.fillStyle = "#8fa1ac";
  g.font = `500 10px ${SANS}`;
  g.fillText("Show this QR to the guard at the gate.", 122, 271);
  g.textAlign = "left";

  // ---- right: identity
  const x0 = 252;
  g.fillStyle = "#142029";
  g.strokeStyle = "#14b8a644";
  g.beginPath();
  g.roundRect(x0, 30, 48, 48, 14);
  g.fill();
  g.stroke();
  // Vehicle outline, matching the pass header rather than repeating the logo.
  g.save();
  g.translate(x0 + 14, 44);
  g.scale(20 / 24, 20 / 24);
  g.strokeStyle = "#00d6a0";
  g.lineWidth = 1.8;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.stroke(
    new Path2D(
      "M5 10l2-5h10l2 5M3 17v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5H3M5 17v3m14-3v3M8 13h.01m8 0h.01",
    ),
  );
  g.restore();
  g.fillStyle = "#fff";
  g.font = `800 30px ${MONO}`;
  g.fillText(pass.plate, x0 + 62, 44, 230);
  g.fillStyle = "#8fa1ac";
  g.font = `700 10px ${MONO}`;
  g.fillText("TERMINAL PASS ID", x0 + 62, 63);
  const summary = [pass.vehicleType, pass.color].filter(Boolean).join(" · ");
  g.font = `500 12px ${SANS}`;
  g.fillText(summary, x0 + 62, 85, 250);
  pill(g, String(pass.category || "Vehicle").toUpperCase(), W - 20, 39, {
    color: "#b5cda0",
    bg: "#a3e63509",
    border: "#a3e63533",
    font: `700 11px ${MONO}`,
    radius: 6,
  });

  // ---- holder + status
  g.strokeStyle = "#ffffff12";
  g.beginPath();
  g.moveTo(x0, 102);
  g.lineTo(W - 20, 102);
  g.stroke();
  g.fillStyle = "#8fa1ac";
  g.font = `700 10px ${MONO}`;
  g.fillText("AUTHORIZED HOLDER", x0, 127);
  g.fillStyle = "#fff";
  g.font = `800 16px ${SANS}`;
  g.fillText((pass.holder || "").toUpperCase(), x0, 152, 300);
  pill(g, `● ${pass.status}`, W - 20, 116, {
    color: "#25dca8",
    bg: "#052a22",
    border: "#00b98c55",
    font: `700 10px ${SANS}`,
  });

  // ---- vehicle type / color
  g.fillStyle = "#8fa1ac";
  g.font = `700 10px ${MONO}`;
  g.fillText("VEHICLE TYPE", x0, 185);
  g.fillText("COLOR", x0 + 210, 185);
  g.fillStyle = "#fff";
  g.font = `700 14px ${SANS}`;
  g.fillText(pass.vehicleType || "Not available", x0, 210, 195);
  g.fillText(pass.color || "Not available", x0 + 210, 210, 190);

  const y = 239;

  // ---- reference
  g.fillStyle = "#8fa1ac";
  g.font = `700 10px ${MONO}`;
  g.fillText("PASS REFERENCE", x0, y);
  g.fillStyle = "#11181d";
  g.strokeStyle = "#36424a";
  g.beginPath();
  g.roundRect(x0, y + 10, W - 20 - x0, 38, 8);
  g.fill();
  g.stroke();
  g.fillStyle = "#e8eef2";
  g.font = `700 13px ${MONO}`;
  g.fillText(pass.reference, x0 + 14, y + 34, W - x0 - 70);
  g.restore();
  return c;
}

/** Downloads the rounded pass as a PNG with transparent corners, at 2x resolution. */
export async function downloadPassPng(pass) {
  const canvas = await drawPassImage(pass);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The browser could not create the pass image.");
  const safe = String(pass.plate).replace(/[^A-Za-z0-9-]+/g, "") || "pass";
  const a = document.createElement("a");
  Object.assign(a, { href: URL.createObjectURL(blob), download: `skpass-${safe}.png` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
