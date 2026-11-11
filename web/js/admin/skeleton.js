// High-fidelity shimmer skeleton loading components for the SKPass Admin Console.
import { h } from "./util.js";

/** Shimmer helper building an animated bone element. */
export function bone(width, height, radius = 6, extraCls = "") {
  return h("div", {
    class: `sk-shimmer ${extraCls}`.trim(),
    style: `width:${width};height:${height};border-radius:${radius}px;`,
    "aria-hidden": "true",
  });
}

/** Brand-tinted lime shimmer bone. */
export function boneBrand(width, height, radius = 6, extraCls = "") {
  return h("div", {
    class: `sk-shimmer-brand ${extraCls}`.trim(),
    style: `width:${width};height:${height};border-radius:${radius}px;`,
    "aria-hidden": "true",
  });
}

/** Standard admin page header skeleton. */
export function headerSkeleton(titleWidth = "180px", subWidth = "320px", actions = []) {
  return h(
    "div",
    { class: "admin-skeleton-head" },
    h(
      "div",
      { class: "admin-skeleton-head-info" },
      bone(titleWidth, "32px", 8, "admin-skeleton-title"),
      bone(subWidth, "16px", 6, "admin-skeleton-sub"),
    ),
    actions.length ? h("div", { class: "admin-skeleton-actions" }, ...actions) : null,
  );
}

/** 4-KPI cards strip skeleton used on Approvals and overview views. */
export function kpiStripSkeleton(count = 4) {
  const cards = [];
  for (let i = 0; i < count; i++) {
    cards.push(
      h(
        "div",
        { class: "admin-skeleton-kpi-card" },
        bone("90px", "13px", 4),
        h(
          "div",
          { class: "admin-skeleton-kpi-value-row" },
          bone("55px", "28px", 6),
          bone("80px", "12px", 4),
        ),
        bone("100%", "4px", 2),
      ),
    );
  }
  return h("div", { class: "admin-skeleton-kpis" }, ...cards);
}

/** 6 stats cards grid skeleton used on Dashboard. */
export function statsGridSkeleton(count = 6) {
  const cards = [];
  for (let i = 0; i < count; i++) {
    cards.push(
      h(
        "div",
        { class: "admin-skeleton-stat-card" },
        h(
          "div",
          { class: "admin-skeleton-stat-top" },
          bone("105px", "14px", 4),
          bone("36px", "36px", 10),
        ),
        bone("64px", "32px", 8),
        bone("130px", "12px", 4),
      ),
    );
  }
  return h("div", { class: "admin-skeleton-stats" }, ...cards);
}

/** Data table skeleton with custom columns and row counts. */
export function tableSkeleton({
  cols = ["110px", "150px", "90px", "100px", "120px"],
  rows = 6,
  showPager = true,
  actions = 0,
} = {}) {
  const theadTr = h("tr");
  for (const w of cols) {
    theadTr.append(h("th", {}, bone(w, "12px", 4)));
  }
  if (actions > 0) {
    theadTr.append(h("th", {}, bone("70px", "12px", 4)));
  }

  const tbody = h("tbody");
  for (let r = 0; r < rows; r++) {
    const tr = h("tr");
    cols.forEach((w, cIdx) => {
      // Plate column (first column) looks like a plate badge
      if (cIdx === 0) {
        tr.append(h("td", {}, bone("84px", "24px", 6)));
      } else if (cIdx === 1) {
        // Owner name with phone subline
        tr.append(
          h(
            "td",
            {},
            bone("130px", "13px", 4),
            h("div", { style: "height:4px" }),
            bone("80px", "10px", 4),
          ),
        );
      } else if (cIdx === 2) {
        // Category pill
        tr.append(h("td", {}, bone("68px", "20px", 999)));
      } else {
        tr.append(h("td", {}, bone(w, "13px", 4)));
      }
    });
    if (actions > 0) {
      const actWrap = h("div", { class: "admin-skeleton-row-actions" });
      for (let a = 0; a < actions; a++) {
        actWrap.append(bone("28px", "28px", 8));
      }
      tr.append(h("td", {}, actWrap));
    }
    tbody.append(tr);
  }

  return h(
    "div",
    { class: "admin-skeleton-tablewrap" },
    h(
      "table",
      { class: "admin-skeleton-table" },
      h("thead", {}, theadTr),
      tbody,
    ),
    showPager
      ? h(
        "div",
        { class: "admin-skeleton-pager" },
        bone("140px", "13px", 4),
        h(
          "div",
          { style: "display:flex;gap:8px" },
          bone("68px", "28px", 8),
          bone("54px", "28px", 8),
        ),
      )
      : null,
  );
}

