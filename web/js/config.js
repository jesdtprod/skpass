// Public configuration only. The repo is public: NEVER put the service-role key
// or the Turnstile secret here. The anon key and Turnstile site key are safe.
export const SUPABASE_URL = "https://eeruqrtzrssyzrkbojvy.supabase.co";
export const SUPABASE_ANON_KEY = ""; // TODO: paste the anon (public) key
export const TURNSTILE_SITE_KEY = "1x00000000000000000000AA"; // Cloudflare TEST key (always passes). Replace before go-live.
export const APP_NAME = "SKPass";
