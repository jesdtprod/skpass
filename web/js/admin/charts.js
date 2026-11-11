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
  const W = 560, H = 160, padL = 34, padB = 30, padT = 12, padR = 8;
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
    svg.append(
      svgEl("line", {
        x1: padL,
        x2: W - padR,
        y1: y,
        y2: y,
        stroke: i === 0 ? "rgba(255, 255, 255, 0.12)" : "rgba(255, 255, 255, 0.05)",
        ...(i > 0 ? { "stroke-dasharray": "3 3" } : {}),
      }),
    );
    svg.append(
      svgEl("text", {
        x: padL - 8,
        y: y + 4,
        "text-anchor": "end",
        "font-size": 11,
        "font-family": "'Plus Jakarta Sans', sans-serif",
        "font-weight": "500",
        fill: "#64748b",
      }, v),
    );
  }
  rows.forEach((r, i) => {
    const x = padL + slot * i + (slot - bw) / 2;
    const hOut = (r.out / niceMax) * plotH;
    const hIn = (r.in / niceMax) * plotH;
    const g = svgEl("g");
    g.append(svgEl("title", {}, `${r.day}: ${r.in} in, ${r.out} out`));

    // Full column slot hover hit area
    g.append(
      svgEl("rect", {
        x: padL + slot * i,
        y: padT,
        width: slot,
        height: plotH,
        fill: "transparent",
        class: "chart-col-hit",
      }),
    );

    if (r.in === 0 && r.out === 0) {
      // Subtle baseline slot marker for 0-movement days
      g.append(
        svgEl("rect", {
          x,
          y: padT + plotH - 3,
          width: bw,
          height: 3,
          fill: "rgba(255, 255, 255, 0.08)",
          rx: 1.5,
        }),
      );
    } else {
      if (hIn > 0) {
        g.append(
          svgEl("rect", {
            x,
            y: padT + plotH - hIn,
            width: bw,
            height: hIn,
            fill: COLORS.in,
            rx: hOut > 0 ? 0 : 3,
          }),
        );
      }
      if (hOut > 0) {
        g.append(
          svgEl("rect", {
            x,
            y: padT + plotH - hIn - hOut,
            width: bw,
            height: hOut,
            fill: COLORS.out,
            rx: 3,
          }),
        );
      }
    }
    svg.append(g);
    if (rows.length <= 10 || i % Math.ceil(rows.length / 7) === 0 || i === rows.length - 1) {
      svg.append(
        svgEl("text", {
          x: x + bw / 2,
          y: H - padB + 18,
          "text-anchor": "middle",
          "font-size": 11,
          "font-family": "'Plus Jakarta Sans', sans-serif",
          "font-weight": "500",
          fill: "#889ba8",
        }, r.day.slice(5)),
      );
    }
  });
  return svg;
}

/** Horizontal gate breakdown cards for today. rows: [{ gate, in, out }] */
export function gateBars(rows) {
  const container = document.createElement("div");
  container.className = "gate-bars-list";
  const max = Math.max(1, ...rows.map((r) => r.in + r.out));

  rows.forEach((r) => {
    const total = r.in + r.out;
    const card = document.createElement("div");
    card.className = "gate-row-card";

    // Header: Gate Name & Live Counts
    const top = document.createElement("div");
    top.className = "gate-row-top";

    const nameWrap = document.createElement("div");
    nameWrap.className = "gate-name-wrap";

    const dot = document.createElement("span");
    dot.className = `gate-status-dot ${total > 0 ? "active" : "idle"}`;
    dot.setAttribute("aria-hidden", "true");

    const name = document.createElement("span");
    name.className = "gate-name";
    name.textContent = r.gate;

    nameWrap.append(dot, name);

    const counts = document.createElement("div");
    counts.className = "gate-counts";

    const inChip = document.createElement("span");
    inChip.className = "gate-chip in";
    inChip.textContent = `${r.in} IN`;

    const outChip = document.createElement("span");
    outChip.className = "gate-chip out";
    outChip.textContent = `${r.out} OUT`;

    counts.append(inChip, outChip);
    top.append(nameWrap, counts);

    // Progress Bar Track
    const track = document.createElement("div");
    track.className = "gate-progress-track";

    if (total > 0) {
      const pIn = (r.in / max) * 100;
      const pOut = (r.out / max) * 100;

      if (r.in > 0) {
        const fillIn = document.createElement("div");
        fillIn.className = "gate-bar-in";
        fillIn.style.width = `${pIn}%`;
        track.append(fillIn);
      }
      if (r.out > 0) {
        const fillOut = document.createElement("div");
        fillOut.className = "gate-bar-out";
        fillOut.style.width = `${pOut}%`;
        track.append(fillOut);
      }
    } else {
      const idleTrack = document.createElement("div");
      idleTrack.className = "gate-idle-indicator";
      track.append(idleTrack);
    }

    card.append(top, track);
    container.append(card);
  });

  return container;
}

/**
 * 24 stacked bars for today, one per hour. buckets: [{ in, out }] x 24.
 * `nowHour` (optional) marks the current hour; `peak` (optional) highlights the busiest hour.
 */
export function hourChart(buckets, { nowHour = null, peak = null } = {}) {
  const W = 560, H = 150, padL = 28, padB = 26, padT = 10, padR = 6;
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
        "font-family": "'Plus Jakarta Sans', sans-serif",
        "font-weight": "500",
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
          "font-family": "'Plus Jakarta Sans', sans-serif",
          "font-weight": "500",
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
        "font-family": "'Plus Jakarta Sans', sans-serif",
        "font-weight": 600,
        fill: "#a3e635",
      }, `peak ${peak.count}`),
    );
  }
  return svg;
}
