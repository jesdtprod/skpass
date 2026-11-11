import { assert, assertEquals } from "jsr:@std/assert@1";
import { buildSchedule, REPEATS, soundKinds } from "./alert-sound.js";
import { pushSupport, urlBase64ToUint8Array } from "./notify.js";

Deno.test("every alert plays exactly 3 repeated bursts", () => {
  assertEquals(REPEATS, 3);
  for (const kind of soundKinds()) {
    const s = buildSchedule(kind);
    // the first note of each burst starts the burst: its frequency must appear exactly 3 times at burst starts
    const first = s.notes[0].freq;
    const bursts = s.notes.filter((n) =>
      n.at === 0 || n.freq === first && s.notes.indexOf(n) % (s.notes.length / 3) === 0
    );
    assertEquals(bursts.length, 3, kind);
    assertEquals(s.notes.length % 3, 0, kind);
  }
});

Deno.test("bursts are separated by a real pause and times only move forward", () => {
  for (const kind of soundKinds()) {
    const s = buildSchedule(kind);
    for (let i = 1; i < s.notes.length; i++) assert(s.notes[i].at >= s.notes[i - 1].at, kind);
    const per = s.notes.length / 3;
    const endOfBurst1 = s.notes[per - 1].at + s.notes[per - 1].dur;
    assert(s.notes[per].at - endOfBurst1 >= 0.3, `${kind}: gap too short`); // audible pause
  }
});

Deno.test("whole alert is long enough to notice and short enough to tolerate", () => {
  for (const kind of soundKinds()) {
    const { total } = buildSchedule(kind);
    assert(total >= 1.4 && total <= 5, `${kind}: ${total}s`);
  }
});

Deno.test("the three meanings sound different", () => {
  const sig = (k) => buildSchedule(k).notes.slice(0, 4).map((n) => n.freq).join(",");
  assert(new Set(["new_registration", "approved", "rejected"].map(sig)).size === 3);
  // approved rises, rejected falls
  const a = buildSchedule("approved").notes.slice(0, 4).map((n) => n.freq);
  const r = buildSchedule("rejected").notes.slice(0, 3).map((n) => n.freq);
  assert(a[3] > a[0]);
  assert(r[2] < r[0]);
});

Deno.test("vibration pattern has one long buzz per repeat and no trailing pause", () => {
  const v = buildSchedule("new_registration").vibrate;
  assertEquals(v.length, 5); // buzz, pause, buzz, pause, buzz
  assert(v.every((n) => n > 0));
});

Deno.test("unknown kinds fall back to the test beep instead of throwing", () => {
  assertEquals(buildSchedule("nonsense").notes.length, buildSchedule("test").notes.length);
});

Deno.test("VAPID public key decodes to a 65-byte uncompressed P-256 point", () => {
  const k = urlBase64ToUint8Array(
    "BCgqP2YtHyzo3Iwf5JfTZchDSs2wGXWEVv9UUXQhtUzCRknB12z1FkLp3Q4MBu7gllCe3OpFLEATX68Hb7xdzjk",
  );
  assertEquals(k.length, 65);
  assertEquals(k[0], 4);
});

Deno.test("pushSupport explains itself in a Deno (non-browser) environment", () => {
  const s = pushSupport();
  assertEquals(s.supported, false);
  assert(typeof s.reason === "string" && s.reason.length > 0);
});
