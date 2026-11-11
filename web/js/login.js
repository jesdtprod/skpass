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
