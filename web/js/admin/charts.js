// Minimal inline-SVG charts (no library). Colors follow the brand: IN emerald, OUT slate.
const NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}, text) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
};

export const COLORS = { in: "#a3e635", out: "#748995" };

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
    svg.append(svgEl("line", { x1: padL, x2: W - padR, y1: y, y2: y, stroke: "#ffffff0d" }));
    svg.append(
      svgEl("text", {
        x: padL - 6,
        y: y + 4,
        "text-anchor": "end",
        "font-size": 11,
        fill: "#94a3b8",
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
          fill: "#94a3b8",
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
        fill: "#f1f5f9",
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
        { x: padL + wIn + wOut + 8, y: y + 18, "font-size": 13, fill: "#94a3b8" },
        `${r.in} in · ${r.out} out`,
      ),
    );
  });
  return svg;
}

/**
 * 24 stacked bars for today, one per hour. buckets: [{ in, out }] x 24.
 * `nowHour` (optional) marks the current hour; `peak` (optional) highlights the busiest hour.
 */
export function hourChart(buckets, { nowHour = null, peak = null } = {}) {
  const W = 560, H = 200, padL = 28, padB = 26, padT = 10, padR = 6;
  const svg = svgEl("svg", {
    viewBox: `0 0 ${W} ${H}`,
    role: "img",
    "aria-label": "Movements by hour today",
    class: "chart",
  });
  const max = Math.max(1, ...buckets.map((b) => b.in + b.out));
  const top = Math.max(4, Math.ceil(max / 4) * 4);
  const plotH = H - padT - padB;
  const slot = (W - padL - padR) / 24;
  const bw = slot * 0.66;

  for (let i = 0; i <= 4; i++) {
    const v = Math.round((top / 4) * i);
    const y = padT + plotH - (v / top) * plotH;
    svg.append(svgEl("line", { x1: padL, x2: W - padR, y1: y, y2: y, stroke: "#ffffff10" }));
    svg.append(
      svgEl("text", {
        x: padL - 6,
        y: y + 4,
        "text-anchor": "end",
        "font-size": 10,
        fill: "#7f93a0",
      }, v),
    );
  }
  buckets.forEach((b, h) => {
    const x = padL + slot * h + (slot - bw) / 2;
    const hIn = (b.in / top) * plotH;
    const hOut = (b.out / top) * plotH;
    const g = svgEl("g");
    g.append(svgEl("title", {}, `${String(h).padStart(2, "0")}:00 — ${b.in} in, ${b.out} out`));
    if (nowHour === h) {
      g.append(
        svgEl("rect", {
          x: x - 2,
          y: padT,
          width: bw + 4,
          height: plotH,
          fill: "#ffffff08",
          rx: 3,
        }),
      );
    }
    g.append(
      svgEl("rect", {
        x,
        y: padT + plotH - hIn,
        width: bw,
        height: hIn,
        fill: COLORS.in,
        rx: 1.5,
        opacity: peak && peak.hour !== h ? 0.78 : 1,
      }),
    );
    g.append(
      svgEl("rect", {
        x,
        y: padT + plotH - hIn - hOut,
        width: bw,
        height: hOut,
        fill: COLORS.out,
        rx: 1.5,
        opacity: peak && peak.hour !== h ? 0.78 : 1,
      }),
    );
    svg.append(g);
    if (h % 3 === 0) {
      svg.append(
        svgEl("text", {
          x: x + bw / 2,
          y: H - padB + 15,
          "text-anchor": "middle",
          "font-size": 10,
          fill: "#7f93a0",
        }, String(h).padStart(2, "0")),
      );
    }
  });
  if (peak) {
    const x = padL + slot * peak.hour + slot / 2;
    svg.append(
      svgEl("text", {
        x: Math.min(W - 40, Math.max(padL + 30, x)),
        y: padT + 2,
        "text-anchor": "middle",
        "font-size": 10,
        "font-weight": 600,
        fill: "#a3e635",
      }, `peak ${peak.count}`),
    );
  }
  return svg;
}