/** Notification feed item skeletons for the alerts dropdown. */
export function notifFeedSkeleton(count = 3) {
  const items = [];
  for (let i = 0; i < count; i++) {
    items.push(
      h(
        "div",
        { class: "admin-skeleton-notif-item" },
        bone("32px", "32px", 8),
        h(
          "div",
          { style: "flex:1;display:flex;flex-direction:column;gap:5px" },
          bone("140px", "13px", 4),
          bone("80px", "10px", 4),
        ),
        bone("40px", "10px", 4),
      ),
    );
  }
  return items;
}

/** Dashboard main panels skeleton (Activity chart + Today by gate). */
export function dashboardPanelsSkeleton() {
  // Activity Panel
  const activityPanel = h(
    "div",
    { class: "admin-skeleton-panel" },
    h(
      "div",
      { class: "admin-skeleton-panel-head" },
      bone("160px", "18px", 6),
      bone("32px", "32px", 9),
    ),
    // KPI summary chips
    h(
      "div",
      { style: "display:flex;flex-wrap:wrap;gap:8px;margin-bottom:6px" },
      bone("110px", "28px", 8),
      bone("60px", "28px", 8),
      bone("65px", "28px", 8),
      bone("90px", "28px", 8),
    ),
    // Chart slot simulation with 14 vertical bar slots
    h(
      "div",
      {
        style:
          "height:200px;border-radius:12px;background:rgba(255,255,255,0.02);border:1px dashed rgba(255,255,255,0.07);display:flex;align-items:flex-end;justify-content:space-between;padding:16px 20px;gap:8px",
      },
      ...Array.from({ length: 14 }).map((_, i) => bone("18px", `${30 + ((i * 17) % 110)}px`, 4)),
    ),
    // Legend
    h(
      "div",
      {
        style: "display:flex;gap:16px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.06)",
      },
      bone("90px", "12px", 4),
      bone("80px", "12px", 4),
    ),
  );

  // Today by gate Panel
  const gateRows = [];
  for (let i = 0; i < 2; i++) {
    gateRows.push(
      h(
        "div",
        {
          style:
            "padding:12px 14px;border-radius:12px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);display:flex;flex-direction:column;gap:10px",
        },
        h(
          "div",
          { style: "display:flex;justify-content:space-between;align-items:center" },
          h(
            "div",
            { style: "display:flex;align-items:center;gap:8px" },
            bone("8px", "8px", 999),
            bone(i === 0 ? "85px" : "95px", "14px", 4),
          ),
          h(
            "div",
            { style: "display:flex;gap:6px" },
            bone("42px", "18px", 6),
            bone("46px", "18px", 6),
          ),
        ),
        bone("100%", "6px", 3),
      ),
    );
  }

  const gatePanel = h(
    "div",
    { class: "admin-skeleton-panel" },
    h(
      "div",
      { class: "admin-skeleton-panel-head" },
      bone("120px", "18px", 6),
      bone("32px", "32px", 9),
    ),
    h(
      "div",
      { style: "display:flex;flex-direction:column;gap:10px;flex:1" },
      ...gateRows,
    ),
    h(
      "div",
      {
        style: "display:flex;gap:16px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.06)",
      },
      bone("90px", "12px", 4),
      bone("80px", "12px", 4),
    ),
  );

  return h("div", { class: "admin-skeleton-panels" }, activityPanel, gatePanel);
}

