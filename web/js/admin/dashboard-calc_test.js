import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  approvalMetrics,
  attentionItems,
  dailyTotals,
  denialLabel,
  fmtDuration,
  greeting,
  hourBuckets,
  localParts,
  pct,
  peakHour,
  relTime,
  trend,
} from "./dashboard-calc.js";

Deno.test("greeting by hour", () => {
  assertEquals(greeting(8), "Good morning");
  assertEquals(greeting(12), "Good afternoon");
  assertEquals(greeting(17), "Good afternoon");
  assertEquals(greeting(19), "Good evening");
  assertEquals(greeting(2), "Good evening");
});

Deno.test("localParts converts an instant into the site's time zone", () => {
  // 2026-11-11 20:30 UTC is 04:30 on the 12th in Manila (UTC+8)
  const p = localParts(new Date("2026-11-11T20:30:00Z"), "Asia/Manila");
  assertEquals(p, { date: "2026-11-12", hour: 4 });
  assertEquals(localParts(new Date("2026-11-11T20:30:00Z"), "UTC"), {
    date: "2026-11-11",
    hour: 20,
  });
  // midnight is hour 0, not 24
  assertEquals(localParts(new Date("2026-11-11T16:00:00Z"), "Asia/Manila").hour, 0);
});

Deno.test("fmtDuration", () => {
  assertEquals(fmtDuration(0), "<1 min");
  assertEquals(fmtDuration(30_000), "<1 min");
  assertEquals(fmtDuration(42 * 60_000), "42 min");
  assertEquals(fmtDuration(5 * 3600_000 + 12 * 60_000), "5 h 12 min");
  assertEquals(fmtDuration(5 * 3600_000 + 2 * 60_000), "5 h 02 min");
  assertEquals(fmtDuration(51 * 3600_000), "2 d 3 h");
  assertEquals(fmtDuration(-5), "<1 min");
});

Deno.test("relTime", () => {
  const now = Date.parse("2026-11-11T12:00:00Z");
  const ago = (s) => new Date(now - s * 1000).toISOString();
  assertEquals(relTime(ago(10), now), "just now");
  assertEquals(relTime(ago(180), now), "3 min ago");
  assertEquals(relTime(ago(2 * 3600), now), "2 h ago");
  assertEquals(relTime(ago(26 * 3600), now), "yesterday");
  assertEquals(relTime(ago(5 * 86400), now), "5 d ago");
});

Deno.test("trend: direction, sign and percentage", () => {
  assertEquals(trend(12, 8), { dir: "up", text: "+4 vs yesterday (+50%)" });
  assertEquals(trend(6, 8), { dir: "down", text: "-2 vs yesterday (-25%)" });
  assertEquals(trend(5, 5), { dir: "flat", text: "Same as yesterday" });
  assertEquals(trend(3, 0), { dir: "up", text: "+3 vs yesterday" }); // no percentage from zero
  assertEquals(trend(3, null).dir, "flat");
});

Deno.test("pct never divides by zero", () => {
  assertEquals(pct(1, 4), 25);
  assertEquals(pct(0, 0), 0);
  assertEquals(pct(2, 3), 67);
});

Deno.test("dailyTotals", () => {
  const t = dailyTotals([
    { day: "a", in: 3, out: 2 },
    { day: "b", in: 10, out: 9 },
    { day: "c", in: 0, out: 0 },
  ]);
  assertEquals([t.in, t.out, t.total, t.avg], [13, 11, 24, 8]);
  assertEquals(t.busiest.day, "b");
  assertEquals(dailyTotals([{ day: "a", in: 0, out: 0 }]).busiest, null);
  assertEquals(dailyTotals([]).avg, 0);
  assertEquals(dailyTotals(undefined).total, 0);
});

