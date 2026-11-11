// Public configuration only. The repo is public: NEVER put the service-role key
// or the Turnstile secret here. The anon key and Turnstile site key are safe.
export const SUPABASE_URL = "https://eeruqrtzrssyzrkbojvy.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable__QARX5TLXHqdfDauHvUDxA_86_VAzIy"; // publishable (public) key
export const TURNSTILE_SITE_KEY = "0x4AAAAAAF8LJqY8gj4FL4Dr";
export const APP_NAME = "SKPass";
// Web Push (public half of the VAPID key pair; the private half is a Supabase secret).
export const VAPID_PUBLIC_KEY =
  "BCgqP2YtHyzo3Iwf5JfTZchDSs2wGXWEVv9UUXQhtUzCRknB12z1FkLp3Q4MBu7gllCe3OpFLEATX68Hb7xdzjk";
