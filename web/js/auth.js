// Staff authentication (Supabase Auth) + role guard. Requires vendor/supabase.js loaded first.
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config.js";

export const sb = globalThis.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "skpass.auth" },
});

// Where each role lands after login. (Admin dashboard arrives in phase E6.)
export const HOME = { guard: "../scan/", admin: "../scan/" };

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
  if (!profile || !profile.active || !roles.includes(profile.role)) {
    await sb.auth.signOut();
    return goLogin("noaccess");
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
