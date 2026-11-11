// Staff authentication (Supabase Auth) + role guard. Requires vendor/supabase.js loaded first.
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config.js";

export const sb = globalThis.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "skpass.auth" },
});

// Where each role lands after login.
export const HOME = { guard: "../scan/", admin: "../admin/" };

const PROFILE_KEY = "skpass.profile";
const AUTH_KEY = "skpass.auth";

/** A failed fetch (no signal, DNS, timeout), as opposed to the server answering "no". */
export function isNetworkFailure(err) {
  if (!err) return false;
  return err.status === 0 || err.name === "AuthRetryableFetchError" ||
    (!err.code && /fetch|network|load failed|abort|timed? ?out/i.test(err.message ?? ""));
}

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}
function cacheProfile(p) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ ...p, cached_at: Date.now() }));
  } catch { /* storage unavailable */ }
}
function cachedProfile(id) {
  const p = readJson(PROFILE_KEY);
  return p?.id === id ? p : null;
}

/** { profile, networkError }. Caches a good answer so the scanner can start offline later. */
export async function fetchProfile(userId) {
  const { data, error } = await sb.from("profiles").select("id, full_name, role, active")
    .eq("id", userId).maybeSingle();
  if (error) return { profile: null, networkError: isNetworkFailure(error) };
  if (data) cacheProfile(data);
  return { profile: data ?? null, networkError: false };
}

export async function myProfile(userId) {
  return (await fetchProfile(userId)).profile;
}

function offlineWall() {
  document.body.innerHTML =
    '<main style="font-family:system-ui,sans-serif;max-width:420px;margin:15vh auto;padding:0 20px;text-align:center">' +
    "<h1>You are offline</h1><p>This page needs a connection. Reconnect and reload.</p>" +
    '<p><a href="../">Back to home</a></p></main>';
  return new Promise(() => {});
}

/**
 * Returns { user, profile, offline } or redirects to the login page.
 * With { allowOffline: true } (the scanner) a stored session and cached profile are trusted when
 * the network is down, so guards can keep scanning. This only decides which page to show: the
 * database enforces the real permissions on every request.
 */
export async function requireStaff(roles = ["guard", "admin"], { allowOffline = false } = {}) {
  let session = null;
  let sessionError = null;
  try {
    const r = await sb.auth.getSession();
    session = r.data.session;
    sessionError = r.error;
  } catch (e) {
    sessionError = e;
  }

  let user = session?.user ?? null;
  let offline = false;
  if (!user) {
    const stored = readJson(AUTH_KEY)?.user ?? null;
    if (stored && (!navigator.onLine || isNetworkFailure(sessionError))) {
      if (!allowOffline) return offlineWall();
      user = stored;
      offline = true;
    } else {
      return goLogin();
    }
  }

  let profile = null;
  if (!offline) {
    const r = await fetchProfile(user.id);
    profile = r.profile;
    if (r.networkError) {
      profile = cachedProfile(user.id);
      if (!allowOffline || !profile) return offlineWall();
      offline = true;
    }
  } else {
    profile = cachedProfile(user.id);
    if (!profile) return offlineWall();
  }

  if (!profile || !profile.active || !HOME[profile.role]) {
    await sb.auth.signOut();
    return goLogin("noaccess");
  }
  if (!roles.includes(profile.role)) {
    // Valid staff member on the wrong page (e.g. a guard opening /admin/): send them home.
    location.replace(HOME[profile.role]);
    return new Promise(() => {});
  }
  return { user, profile, offline };
}

export function goLogin(reason) {
  const q = reason ? `?r=${reason}` : "";
  location.replace(`../login/${q}`);
  return new Promise(() => {}); // never resolves; the page is navigating away
}

export async function signOut() {
  await sb.auth.signOut();
  try {
    localStorage.removeItem(PROFILE_KEY);
  } catch { /* ignore */ }
  location.replace("../login/");
}
