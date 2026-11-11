// Thin client for the public Edge Functions. Never throws: returns { status, data }.
import { SUPABASE_URL } from "./config.js";

const BASE = `${SUPABASE_URL}/functions/v1`;

async function call(name, init) {
  try {
    const res = await fetch(`${BASE}/${name}`, { method: "POST", ...init });
    let data = {};
    try {
      data = await res.json();
    } catch { /* non-JSON error body */ }
    return { status: res.status, data };
  } catch {
    return { status: 0, data: { error: "network" } };
  }
}

export const registerVehicle = (formData) => call("register-vehicle", { body: formData });

export const myStatus = (vehicleId, claimSecret) =>
  call("my-status", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vehicle_id: vehicleId, claim_secret: claimSecret }),
  });
