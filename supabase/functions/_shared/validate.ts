// Server-side validation for public vehicle registration. Pure functions, no I/O.

export const VEHICLE_TYPES = [
  "car",
  "suv",
  "van",
  "truck",
  "motorcycle",
  "tricycle",
  "other",
] as const;

export const CATEGORIES = ["employee", "official", "visitor"] as const;

export type Category = typeof CATEGORIES[number];

export interface RegistrationInput {
  category: Category;
  plate: string;
  owner_name: string;
  phone: string;
  vehicle_type: string;
  color: string | null;
  office: string | null;
  id_number: string | null;
  position: string | null;
  agency: string | null;
  host_name: string | null;
  purpose: string | null;
  valid_from: string | null;
  valid_to: string | null;
  idempotency_key: string;
}

export type ValidationResult =
  | { ok: true; value: RegistrationInput }
  | { ok: false; errors: Record<string, string> };

// deno-lint-ignore no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/** Trim, collapse whitespace and strip control characters. */
export function clean(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
}

function optional(v: unknown, max: number): string | null {
  const s = clean(v);
  return s === "" ? null : s.slice(0, max);
}

function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000,
  );
}

/**
 * @param raw   untrusted JSON body
 * @param today ISO date (YYYY-MM-DD) used for visitor date checks
 * @param visitorMaxDays maximum visitor pass length in days
 */
export function validateRegistration(
  raw: unknown,
  today: string,
  visitorMaxDays = 30,
): ValidationResult {
  const errors: Record<string, string> = {};
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const category = clean(r.category) as Category;
  if (!CATEGORIES.includes(category)) errors.category = "Choose employee, official or visitor.";

  const plate = clean(r.plate).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9 -]{1,14}$/.test(plate)) {
    errors.plate = "Enter a valid plate number (letters, numbers, dash, space).";
  }

  const owner_name = clean(r.owner_name);
  if (owner_name.length < 2 || owner_name.length > 100) {
    errors.owner_name = "Enter the owner's full name.";
  }

  const phone = clean(r.phone);
  const digits = phone.replace(/\D/g, "");
  if (!/^[0-9+()\- ]+$/.test(phone) || digits.length < 7 || digits.length > 15) {
    errors.phone = "Enter a valid phone number.";
  }

  const vehicle_type = clean(r.vehicle_type).toLowerCase();
  if (!(VEHICLE_TYPES as readonly string[]).includes(vehicle_type)) {
    errors.vehicle_type = "Choose a vehicle type.";
  }

  const idempotency_key = clean(r.idempotency_key);
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(idempotency_key)) {
    errors.idempotency_key = "Missing or invalid request key.";
  }

  const value: RegistrationInput = {
    category,
    plate,
    owner_name,
    phone,
    vehicle_type,
    color: optional(r.color, 30),
    office: null,
    id_number: null,
    position: null,
    agency: null,
    host_name: null,
    purpose: null,
    valid_from: null,
    valid_to: null,
    idempotency_key,
  };

  if (category === "employee") {
    value.office = optional(r.office, 100);
    value.id_number = optional(r.id_number, 40);
    if (!value.office) errors.office = "Enter your office.";
  } else if (category === "official") {
    value.position = optional(r.position, 100);
    value.agency = optional(r.agency, 100);
    if (!value.position) errors.position = "Enter your position.";
    if (!value.agency) errors.agency = "Enter your agency.";
  } else if (category === "visitor") {
    value.host_name = optional(r.host_name, 100);
    value.purpose = optional(r.purpose, 200);
    if (!value.host_name) errors.host_name = "Enter who you are visiting.";
    if (!value.purpose) errors.purpose = "Enter the purpose of your visit.";

    const from = clean(r.valid_from);
    const to = clean(r.valid_to);
    if (!isIsoDate(from)) errors.valid_from = "Enter a valid start date.";
    if (!isIsoDate(to)) errors.valid_to = "Enter a valid end date.";
    if (isIsoDate(from) && isIsoDate(to)) {
      if (from < today) errors.valid_from = "Start date cannot be in the past.";
      else if (to < from) errors.valid_to = "End date must be on or after the start date.";
      else if (daysBetween(from, to) > visitorMaxDays) {
        errors.valid_to = `Visits can last at most ${visitorMaxDays} days.`;
      }
      value.valid_from = from;
      value.valid_to = to;
    }
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value };
}

/** Same normalization as the database's norm_plate / norm_phone. */
export function normPlate(p: string): string {
  return p.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}
export function normPhone(p: string): string {
  const d = p.replace(/[^0-9]/g, "");
  if (/^63[0-9]{10}$/.test(d)) return d.slice(2); // +63 912 345 6789
  if (/^0[0-9]{10}$/.test(d)) return d.slice(1); // 0912 345 6789
  return d;
}

/** Photo rules shared by the function and tests. */
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
export const PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Detect the real image type from magic bytes (never trust the client's Content-Type). */
export function sniffImageType(b: Uint8Array): string | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (
    b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) return "image/png";
  if (
    b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) return "image/webp";
  return null;
}

export function validatePhoto(type: string, size: number): string | null {
  if (!(type in PHOTO_TYPES)) return "Photo must be a JPG, PNG or WebP image.";
  if (size <= 0) return "Photo is empty.";
  if (size > PHOTO_MAX_BYTES) return "Photo must be 2 MB or smaller.";
  return null;
}
