// Validation for staff account requests (admin only). Pure functions.

export type StaffRole = "admin" | "guard";

export interface CreateStaff {
  email: string;
  full_name: string;
  role: StaffRole;
  password: string;
}

export function validatePassword(p: unknown): string | null {
  if (typeof p !== "string" || p.length < 10) return "Password must be at least 10 characters.";
  if (p.length > 72) return "Password must be at most 72 characters.";
  if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) return "Password needs letters and numbers.";
  return null;
}

export function validateCreateStaff(
  raw: unknown,
): { ok: true; value: CreateStaff } | { ok: false; error: string } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const email = typeof r.email === "string" ? r.email.trim().toLowerCase() : "";
  if (!/^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }
  const full_name = typeof r.full_name === "string" ? r.full_name.replace(/\s+/g, " ").trim() : "";
  if (full_name.length < 2 || full_name.length > 100) {
    return { ok: false, error: "Enter the person's full name." };
  }
  if (r.role !== "admin" && r.role !== "guard") {
    return { ok: false, error: "Role must be admin or guard." };
  }
  const pwErr = validatePassword(r.password);
  if (pwErr) return { ok: false, error: pwErr };
  return { ok: true, value: { email, full_name, role: r.role, password: r.password as string } };
}
