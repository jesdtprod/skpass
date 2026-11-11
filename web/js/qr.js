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
      const pad = Math.round(logoSize * 0.12);
      const r = Math.round(logoSize * 0.25);

      // Clean white backing keeps the center logo separate from data modules.
      g.fillStyle = "#ffffff";
      if (typeof g.roundRect === "function") {
        g.beginPath();
        g.roundRect(x - pad, y - pad, logoSize + pad * 2, logoSize + pad * 2, [r + 2]);
        g.fill();
      } else {
        g.fillRect(x - pad, y - pad, logoSize + pad * 2, logoSize + pad * 2);
      }

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
