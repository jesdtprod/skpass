import { assert, assertEquals } from "jsr:@std/assert@1";
import { validateCreateStaff, validatePassword } from "./staff.ts";

const good = {
  email: "Guard@Example.com ",
  full_name: "  Ana  Cruz ",
  role: "guard",
  password: "abcdefgh12",
};

Deno.test("valid request is normalised", () => {
  const r = validateCreateStaff(good);
  assert(r.ok);
  if (r.ok) {
    assertEquals(r.value.email, "guard@example.com");
    assertEquals(r.value.full_name, "Ana Cruz");
  }
});

Deno.test("rejects bad email, name, role", () => {
  assert(!validateCreateStaff({ ...good, email: "nope" }).ok);
  assert(!validateCreateStaff({ ...good, email: "a b@c.com" }).ok);
  assert(!validateCreateStaff({ ...good, full_name: "A" }).ok);
  assert(!validateCreateStaff({ ...good, role: "superuser" }).ok);
  assert(!validateCreateStaff(null).ok);
});

Deno.test("password rules", () => {
  assertEquals(validatePassword("abcdefgh12"), null);
  assert(validatePassword("short1") !== null);
  assert(validatePassword("onlyletterslong") !== null);
  assert(validatePassword("1234567890123") !== null);
  assert(validatePassword("a1".repeat(40)) !== null);
  assert(validatePassword(undefined) !== null);
});
