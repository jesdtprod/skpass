// Keeps the owner's registrations in the browser (IndexedDB, with a localStorage fallback),
// so the QR can be reopened without logging in.
const DB_NAME = "skpass";
const STORE = "vehicles";
const LS_KEY = "skpass.vehicles";

function openDb() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error("no indexedDB"));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "vehicle_id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(mode, fn) {
  return openDb().then((db) =>
    new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const result = fn(t.objectStore(STORE));
      t.oncomplete = () => {
        db.close();
        resolve(result.result);
      };
      t.onerror = () => reject(t.error);
    })
  );
}

function lsRead() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function lsWrite(list) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
  } catch { /* storage unavailable */ }
}

/** Save or replace a registration { vehicle_id, claim_secret, plate, ... }. */
export async function saveVehicle(rec) {
  const record = { ...rec, saved_at: rec.saved_at ?? new Date().toISOString() };
  // Always mirror to localStorage too: some browsers purge one store but not the other.
  const list = lsRead().filter((v) => v.vehicle_id !== record.vehicle_id);
  lsWrite([...list, record]);
  try {
    await tx("readwrite", (s) => s.put(record));
  } catch { /* fallback copy already saved */ }
  return record;
}

export async function listVehicles() {
  let fromDb = [];
  try {
    fromDb = await tx("readonly", (s) => s.getAll());
  } catch { /* use fallback only */ }
  const byId = new Map(lsRead().map((v) => [v.vehicle_id, v]));
  for (const v of fromDb) byId.set(v.vehicle_id, v);
  return [...byId.values()].sort((a, b) => (a.saved_at < b.saved_at ? 1 : -1));
}

export async function updateVehicle(id, patch) {
  const all = await listVehicles();
  const cur = all.find((v) => v.vehicle_id === id);
  if (cur) await saveVehicle({ ...cur, ...patch });
}

export async function removeVehicle(id) {
  lsWrite(lsRead().filter((v) => v.vehicle_id !== id));
  try {
    await tx("readwrite", (s) => s.delete(id));
  } catch { /* ignore */ }
}
