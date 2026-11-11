import { HOME, myProfile, sb } from "./auth.js";

const form = document.getElementById("login-form");
const alertBox = document.getElementById("alert");
const btn = document.getElementById("submit");

function show(msg, kind = "error") {
  alertBox.textContent = msg;
  alertBox.className = `alert ${kind}`;
  alertBox.hidden = !msg;
}

const reason = new URLSearchParams(location.search).get("r");
if (reason === "noaccess") show("This account does not have access to staff pages.");

// Already signed in with a valid staff profile? Go straight in.
sb.auth.getSession().then(async ({ data: { session } }) => {
  if (!session) return;
  const p = await myProfile(session.user.id);
  if (p?.active && HOME[p.role]) location.replace(HOME[p.role]);
});

// "Forgot key?": email a password-reset link that lands on the /reset/ page.
document.getElementById("forgot")?.addEventListener("click", async (e) => {
  e.preventDefault();
  const email = form.email.value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return show("Enter your email above first, then choose “Forgot key?” again.");
  }
  const redirectTo = new URL("../reset/", location.href).href;
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
  // Same answer whether or not the account exists, so this cannot be used to probe for accounts.
  show(
    error && /fetch|network/i.test(error.message)
      ? "No connection. Check your internet and try again."
      : error && /rate|seconds|too many/i.test(error.message)
      ? "Please wait a minute before asking for another link."
      : "If that email belongs to a staff account, a reset link is on its way. Check your inbox.",
    error && /fetch|network|rate|seconds|too many/i.test(error.message) ? "error" : "info",
  );
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  show("");
  btn.disabled = true;
  btn.textContent = "Signing in…";
  try {
    const { data, error } = await sb.auth.signInWithPassword({
      email: form.email.value.trim(),
      password: form.password.value,
    });
    if (error) {
      // Same message for unknown user and wrong password.
      show(
        error.status === 0 || /fetch|network/i.test(error.message)
          ? "No connection. Check your internet and try again."
          : "Wrong email or password.",
      );
      return;
    }
    const p = await myProfile(data.user.id);
    if (!p || !p.active || !HOME[p.role]) {
      await sb.auth.signOut();
      show("This account does not have access to staff pages.");
      return;
    }
    location.replace(HOME[p.role]);
  } finally {
    btn.disabled = false;
    btn.textContent = "Sign in";
  }
});
