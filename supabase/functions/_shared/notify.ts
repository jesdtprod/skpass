// Delivery of push messages to stored subscriptions, with housekeeping:
// subscriptions the push service says are gone (404/410) are deleted at once, and ones that keep
// failing are deleted after MAX_FAILS consecutive failures.
import type { PushMessage } from "./push-messages.ts";
import { type PushSub, sendPush, type SendResult, type Vapid } from "./webpush.ts";

export const MAX_FAILS = 5;

export interface SubRow extends PushSub {
  id: string;
  fail_count: number;
}

export interface SubStore {
  list(
    filter: { audience: "admin" | "owner"; vehicleId?: string; userId?: string },
  ): Promise<SubRow[]>;
  markOk(id: string): Promise<void>;
  markFail(id: string, fail_count: number, remove: boolean): Promise<void>;
}

export type Sender = (sub: PushSub, payload: unknown, vapid: Vapid) => Promise<SendResult>;

export interface DeliveryReport {
  subscribers: number;
  sent: number;
  removed: number;
  failed: number;
}

export function vapidFromEnv(): Vapid | null {
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const subject = Deno.env.get("VAPID_SUBJECT") ?? "https://example.org/";
  return publicKey && privateKey ? { publicKey, privateKey, subject } : null;
}

export async function deliver(
  store: SubStore,
  subs: SubRow[],
  msg: PushMessage,
  vapid: Vapid,
  send: Sender = (s, p, v) => sendPush(s, p, v),
): Promise<DeliveryReport> {
  const report: DeliveryReport = { subscribers: subs.length, sent: 0, removed: 0, failed: 0 };
  await Promise.all(subs.map(async (s) => {
    const r = await send(s, msg, vapid);
    if (r.ok) {
      report.sent += 1;
      await store.markOk(s.id);
    } else if (r.gone) {
      report.removed += 1;
      await store.markFail(s.id, s.fail_count + 1, true);
    } else {
      const fails = s.fail_count + 1;
      const remove = fails >= MAX_FAILS;
      if (remove) report.removed += 1;
      else report.failed += 1;
      await store.markFail(s.id, fails, remove);
    }
  }));
  return report;
}

export async function notifyAdmins(store: SubStore, msg: PushMessage, vapid: Vapid, send?: Sender) {
  return deliver(store, await store.list({ audience: "admin" }), msg, vapid, send);
}

export async function notifyOwner(
  store: SubStore,
  vehicleId: string,
  msg: PushMessage,
  vapid: Vapid,
  send?: Sender,
) {
  return deliver(store, await store.list({ audience: "owner", vehicleId }), msg, vapid, send);
}

// ---- the real store, over the service-role Supabase client
interface Db {
  from(table: string): {
    select(cols: string): Q;
    update(v: Record<string, unknown>): Q;
  };
}
// deno-lint-ignore no-explicit-any
type Q = any;

export function supabaseStore(db: Db): SubStore {
  return {
    async list({ audience, vehicleId, userId }) {
      let q = db.from("push_subscriptions").select("id, endpoint, p256dh, auth, fail_count")
        .eq("audience", audience).is("deleted_at", null);
      if (vehicleId) q = q.eq("vehicle_id", vehicleId);
      if (userId) q = q.eq("user_id", userId);
      const { data } = await q;
      return (data ?? []) as SubRow[];
    },
    async markOk(id) {
      await db.from("push_subscriptions")
        .update({ last_success_at: new Date().toISOString(), fail_count: 0 }).eq("id", id);
    },
    async markFail(id, fail_count, remove) {
      await db.from("push_subscriptions").update(
        remove ? { deleted_at: new Date().toISOString(), fail_count } : { fail_count },
      ).eq("id", id);
    },
  };
}
