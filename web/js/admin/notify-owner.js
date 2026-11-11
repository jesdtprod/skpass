// After an approval/rejection, ask the server to push the decision to the owner's devices.
// Fire-and-forget: the approval has already succeeded, so a failed notification must never
// get in the way (the owner will still see the new status on My QR).
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../config.js";
import { toast } from "./util.js";

export async function notifyDecision(ctx, vehicleId) {
  try {
    const { data: { session } } = await ctx.sb.auth.getSession();
    if (!session) return null;
    const res = await fetch(`${SUPABASE_URL}/functions/v1/notify-owner`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ vehicle_id: vehicleId }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.sent > 0) {
      toast(`Owner notified on ${data.sent} device${data.sent === 1 ? "" : "s"}.`);
    }
    return res.ok ? data : null;
  } catch {
    return null;
  }
}
