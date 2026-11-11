// Cloudflare Turnstile helper. Loads the script only after the onload callback exists.
import { TURNSTILE_SITE_KEY } from "./config.js";

export function mountCaptcha(selector) {
  let widgetId = null;
  let token = "";
  globalThis.onTurnstileLoad = () => {
    widgetId = turnstile.render(selector, {
      sitekey: TURNSTILE_SITE_KEY,
      callback: (t) => token = t,
      "expired-callback": () => token = "",
      "error-callback": () => token = "",
    });
  };
  const s = document.createElement("script");
  s.src =
    "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad&render=explicit";
  s.async = true;
  document.head.append(s);
  return {
    getToken: () => token,
    reset() {
      token = "";
      if (widgetId !== null && globalThis.turnstile) turnstile.reset(widgetId);
    },
  };
}
