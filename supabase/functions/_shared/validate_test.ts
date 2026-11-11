import { assert, assertEquals } from "jsr:@std/assert@1";
import { clean, validatePhoto, validateRegistration } from "./validate.ts";

const TODAY = "2026-11-11";
const KEY = "01M7432Y65RRKTMPBNCPQWHG2C";

const base = {
  category: "employee",
  plate: "abc-123",
  owner_name: "Juan Dela Cruz",
  phone: "+63 917 000 0001",
  vehicle_type: "car",
  office: "Records",
  idempotency_key: KEY,
};

Deno.test("valid employee passes and plate is upper-cased", () => {
  const r = validateRegistration(base, TODAY);
  assert(r.ok);
  if (r.ok) {
    assertEquals(r.value.plate, "ABC-123");
    assertEquals(r.value.office, "Records");
  }
});

Deno.test("non-object body is rejected", () => {
  assertEquals(validateRegistration(null, TODAY).ok, false);
  assertEquals(validateRegistration("x", TODAY).ok, false);
});

Deno.test("bad category, plate, phone, type, key are all reported", () => {
  const r = validateRegistration(
    { category: "vip", plate: "!", owner_name: "J", phone: "12", vehicle_type: "boat" },
    TODAY,
  );
  assert(!r.ok);
  if (!r.ok) {
    for (
      const f of ["category", "plate", "owner_name", "phone", "vehicle_type", "idempotency_key"]
    ) {
      assert(f in r.errors, `missing error for ${f}`);
    }
  }
});

Deno.test("employee needs office; official needs position and agency", () => {
  const e = validateRegistration({ ...base, office: "" }, TODAY);
  assert(!e.ok && "office" in e.errors);
  const o = validateRegistration({ ...base, category: "official" }, TODAY);
  assert(!o.ok && "position" in o.errors && "agency" in o.errors);
});

Deno.test("visitor needs host, purpose and valid dates", () => {
  const v = validateRegistration({ ...base, category: "visitor" }, TODAY);
  assert(!v.ok);
  if (!v.ok) {
    for (const f of ["host_name", "purpose", "valid_from", "valid_to"]) assert(f in v.errors);
  }
});

Deno.test("visitor date rules: past, order, max length, valid range", () => {
  const vis = { ...base, category: "visitor", host_name: "Ana", purpose: "Meeting" };
  const past = validateRegistration(
    { ...vis, valid_from: "2026-11-10", valid_to: "2026-11-12" },
    TODAY,
  );
  assert(!past.ok && "valid_from" in past.errors);
  const order = validateRegistration(
    { ...vis, valid_from: "2026-11-15", valid_to: "2026-11-12" },
    TODAY,
  );
  assert(!order.ok && "valid_to" in order.errors);
  const long = validateRegistration(
    { ...vis, valid_from: "2026-11-11", valid_to: "2027-03-01" },
    TODAY,
    30,
  );
  assert(!long.ok && "valid_to" in long.errors);
  const bad = validateRegistration(
    { ...vis, valid_from: "2026-02-31", valid_to: "2026-03-01" },
    TODAY,
  );
  assert(!bad.ok && "valid_from" in bad.errors);
  const ok = validateRegistration(
    { ...vis, valid_from: "2026-11-11", valid_to: "2026-11-18" },
    TODAY,
  );
  assert(ok.ok);
});

Deno.test("clean strips control characters and collapses spaces", () => {
  assertEquals(clean("  a\u0000b \n  c  "), "a b c");
  assertEquals(clean(42), "");
});

Deno.test("photo validation", () => {
  assertEquals(validatePhoto("image/jpeg", 1000), null);
  assert(validatePhoto("image/gif", 1000) !== null);
  assert(validatePhoto("image/png", 0) !== null);
  assert(validatePhoto("image/webp", 3 * 1024 * 1024) !== null);
});

Deno.test("normPlate / normPhone match the database normalizers", async () => {
  const { normPlate, normPhone } = await import("./validate.ts");
  assertEquals(normPlate("abc-123 x"), "ABC123X");
  assertEquals(normPhone("+63 912-345 6789"), "639123456789");
});
