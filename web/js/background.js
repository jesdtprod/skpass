// Decorative mesh with a smooth convex field beneath the mouse.
const canvas = document.querySelector("canvas.portal-pattern");
const context = canvas?.getContext("2d");

if (context) {
  initPortalPattern(canvas, context);
}

function initPortalPattern(canvas, context) {
  let width = 0;
  let height = 0;
  let frame = 0, x = 0, y = 0, tx = 0, ty = 0, strength = 0, target = 0;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const fine = matchMedia("(hover: hover) and (pointer: fine)");

  function project(gx, gy) {
    const dx = gx - x, dy = gy - y, distance = Math.hypot(dx, dy);
    if (distance >= 240) return { x: gx, y: gy, lift: 0 };
    const t = distance / 240;
    const lift = (1 - t * t) ** 2 * strength;
    const push = Math.sin(t * Math.PI) * (1 - t * .45) * 24 * strength;
    return { x: gx + dx / (distance || 1) * push, y: gy + dy / (distance || 1) * push, lift };
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(tick);
  }
  function tick() {
    frame = 0;
    x += (tx - x) * .18;
    y += (ty - y) * .18;
    strength += (target - strength) * .14;
    draw();
    if (Math.hypot(tx - x, ty - y) > .35 || Math.abs(target - strength) > .004) schedule();
  }

  function draw() {
    context.clearRect(0, 0, width, height);
    const cols = Math.ceil(width / 36) + 2;
    const rows = Math.ceil(height / 36) + 2;
    const points = Array.from(
      { length: rows },
      (_, r) => Array.from({ length: cols }, (_, c) => project(c * 36 - 17, r * 36 - 17)),
    );
    context.lineWidth = 1;
    context.strokeStyle = "rgba(134,186,158,.09)";
    context.beginPath();
    points.forEach((row, r) =>
      row.forEach((p, c) => {
        for (const next of [row[c + 1], points[r + 1]?.[c]]) {
          if (next) {
            context.moveTo(p.x, p.y);
            context.lineTo(next.x, next.y);
          }
        }
      })
    );
    context.stroke();
    points.flat().forEach((p) => {
      context.fillStyle = `rgba(134,186,158,${0.24 + p.lift * 0.34})`;
      context.beginPath();
      context.arc(p.x, p.y, 1.7 + p.lift * 1.1, 0, Math.PI * 2);
      context.fill();
    });
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const p = project(c * 36 + 1, r * 36 + 1);
        const arm = 2.5 + p.lift * 1.2;
        context.strokeStyle = `rgba(134,186,158,${0.18 + p.lift * 0.22})`;
        context.beginPath();
        context.moveTo(p.x - arm, p.y);
        context.lineTo(p.x + arm, p.y);
        context.moveTo(p.x, p.y - arm);
        context.lineTo(p.x, p.y + arm);
        context.stroke();
      }
    }
  }

  function resize() {
    width = innerWidth;
    height = innerHeight;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  globalThis.addEventListener("resize", resize);
  document.addEventListener("pointermove", (event) => {
    if (reduced.matches || !fine.matches || event.pointerType !== "mouse") return;
    tx = event.clientX;
    ty = event.clientY;
    if (!target && strength < .01) {
      x = tx;
      y = ty;
    }
    target = 1;
    schedule();
  });
  function leave() {
    target = 0;
    schedule();
  }
  document.addEventListener("pointerleave", leave);
  document.addEventListener("pointercancel", leave);
  globalThis.addEventListener("blur", leave);
  function reset() {
    cancelAnimationFrame(frame);
    frame = 0;
    strength = target = 0;
    draw();
  }
  reduced.addEventListener("change", reset);
  fine.addEventListener("change", reset);
  resize();
}
