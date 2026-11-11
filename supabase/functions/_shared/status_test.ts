import { assert, assertEquals } from "jsr:@std/assert@1";
import { ownerStatus, type VehicleRow } from "./status.ts";

const base: VehicleRow = {
  status: "approved",
  category: "employee",
  plate: "ABC-123",
  owner_name: "Juan",
  token: "tok123",
  valid_from: null,
  valid_to: null,
  reject_reason: null,
};
const TODAY = "2026-11-11";

Deno.test("owner receives vehicle and registration details while pending without a token", () => {
  const details = {
    vehicle_type: "suv",
    color: "Silver",
    office: "Treasury",
    position: null,
    agency: null,
    host_name: null,
    purpose: null,
    created_at: "2026-11-11T02:00:00Z",
  };
  const result = ownerStatus({ ...base, ...details, status: "pending" }, TODAY);
  for (const [key, value] of Object.entries(details)) {
    assertEquals(result[key as keyof typeof result], value);
  }
  assert(!("token" in result));
});

Deno.test("approved vehicle exposes its token", () => {
  assertEquals(ownerStatus(base, TODAY).token, "tok123");
});

Deno.test("pending vehicle never exposes a token", () => {
  const s = ownerStatus({ ...base, status: "pending", token: "leak" }, TODAY);
  assert(!("token" in s));
});

Deno.test("blocked vehicle hides token and block reason", () => {
  const s = ownerStatus({ ...base, status: "blocked" }, TODAY);
  assert(!("token" in s) && !("reject_reason" in s));
  assertEquals(s.status, "blocked");
});

Deno.test("rejected vehicle shows the reason, no token", () => {
  const s = ownerStatus(
    { ...base, status: "rejected", token: null, reject_reason: "Bad plate" },
    TODAY,
  );
  assertEquals(s.reject_reason, "Bad plate");
  assert(!("token" in s));
});

Deno.test("visitor validity flags", () => {
  assertEquals(ownerStatus({ ...base, valid_to: "2026-11-10" }, TODAY).expired, true);
  assertEquals(ownerStatus({ ...base, valid_from: "2026-11-12" }, TODAY).not_yet_valid, true);
  const ok = ownerStatus({ ...base, valid_from: "2026-11-11", valid_to: "2026-11-18" }, TODAY);
  assert(!ok.expired && !ok.not_yet_valid);
});
