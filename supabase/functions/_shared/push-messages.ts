// The notification texts. Pure functions. URLs are RELATIVE to the site root; the service worker
// resolves them against its own scope, so they work both at /skpass/ and /skpass/web/.

export type PushKind = "new_registration" | "decision" | "test";

export interface PushMessage {
  kind: PushKind;
  title: string;
  body: string;
  url: string;
  tag: string; // a newer notification with the same tag replaces the older one
  status?: "approved" | "rejected";
  vehicle_id?: string;
}

const clip = (s: string, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const cap = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : s;

export function newRegistrationMessage(
  v: { id: string; category: string; plate: string },
): PushMessage {
  return {
    kind: "new_registration",
    title: "New registration",
    body: `${cap(clip(v.category, 20))} · ${clip(v.plate, 15)} is waiting for approval`,
    url: "admin/#/pending",
    tag: `new-${v.id}`,
    vehicle_id: v.id,
  };
}

/** Only approved/rejected produce a message; anything else returns null. */
export function decisionMessage(
  v: { id: string; status: string; plate: string },
): PushMessage | null {
  const plate = clip(v.plate, 15);
  const base = {
    kind: "decision" as const,
    url: `my-qr/?v=${encodeURIComponent(v.id)}`,
    tag: `decision-${v.id}`,
    vehicle_id: v.id,
  };
  if (v.status === "approved") {
    return {
      ...base,
      status: "approved",
      title: "Registration approved ✓",
      body: `Your pass for ${plate} is ready. Tap to open your QR.`,
    };
  }
  if (v.status === "rejected") {
    return {
      ...base,
      status: "rejected",
      title: "Registration not approved",
      body: `Your request for ${plate} was not approved. Tap to see why.`,
    };
  }
  return null;
}

export function testMessage(): PushMessage {
  return {
    kind: "test",
    title: "SKPass test notification",
    body: "Notifications are working on this device.",
    url: "admin/",
    tag: "test",
  };
}
