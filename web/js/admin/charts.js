// Minimal inline-SVG charts (no library). Colors follow the brand: IN green, OUT charcoal.
const NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}, text) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
};

export const COLORS = { in: "#2d9a0f", out: "#2b2f33" };

/** Stacked daily bars. rows: [{ day:'2026-11-11', in:3, out:2 }] */
export function dailyChart(rows) {
  const W = 560, H = 240, padL = 34, padB = 34, padT = 12, padR = 8;
  const svg = svgEl("svg", {
    viewBox: `0 0 ${W} ${H}`,
    role: "img",
    "aria-label": "Daily entries and exits",
    class: "chart",
  });
  const max = Math.max(1, ...rows.map((r) => r.in + r.out));
  const niceMax = Math.max(4, Math.ceil(max / 4) * 4); // quarter steps stay whole numbers
  const plotH = H - padT - padB;
  const slot = (W - padL - padR) / Math.max(1, rows.length);
  const bw = Math.min(34, slot * 0.7);

  for (let i = 0; i <= 4; i++) {
    const v = Math.round((niceMax / 4) * i);
    const y = padT + plotH - (v / niceMax) * plotH;
    svg.append(svgEl("line", { x1: padL, x2: W - padR, y1: y, y2: y, stroke: "#e3e8e1" }));
    svg.append(
      svgEl("text", {
        x: padL - 6,
        y: y + 4,
        "text-anchor": "end",
        "font-size": 11,
        fill: "#667078",
      }, v),
    );
  }
  rows.forEach((r, i) => {
    const x = padL + slot * i + (slot - bw) / 2;
    const hOut = (r.out / niceMax) * plotH;
    const hIn = (r.in / niceMax) * plotH;
    const g = svgEl("g");
    g.append(svgEl("title", {}, `${r.day}: ${r.in} in, ${r.out} out`));
    g.append(
      svgEl("rect", { x, y: padT + plotH - hIn, width: bw, height: hIn, fill: COLORS.in, rx: 2 }),
    );
    g.append(
      svgEl("rect", {
        x,
        y: padT + plotH - hIn - hOut,
        width: bw,
        height: hOut,
        fill: COLORS.out,
        rx: 2,
      }),
    );
    svg.append(g);
    if (rows.length <= 10 || i % Math.ceil(rows.length / 7) === 0 || i === rows.length - 1) {
      svg.append(
        svgEl("text", {
          x: x + bw / 2,
          y: H - padB + 16,
          "text-anchor": "middle",
          "font-size": 11,
          fill: "#667078",
        }, r.day.slice(5)),
      );
    }
  });
  return svg;
}

/** Horizontal bars per gate for today. rows: [{ gate, in, out }] */
export function gateBars(rows) {
  const rowH = 34, W = 400, padL = 92;
  const H = Math.max(rowH, rows.length * rowH) + 8;
  const svg = svgEl("svg", {
    viewBox: `0 0 ${W} ${H}`,
    role: "img",
    "aria-label": "Today by gate",
    class: "chart",
  });
  const max = Math.max(1, ...rows.map((r) => r.in + r.out));
  const plotW = W - padL - 96;
  rows.forEach((r, i) => {
    const y = 4 + i * rowH;
    svg.append(
      svgEl("text", {
        x: padL - 8,
        y: y + 17,
        "text-anchor": "end",
        "font-size": 14,
        fill: "#1c2024",
      }, r.gate),
    );
    const wIn = (r.in / max) * plotW;
    const wOut = (r.out / max) * plotW;
    svg.append(
      svgEl("rect", { x: padL, y: y + 4, width: wIn, height: 18, fill: COLORS.in, rx: 2 }),
    );
    svg.append(
      svgEl("rect", { x: padL + wIn, y: y + 4, width: wOut, height: 18, fill: COLORS.out, rx: 2 }),
    );
    svg.append(
      svgEl(
        "text",
        { x: padL + wIn + wOut + 8, y: y + 18, "font-size": 13, fill: "#667078" },
        `${r.in} in · ${r.out} out`,
      ),
    );
  });
  return svg;
}