/** Route-specific skeleton generator. */
export function renderRouteSkeleton(routeId) {
  const root = h("div", {
    class: "admin-skeleton",
    role: "status",
    "aria-label": "Loading page content…",
  });

  switch (routeId) {
    case "dashboard": {
      root.append(
        headerSkeleton("190px", "340px", [
          bone("80px", "28px", 999),
          bone("140px", "32px", 10),
          bone("85px", "32px", 10),
        ]),
        statsGridSkeleton(6),
        dashboardPanelsSkeleton(),
        h(
          "div",
          { class: "admin-skeleton-panels" },
          tableSkeleton({ cols: ["90px", "110px", "80px", "100px"], rows: 4, showPager: false }),
          tableSkeleton({ cols: ["85px", "120px", "70px"], rows: 4, showPager: false, actions: 1 }),
        ),
      );
      break;
    }

    case "pending": {
      root.append(
        headerSkeleton("160px", "300px", [
          bone("140px", "32px", 999),
          boneBrand("120px", "36px", 10),
          bone("36px", "36px", 10),
        ]),
        kpiStripSkeleton(4),
        h(
          "div",
          { class: "admin-skeleton-toolbar" },
          bone("240px", "40px", 10, "admin-skeleton-input"),
          bone("50px", "34px", 999),
          bone("90px", "34px", 999),
          bone("80px", "34px", 999),
          bone("80px", "34px", 999),
        ),
        tableSkeleton({
          cols: ["90px", "130px", "75px", "70px", "120px", "100px"],
          rows: 6,
          actions: 3,
        }),
      );
      break;
    }

    case "vehicles": {
      root.append(
        headerSkeleton("140px", "360px", [boneBrand("115px", "38px", 10)]),
        h(
          "div",
          { class: "admin-skeleton-toolbar" },
          bone("260px", "40px", 10, "admin-skeleton-input"),
          bone("130px", "40px", 10, "admin-skeleton-input"),
          bone("130px", "40px", 10, "admin-skeleton-input"),
          bone("75px", "36px", 9),
        ),
        tableSkeleton({
          cols: ["90px", "150px", "80px", "85px", "130px", "110px"],
          rows: 7,
        }),
      );
      break;
    }

    case "inside": {
      root.append(
        headerSkeleton("150px", "280px"),
        tableSkeleton({
          cols: ["90px", "140px", "80px", "120px", "100px", "110px", "70px"],
          rows: 6,
        }),
      );
      break;
    }

    case "logs": {
      root.append(
        headerSkeleton("110px", "350px"),
        h(
          "div",
          { class: "admin-skeleton-toolbar" },
          bone("120px", "40px", 10, "admin-skeleton-input"),
          bone("120px", "40px", 10, "admin-skeleton-input"),
          bone("130px", "40px", 10, "admin-skeleton-input"),
          bone("110px", "40px", 10, "admin-skeleton-input"),
          bone("110px", "40px", 10, "admin-skeleton-input"),
          bone("130px", "40px", 10, "admin-skeleton-input"),
          bone("105px", "38px", 10),
        ),
        tableSkeleton({
          cols: ["110px", "90px", "60px", "65px", "85px", "75px", "130px", "110px"],
          rows: 8,
        }),
      );
      break;
    }

    case "gates": {
      root.append(
        headerSkeleton("120px", "360px", [boneBrand("110px", "38px", 10)]),
        h(
          "div",
          {
            style:
              "display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px",
          },
          bone("100%", "140px", 14),
          bone("100%", "140px", 14),
          bone("100%", "140px", 14),
        ),
      );
      break;
    }

    case "staff": {
      root.append(
        headerSkeleton("120px", "340px", [boneBrand("110px", "38px", 10)]),
        tableSkeleton({
          cols: ["140px", "160px", "80px", "130px", "110px"],
          rows: 5,
          actions: 2,
        }),
      );
      break;
    }

    case "health": {
      root.append(
        headerSkeleton("170px", "300px"),
        h(
          "div",
          {
            style:
              "display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px;margin-bottom:12px",
          },
          bone("100%", "90px", 14),
          bone("100%", "90px", 14),
          bone("100%", "90px", 14),
          bone("100%", "90px", 14),
          bone("100%", "90px", 14),
        ),
        tableSkeleton({
          cols: ["120px", "180px", "100px", "140px"],
          rows: 5,
        }),
      );
      break;
    }

    case "settings": {
      root.append(
        headerSkeleton("130px", "260px"),
        h(
          "div",
          { style: "display:flex;flex-direction:column;gap:18px" },
          bone("100%", "180px", 16),
          bone("100%", "160px", 16),
          bone("100%", "200px", 16),
        ),
      );
      break;
    }

    default: {
      root.append(
        headerSkeleton("160px", "300px"),
        tableSkeleton({ cols: ["100px", "140px", "90px", "120px"], rows: 6 }),
      );
      break;
    }
  }

  return root;
}
