// Vehicle detail panel + the admin actions on a vehicle (shared by Approvals and Vehicles).
import { downloadQr, drawQr } from "../qr.js";
import { ask, confirmBox, panel } from "./dialog.js";
import { notifyDecision } from "./notify-owner.js";
import { attempt, fmtTime, h, toast } from "./util.js";

export const COLS =
  "id,category,status,token,plate,owner_name,phone,vehicle_type,color,photo_path," +
  "valid_from,valid_to,office,id_number,position,agency,host_name,purpose,registered_via," +
  "reject_reason,blocked_reason,approved_at,created_at";

export const VEHICLE_TYPES = ["car", "suv", "van", "truck", "motorcycle", "tricycle", "other"]
  .map((t) => ({ value: t, label: t[0].toUpperCase() + t.slice(1) }));

export const statusBadge = (s) => h("span", { class: `st ${s}` }, s);

/** Approve: visitors need a date range, so ask for it; everyone else is one click. */
export async function approveVehicle(ctx, v) {
  let from = null, to = null;
  if (v.category !== "visitor") {
    const sure = await confirmBox({
      title: `Approve ${v.plate}?`,
      message:
        `${v.owner_name} will get a QR pass and be notified. You can still block the vehicle later.`,
      okText: "Approve",
    });
    if (!sure) return false;
  }
  if (v.category === "visitor") {
    const a = await ask({
      title: `Approve ${v.plate}`,
      intro: "Visitor passes are only valid inside this date range.",
      okText: "Approve",
      fields: [
        { name: "from", label: "Valid from", type: "date", required: true, value: v.valid_from },
        { name: "to", label: "Valid until", type: "date", required: true, value: v.valid_to },
      ],
    });
    if (!a) return false;
    from = a.from;
    to = a.to;
  }
  const r = await attempt(
    () => ctx.sb.rpc("approve_vehicle", { p_vehicle_id: v.id, p_valid_from: from, p_valid_to: to }),
    `${v.plate} approved. The QR is now available.`,
  );
  if (r) notifyDecision(ctx, v.id); // push the decision to the owner (not awaited)
  return !!r;
}

export async function rejectVehicle(ctx, v) {
  const a = await ask({
    title: `Reject ${v.plate}?`,
    intro: "Confirm the rejection. The owner will see this reason on their My QR page.",
    okText: "Reject",
    danger: true,
    fields: [{
      name: "reason",
      label: "Reason",
      type: "textarea",
      required: true,
      maxlength: 200,
      hint: "For example: plate not readable in the photo.",
    }],
  });
  if (!a) return false;
  const r = await attempt(
    () => ctx.sb.rpc("reject_vehicle", { p_vehicle_id: v.id, p_reason: a.reason }),
    `${v.plate} rejected.`,
  );
  if (r) notifyDecision(ctx, v.id); // push the decision to the owner (not awaited)
  return !!r;
}

function rows(v, tz) {
  const r = [
    ["Status", statusBadge(v.status)],
    ["Category", h("span", { class: "cat" }, v.category)],
    ["Owner", v.owner_name],
    ["Phone", v.phone],
    ["Vehicle", [v.vehicle_type, v.color].filter(Boolean).join(", ")],
  ];
  if (v.category === "employee") r.push(["Office", v.office], ["Employee ID", v.id_number]);
  if (v.category === "official") r.push(["Position", v.position], ["Agency", v.agency]);
  if (v.category === "visitor") r.push(["Visiting", v.host_name], ["Purpose", v.purpose]);
  if (v.valid_from || v.valid_to) {
    r.push(["Valid", `${v.valid_from ?? "…"} to ${v.valid_to ?? "…"}`]);
  }
  if (v.reject_reason) r.push(["Rejected because", v.reject_reason]);
  if (v.blocked_reason) r.push(["Blocked because", v.blocked_reason]);
  r.push(["Registered", `${fmtTime(v.created_at, tz)} (${v.registered_via})`]);
  if (v.approved_at) r.push(["Approved", fmtTime(v.approved_at, tz)]);
  return r.filter(([, val]) => val != null && val !== "");
}

