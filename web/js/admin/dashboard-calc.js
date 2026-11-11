// Pure helpers for the dashboard (no DOM, no network) so they can be unit-tested.

export function greeting(hour) {
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** The hour (0-23) and ISO date (YYYY-MM-DD) of an instant in a time zone. */
export function localParts(date, tz) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

/** "42 min", "5 h 12 min", "2 d 3 h", "<1 min". */
export function fmtDuration(ms) {
  const min = Math.floor(Math.max(0, ms) / 60000);
  if (min < 1) return "<1 min";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ${String(min % 60).padStart(2, "0")} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

/** "just now", "3 min ago", "2 h ago", "yesterday", "5 d ago". */
export function relTime(iso, now = Date.now()) {
  const s = Math.floor((now - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} d ago`;
}

/** Day-over-day trend text and direction. */
export function trend(today, yesterday) {
  if (yesterday == null) return { dir: "flat", text: "No earlier day to compare" };
  const diff = today - yesterday;
  if (diff === 0) return { dir: "flat", text: "Same as yesterday" };
  const pct = yesterday > 0
    ? ` (${diff > 0 ? "+" : "-"}${Math.round(Math.abs(diff) / yesterday * 100)}%)`
    : "";
  return {
    dir: diff > 0 ? "up" : "down",
    text: `${diff > 0 ? "+" : "-"}${Math.abs(diff)} vs yesterday${pct}`,
  };
}

export const pct = (n, total) => (total > 0 ? Math.round((n / total) * 100) : 0);

/** Totals for the daily series: [{day, in, out}]. */
export function dailyTotals(daily) {
  const rows = daily ?? [];
  const inTotal = rows.reduce((n, r) => n + r.in, 0);
  const outTotal = rows.reduce((n, r) => n + r.out, 0);
  let busiest = null;
  for (const r of rows) if (!busiest || r.in + r.out > busiest.in + busiest.out) busiest = r;
  return {
    in: inTotal,
    out: outTotal,
    total: inTotal + outTotal,
    avg: rows.length ? Math.round((inTotal + outTotal) / rows.length) : 0,
    busiest: busiest && busiest.in + busiest.out > 0 ? busiest : null,
  };
}

/** 24 buckets {in, out} for the movements that happened on `todayIso` in `tz`. */
export function hourBuckets(rows, tz, todayIso) {
  const b = Array.from({ length: 24 }, () => ({ in: 0, out: 0 }));
  for (const r of rows ?? []) {
    const p = localParts(new Date(r.scanned_at), tz);
    if (p.date !== todayIso) continue;
    b[p.hour][r.direction === "IN" ? "in" : "out"] += 1;
  }
  return b;
}

/** The busiest hour, or null when there was no movement. */
export function peakHour(buckets) {
  let best = -1;
  let n = 0;
  buckets.forEach((b, i) => {
    if (b.in + b.out > n) {
      n = b.in + b.out;
      best = i;
    }
  });
  const hh = (h) => `${h % 12 || 12}:00 ${h < 12 ? "AM" : "PM"}`;
  return best < 0 ? null : { hour: best, count: n, label: `${hh(best)}–${hh((best + 1) % 24)}` };
}

const DENIAL = {
  blocked: "Blocked vehicle",
  expired: "Pass expired",
  not_yet_valid: "Pass not valid yet",
  pending: "Not approved yet",
  rejected: "Registration rejected",
  unregistered: "Unknown QR code",
  invalid_gate: "Gate not available",
  double_in: "Already inside",
  double_out: "Already outside",
  no_entry_record: "No entry record",
};
export const denialLabel = (code) => DENIAL[code] ?? "Not allowed";

/** Items that need a person, in priority order. Each: { tone, text, href, cta }. */
export function attentionItems({ pending, oldestPendingMs, warnings, blocked, longInside }) {
  const out = [];
  if (pending > 0) {
    out.push({
      tone: "warn",
      text: `${pending} registration${pending === 1 ? " is" : "s are"} waiting for approval` +
        (oldestPendingMs > 3600_000 ? ` (oldest ${fmtDuration(oldestPendingMs)})` : ""),
      href: "#/pending",
      cta: "Review",
    });
  }
  if (longInside > 0) {
    out.push({
      tone: "warn",
      text: `${longInside} vehicle${
        longInside === 1 ? " has" : "s have"
      } been inside for more than 12 hours`,
      href: "#/inside",
      cta: "See who",
    });
  }
  if (warnings > 0) {
    out.push({
      tone: "info",
      text: `${warnings} gate warning${warnings === 1 ? "" : "s"} today (double entry or exit)`,
      href: "#/logs",
      cta: "View logs",
    });
  }
  if (blocked > 0) {
    out.push({
      tone: "info",
      text: `${blocked} blocked vehicle${blocked === 1 ? "" : "s"} on the list`,
      href: "#/vehicles",
      cta: "Manage",
    });
  }
  return out;
}

/**
 * Numbers for the Approvals header, all derived from real rows.
 * approved: [{created_at, approved_at}], rejected: [{updated_at}] (recent decisions only).
 */
export function approvalMetrics({ pending, approved, rejected, tz, todayIso, now = new Date() }) {
  const dayOf = (iso) => localParts(new Date(iso), tz).date;
  const yIso = localParts(new Date(now.getTime() - 86400_000), tz).date;
  const ok = (approved ?? []).filter((r) => r.approved_at);
  const approvedToday = ok.filter((r) => dayOf(r.approved_at) === todayIso);
  const approvedYesterday = ok.filter((r) => dayOf(r.approved_at) === yIso).length;
  const rejectedToday = (rejected ?? []).filter((r) => dayOf(r.updated_at) === todayIso).length;
  const waits = approvedToday.map((r) =>
    Math.max(0, new Date(r.approved_at) - new Date(r.created_at))
  );
  const avgMs = waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : null;
  const fast = waits.filter((w) => w < 30 * 60_000).length;
  const decided = approvedToday.length + rejectedToday;
  return {
    pending,
    approvedToday: approvedToday.length,
    approvedDelta: approvedToday.length - approvedYesterday,
    approvedYesterday,
    rejectedToday,
    avgMs,
    fastPct: pct(fast, waits.length),
    pendingShare: pct(pending, pending + decided),
    approvedShare: pct(approvedToday.length, decided),
    rejectedShare: pct(rejectedToday, decided),
  };
}
