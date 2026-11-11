// QR drawing/downloading shared by My QR and the admin dashboard.
// Requires vendor/qrcode.js (global `qrcode`) to be loaded first.

export function drawQr(canvas, token, label) {
  const qr = globalThis.qrcode(0, "M");
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
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) g.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
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
  c.toBlob((blob) => {
    const a = document.createElement("a");
    Object.assign(a, { href: URL.createObjectURL(blob), download: `skpass-${plate}.png` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, "image/png");
}
