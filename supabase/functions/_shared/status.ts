// Builds the public view of a vehicle for its owner. Pure function (no I/O).

export interface VehicleRow {
  status: string;
  category: string;
  plate: string;
  owner_name: string;
  token: string | null;
  valid_from: string | null;
  valid_to: string | null;
  reject_reason: string | null;
}

export interface OwnerStatus {
  status: string;
  category: string;
  plate: string;
  owner_name: string;
  valid_from: string | null;
  valid_to: string | null;
  reject_reason?: string;
  token?: string;
  expired?: boolean;
  not_yet_valid?: boolean;
}

/** The QR token is revealed only for approved vehicles. Block reasons are never revealed. */
export function ownerStatus(v: VehicleRow, today: string): OwnerStatus {
  const out: OwnerStatus = {
    status: v.status,
    category: v.category,
    plate: v.plate,
    owner_name: v.owner_name,
    valid_from: v.valid_from,
    valid_to: v.valid_to,
  };
  if (v.status === "rejected" && v.reject_reason) out.reject_reason = v.reject_reason;
  if (v.status === "approved" && v.token) {
    out.token = v.token;
    if (v.valid_to && v.valid_to < today) out.expired = true;
    if (v.valid_from && v.valid_from > today) out.not_yet_valid = true;
  }
  return out;
}