export async function openVehicle(ctx, id, onChange) {
  const { data: v, error } = await ctx.sb.from("vehicles").select(COLS).eq("id", id).maybeSingle();
  if (error || !v) return toast("Could not load this vehicle.", "error");

  const body = h("div", { class: "detail" });
  const p = panel(v.plate, body);
  const done = (reopen = true) => {
    p.close();
    onChange?.();
    if (reopen) openVehicle(ctx, id, onChange);
  };

  const info = h("dl", { class: "kv" });
  for (const [k, val] of rows(v, ctx.tz)) info.append(h("dt", {}, k), h("dd", {}, val));
  const side = h("div");

  if (v.photo_path) {
    const img = h("img", { class: "photo", alt: "Vehicle photo", hidden: true });
    img.onerror = () => img.hidden = true;
    ctx.sb.storage.from("vehicle-photos").createSignedUrl(v.photo_path, 300).then(({ data }) => {
      if (data?.signedUrl) {
        img.src = data.signedUrl;
        img.hidden = false;
      }
    });
    side.append(img);
  }
  if (v.token && (v.status === "approved" || v.status === "blocked")) {
    const c = h("canvas", { "aria-label": `QR for ${v.plate}` });
    drawQr(c, v.token);
    side.append(
      h("p", { class: "muted small" }, "QR code"),
      c,
      h("button", {
        class: "btn ghost sm",
        type: "button",
        onclick: () => downloadQr(v.token, v.plate),
      }, "Download QR"),
    );
  }

  const act = h("div", { class: "detail-actions" });
  const btn = (label, fn, cls = "") =>
    act.append(h("button", { class: `btn ${cls}`, type: "button", onclick: fn }, label));

  if (v.status === "pending" || v.status === "rejected") {
    btn("Approve", async () => await approveVehicle(ctx, v) && done());
  }
  if (v.status === "pending") {
    btn("Reject", async () => await rejectVehicle(ctx, v) && done(), "danger");
  }
  if (v.status === "approved") {
    btn("Block", async () => {
      const a = await ask({
        title: `Block ${v.plate}`,
        okText: "Block",
        danger: true,
        fields: [{
          name: "reason",
          label: "Reason",
          type: "textarea",
          required: true,
          maxlength: 200,
        }],
      });
      if (
        a && await attempt(
          () => ctx.sb.rpc("block_vehicle", { p_vehicle_id: v.id, p_reason: a.reason }),
          "Vehicle blocked.",
        )
      ) done();
    }, "danger");
  }
  if (v.status === "blocked") {
    btn("Unblock", async () => {
      if (
        await attempt(
          () => ctx.sb.rpc("unblock_vehicle", { p_vehicle_id: v.id }),
          "Vehicle unblocked.",
        )
      ) done();
    });
  }
  if (v.token) {
    btn("Reissue QR", async () => {
      const ok = await confirmBox({
        title: "Reissue QR code",
        message:
          "A new QR is created and the old one stops working immediately. The owner can get the new one from My QR or Find my QR.",
        okText: "Reissue",
        danger: true,
      });
      if (
        ok &&
        await attempt(() => ctx.sb.rpc("reissue_token", { p_vehicle_id: v.id }), "New QR issued.")
      ) done();
    }, "ghost");
  }
  btn("Edit details", async () => {
    const a = await ask({
      title: `Edit ${v.plate}`,
      fields: [
        { name: "owner_name", label: "Owner", required: true, value: v.owner_name, maxlength: 100 },
        {
          name: "phone",
          label: "Phone",
          type: "tel",
          required: true,
          value: v.phone,
          maxlength: 20,
        },
        {
          name: "vehicle_type",
          label: "Vehicle type",
          type: "select",
          options: VEHICLE_TYPES,
          value: v.vehicle_type,
        },
        { name: "color", label: "Color", value: v.color ?? "", maxlength: 30 },
        {
          name: "valid_from",
          label: "Valid from",
          type: "date",
          value: v.valid_from ?? "",
          required: v.category === "visitor",
        },
        {
          name: "valid_to",
          label: "Valid until",
          type: "date",
          value: v.valid_to ?? "",
          required: v.category === "visitor",
        },
      ],
    });
    if (!a) return;
    const patch = {
      owner_name: a.owner_name.trim(),
      phone: a.phone.trim(),
      vehicle_type: a.vehicle_type,
      color: a.color.trim() || null,
      valid_from: a.valid_from || null,
      valid_to: a.valid_to || null,
    };
    if (await attempt(() => ctx.sb.from("vehicles").update(patch).eq("id", v.id), "Saved.")) done();
  }, "ghost");
  btn("Delete", async () => {
    const ok = await confirmBox({
      title: "Delete vehicle",
      message:
        `${v.plate} will be removed from all lists and its QR stops working. Its scan history is kept.`,
      okText: "Delete",
      danger: true,
    });
    if (
      ok &&
      await attempt(
        () => ctx.sb.rpc("soft_delete", { p_table: "vehicles", p_id: v.id }),
        "Vehicle deleted.",
      )
    ) {
      done(false);
    }
  }, "ghost danger-text");

  body.append(h("div", {}, info, act), side);
}
