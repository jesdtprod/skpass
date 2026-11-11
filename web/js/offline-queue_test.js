import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  createQueue,
  HISTORY_LIMIT,
  isNearExpiry,
  memoryStore,
  needsAttention,
  syncQueue,
} from "./offline-queue.js";

const T = (n) => new Date(Date.UTC(2026, 10, 11, 8, 0, n)).toISOString();
const item = (key, n, extra = {}) => ({
  key,
  token: "tok" + key,
  gate_id: "G1",
  user_id: "u1",
  scanned_at: T(n),
  ...extra,
});
const ok = (extra = {}) => ({
  kind: "result",
  data: { result: "ok", code: "ok", direction: "IN", vehicle: { plate: "ABC-1" }, ...extra },
});

Deno.test("queue returns pending items oldest-first regardless of insertion order", async () => {
  const q = createQueue(memoryStore());
  await q.add(item("c", 30));
  await q.add(item("a", 10));
  await q.add(item("b", 20));
  assertEquals((await q.pending("u1")).map((i) => i.key), ["a", "b", "c"]);
});

Deno.test("the same idempotency key is never queued twice", async () => {
  const q = createQueue(memoryStore());
  await q.add(item("k1", 1));
  await q.add(item("k1", 2));
  assertEquals((await q.pending("u1")).length, 1);
});

Deno.test("items are only replayed by the user who scanned them", async () => {
  const q = createQueue(memoryStore());
  await q.add(item("a", 1, { user_id: "u1" }));
  await q.add(item("b", 2, { user_id: "u2" }));
  assertEquals((await q.pending("u1")).map((i) => i.key), ["a"]);
  const c = await q.counts("u1");
  assertEquals([c.pending, c.others], [1, 1]);
});

Deno.test("sync sends strictly in order and removes delivered items", async () => {
  const q = createQueue(memoryStore());
  await q.add(item("c", 30));
  await q.add(item("a", 10));
  await q.add(item("b", 20));
  const sentOrder = [];
  const s = await syncQueue(q, "u1", (it) => {
    sentOrder.push(it.key);
    return Promise.resolve(ok());
  });
  assertEquals(sentOrder, ["a", "b", "c"]);
  assertEquals([s.sent, s.ok, s.stopped], [3, 3, null]);
  assertEquals((await q.pending("u1")).length, 0);
});

Deno.test("a network failure stops the run and keeps everything not yet delivered", async () => {
  const q = createQueue(memoryStore());
  for (const [k, n] of [["a", 1], ["b", 2], ["c", 3]]) await q.add(item(k, n));
  let calls = 0;
  const s = await syncQueue(q, "u1", () => {
    calls += 1;
    return Promise.resolve(calls === 1 ? ok() : { kind: "network" });
  });
  assertEquals(s.stopped, "network");
  assertEquals(calls, 2); // did not keep hammering after the failure
  assertEquals((await q.pending("u1")).map((i) => i.key), ["b", "c"]);
});

Deno.test("auth and forbidden also stop the run without touching the queue", async () => {
  for (const kind of ["auth", "forbidden"]) {
    const q = createQueue(memoryStore());
    await q.add(item("a", 1));
    const s = await syncQueue(q, "u1", () => Promise.resolve({ kind }));
    assertEquals(s.stopped, kind);
    assertEquals((await q.pending("u1")).length, 1);
  }
});

Deno.test("server decisions are classified: ok, warning, duplicate, denied, replayed", async () => {
  const q = createQueue(memoryStore());
  const decisions = [
    ok(),
    ok({ result: "warning", code: "double_in" }),
    ok({ result: "duplicate", code: "cooldown" }),
    ok({ result: "denied", code: "blocked", vehicle: { plate: "BLK-9", owner_name: "Bo" } }),
    ok({ replayed: true }),
  ];
  for (let i = 0; i < decisions.length; i++) await q.add(item("k" + i, i));
  let i = 0;
  const s = await syncQueue(q, "u1", () => Promise.resolve(decisions[i++]));
  assertEquals([s.ok, s.warnings.length, s.duplicates, s.denied.length, s.replayed], [
    2,
    1,
    1,
    1,
    1,
  ]);
  assertEquals(s.denied[0].plate, "BLK-9");
  assert(needsAttention(s));
  assertEquals((await q.pending("u1")).length, 0); // denied scans are not retried forever
});

Deno.test("an unexpected server answer is treated as needing attention, never as ok", async () => {
  const q = createQueue(memoryStore());
  await q.add(item("a", 1));
  const s = await syncQueue(
    q,
    "u1",
    () => Promise.resolve({ kind: "result", data: { result: "weird" } }),
  );
  assertEquals([s.ok, s.denied.length], [0, 1]);
});

Deno.test("a poison item is parked after MAX attempts so it cannot block the queue", async () => {
  const q = createQueue(memoryStore(), { maxAttempts: 3 });
  await q.add(item("bad", 1));
  await q.add(item("good", 2));
  const send = (it) =>
    Promise.resolve(
      it.key === "bad" ? { kind: "error", message: "invalid idempotency key" } : ok(),
    );
  let last;
  for (let run = 0; run < 3; run++) last = await syncQueue(q, "u1", send);
  assertEquals(last.parked, 1);
  assertEquals((await q.pending("u1")).length, 0);
  assertEquals((await q.failedItems("u1")).map((i) => i.key), ["bad"]);
  // the good one behind it was delivered on the first run
  assertEquals((await q.history()).some((h) => h.key === "good"), true);
  await q.retryFailed("u1");
  assertEquals((await q.pending("u1")).length, 1);
});

Deno.test("history is capped", async () => {
  const q = createQueue(memoryStore());
  for (let i = 0; i < HISTORY_LIMIT + 10; i++) {
    await q.done("x" + i, { key: "x" + i, result: "ok" });
  }
  assertEquals((await q.history()).length, HISTORY_LIMIT);
});

Deno.test("counts and oldest timestamp", async () => {
  const q = createQueue(memoryStore());
  await q.add(item("b", 20));
  await q.add(item("a", 10));
  const c = await q.counts("u1");
  assertEquals([c.pending, c.failed, c.oldest], [2, 0, T(10)]);
});

Deno.test("near-expiry warning uses 80% of the configured max age", () => {
  const now = Date.parse(T(0));
  assert(!isNearExpiry(null, 72, now));
  assert(!isNearExpiry(new Date(now - 10 * 3600_000).toISOString(), 72, now));
  assert(isNearExpiry(new Date(now - 60 * 3600_000).toISOString(), 72, now));
});

Deno.test("state returned to callers is a copy (callers cannot corrupt the store)", async () => {
  const q = createQueue(memoryStore());
  await q.add(item("a", 1));
  const p = await q.pending("u1");
  p[0].status = "hacked";
  assertEquals((await q.pending("u1")).length, 1);
});
