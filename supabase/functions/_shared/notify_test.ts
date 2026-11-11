import { assert, assertEquals } from "jsr:@std/assert@1";
import { decisionMessage, newRegistrationMessage, testMessage } from "./push-messages.ts";
import {
  deliver,
  MAX_FAILS,
  notifyAdmins,
  notifyOwner,
  type SubRow,
  type SubStore,
} from "./notify.ts";
import type { Vapid } from "./webpush.ts";

const vapid: Vapid = { publicKey: "p", privateKey: "k", subject: "https://x/" };
const row = (id: string, fail_count = 0): SubRow => ({
  id,
  endpoint: `https://fcm.googleapis.com/${id}`,
  p256dh: "a",
  auth: "b",
  fail_count,
});

function fakeStore(rows: SubRow[]) {
  const log: string[] = [];
  const asked: unknown[] = [];
  const store: SubStore = {
    list: (f) => {
      asked.push(f);
      return Promise.resolve(rows);
    },
    markOk: (id) => {
      log.push(`ok:${id}`);
      return Promise.resolve();
    },
    markFail: (id, n, remove) => {
      log.push(`fail:${id}:${n}:${remove ? "removed" : "kept"}`);
      return Promise.resolve();
    },
  };
  return { store, log, asked };
}

Deno.test("messages: new registration", () => {
  const m = newRegistrationMessage({ id: "01ABC", category: "visitor", plate: "SMP-1001" });
  assertEquals([m.kind, m.title, m.url, m.tag], [
    "new_registration",
    "New registration",
    "admin/#/pending",
    "new-01ABC",
  ]);
  assert(m.body.includes("Visitor") && m.body.includes("SMP-1001"));
});

Deno.test("messages: approved and rejected differ, others produce nothing", () => {
  const a = decisionMessage({ id: "V1", status: "approved", plate: "ABC-123" })!;
  const r = decisionMessage({ id: "V1", status: "rejected", plate: "ABC-123" })!;
  assertEquals([a.status, r.status], ["approved", "rejected"]);
  assert(a.title.includes("approved") && r.title.includes("not approved"));
  assertEquals(a.url, "my-qr/?v=V1");
  assertEquals(a.tag, r.tag); // a later decision replaces an earlier one on the device
  for (const s of ["pending", "blocked", "weird"]) {
    assertEquals(decisionMessage({ id: "V1", status: s, plate: "X" }), null);
  }
});

Deno.test("messages: URLs are relative and ids are encoded", () => {
  const m = decisionMessage({ id: "a/b?c", status: "approved", plate: "X" })!;
  assert(!m.url.startsWith("/") && !m.url.includes("://"));
  assertEquals(m.url, "my-qr/?v=a%2Fb%3Fc");
  assertEquals(testMessage().kind, "test");
});

Deno.test("messages: text is clipped and whitespace-normalised", () => {
  const m = newRegistrationMessage({
    id: "1",
    category: "employee",
    plate: "A".repeat(50) + "\n\n  B",
  });
  assert(m.body.length < 80);
  assert(!m.body.includes("\n"));
});

Deno.test("deliver: successes are marked, 410 removes the subscription at once", async () => {
  const { store, log } = fakeStore([]);
  const rep = await deliver(
    store,
    [row("a"), row("b")],
    testMessage(),
    vapid,
    (s) =>
      Promise.resolve(
        s.endpoint.endsWith("/a")
          ? { status: 201, ok: true, gone: false }
          : { status: 410, ok: false, gone: true },
      ),
  );
  assertEquals([rep.subscribers, rep.sent, rep.removed, rep.failed], [2, 1, 1, 0]);
  assert(log.includes("ok:a") && log.includes("fail:b:1:removed"));
});

Deno.test("deliver: transient failures are kept until MAX_FAILS in a row, then removed", async () => {
  const send = () => Promise.resolve({ status: 503, ok: false, gone: false });
  const first = fakeStore([]);
  let rep = await deliver(first.store, [row("a", 0)], testMessage(), vapid, send);
  assertEquals([rep.failed, rep.removed], [1, 0]);
  assertEquals(first.log, ["fail:a:1:kept"]);
  const last = fakeStore([]);
  rep = await deliver(last.store, [row("a", MAX_FAILS - 1)], testMessage(), vapid, send);
  assertEquals([rep.failed, rep.removed], [0, 1]);
  assertEquals(last.log, [`fail:a:${MAX_FAILS}:removed`]);
});

Deno.test("deliver: the payload sent is exactly the message", async () => {
  const { store } = fakeStore([]);
  let seen: unknown;
  await deliver(store, [row("a")], testMessage(), vapid, (_s, payload) => {
    seen = payload;
    return Promise.resolve({ status: 201, ok: true, gone: false });
  });
  assertEquals(seen, testMessage());
});

Deno.test("notifyAdmins / notifyOwner ask the store for the right audience", async () => {
  const a = fakeStore([row("x")]);
  const ok = () => Promise.resolve({ status: 201, ok: true, gone: false });
  await notifyAdmins(a.store, testMessage(), vapid, ok);
  assertEquals(a.asked[0], { audience: "admin" });
  const o = fakeStore([row("y")]);
  const rep = await notifyOwner(o.store, "V9", testMessage(), vapid, ok);
  assertEquals(o.asked[0], { audience: "owner", vehicleId: "V9" });
  assertEquals(rep.sent, 1);
});

Deno.test("deliver: no subscribers is a clean no-op", async () => {
  const { store, log } = fakeStore([]);
  const rep = await deliver(store, [], testMessage(), vapid);
  assertEquals([rep.subscribers, rep.sent], [0, 0]);
  assertEquals(log, []);
});