Deno.test("hourBuckets keeps only today's movements, by local hour", () => {
  const rows = [
    { scanned_at: "2026-11-11T00:10:00Z", direction: "IN" }, // 08:10 Manila, today
    { scanned_at: "2026-11-11T00:50:00Z", direction: "OUT" }, // 08:50
    { scanned_at: "2026-11-11T01:05:00Z", direction: "IN" }, // 09:05
    { scanned_at: "2026-11-10T14:00:00Z", direction: "IN" }, // 22:00 on the 10th: not today
    { scanned_at: "2026-11-11T16:30:00Z", direction: "IN" }, // 00:30 on the 12th: not today
  ];
  const b = hourBuckets(rows, "Asia/Manila", "2026-11-11");
  assertEquals(b.length, 24);
  assertEquals(b[8], { in: 1, out: 1 });
  assertEquals(b[9], { in: 1, out: 0 });
  assertEquals(b.reduce((n, x) => n + x.in + x.out, 0), 3);
  assertEquals(hourBuckets(undefined, "UTC", "2026-11-11").length, 24);
});

Deno.test("peakHour", () => {
  const b = Array.from({ length: 24 }, () => ({ in: 0, out: 0 }));
  assertEquals(peakHour(b), null);
  b[8] = { in: 3, out: 2 };
  b[17] = { in: 1, out: 1 };
  assertEquals(peakHour(b), { hour: 8, count: 5, label: "8:00 AM–9:00 AM" });
  b[23] = { in: 9, out: 0 };
  assertEquals(peakHour(b).label, "11:00 PM–12:00 AM"); // wraps past midnight
});

Deno.test("denialLabel covers known codes and falls back safely", () => {
  assertEquals(denialLabel("blocked"), "Blocked vehicle");
  assertEquals(denialLabel("unregistered"), "Unknown QR code");
  assertEquals(denialLabel("something_new"), "Not allowed");
});

Deno.test("attention: empty when everything is fine", () => {
  assertEquals(
    attentionItems({ pending: 0, oldestPendingMs: 0, warnings: 0, blocked: 0, longInside: 0 }),
    [],
  );
});

Deno.test("attention: priority order, wording and links", () => {
  const a = attentionItems({
    pending: 2,
    oldestPendingMs: 3 * 3600_000,
    warnings: 1,
    blocked: 4,
    longInside: 1,
  });
  assertEquals(a.map((x) => x.href), ["#/pending", "#/inside", "#/logs", "#/vehicles"]);
  assert(
    a[0].text.includes("2 registrations are waiting") && a[0].text.includes("oldest 3 h 00 min"),
  );
  assert(a[1].text.includes("1 vehicle has been inside"));
  assert(a[2].text.includes("1 gate warning today"));
  assertEquals(a[0].tone, "warn");
  // singular wording and no 'oldest' note for a fresh item
  const one = attentionItems({
    pending: 1,
    oldestPendingMs: 60_000,
    warnings: 0,
    blocked: 0,
    longInside: 0,
  });
  assertEquals(one[0].text, "1 registration is waiting for approval");
});

Deno.test("approvalMetrics counts today's decisions and average wait", () => {
  const now = new Date("2026-11-11T06:00:00Z"); // 14:00 in Manila
  const m = approvalMetrics({
    pending: 2,
    tz: "Asia/Manila",
    todayIso: "2026-11-11",
    now,
    approved: [
      { created_at: "2026-11-11T01:00:00Z", approved_at: "2026-11-11T01:10:00Z" }, // 10 min
      { created_at: "2026-11-11T02:00:00Z", approved_at: "2026-11-11T02:50:00Z" }, // 50 min
      { created_at: "2026-11-10T01:00:00Z", approved_at: "2026-11-10T01:05:00Z" }, // yesterday
    ],
    rejected: [{ updated_at: "2026-11-11T03:00:00Z" }, { updated_at: "2026-11-09T03:00:00Z" }],
  });
  assertEquals([m.approvedToday, m.approvedYesterday, m.approvedDelta], [2, 1, 1]);
  assertEquals(m.rejectedToday, 1);
  assertEquals(m.avgMs, 30 * 60_000);
  assertEquals(m.fastPct, 50);
  assertEquals(m.pendingShare, 40); // 2 of (2 + 3 decided)
  assertEquals(approvalMetrics({ pending: 0, tz: "UTC", todayIso: "x", now }).avgMs, null);
});
