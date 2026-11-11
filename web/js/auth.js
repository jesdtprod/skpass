// Staff authentication (Supabase Auth) + role guard. Requires vendor/supabase.js loaded first.
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config.js";

export const sb = globalThis.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "skpass.auth" },
});

// Where each role lands after login.
export const HOME = { guard: "../scan/", admin: "../admin/" };

export async function myProfile(userId) {
  const { data } = await sb.from("profiles").select("id, full_name, role, active")
    .eq("id", userId).maybeSingle();
  return data ?? null;
}

/** Returns { user, profile } or redirects to the login page. */
export async function requireStaff(roles = ["guard", "admin"]) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return goLogin();
  const profile = await myProfile(session.user.id);
  if (!profile || !profile.active || !HOME[profile.role]) {
    await sb.auth.signOut();
    return goLogin("noaccess");
  }
  if (!roles.includes(profile.role)) {
    // Valid staff member on the wrong page (e.g. a guard opening /admin/): send them home.
    location.replace(HOME[profile.role]);
    return new Promise(() => {});
  }
  return { user: session.user, profile };
}

export function goLogin(reason) {
  const q = reason ? `?r=${reason}` : "";
  location.replace(`../login/${q}`);
  return new Promise(() => {}); // never resolves; the page is navigating away
}

export async function signOut() {
  await sb.auth.signOut();
  location.replace("../login/");
}
