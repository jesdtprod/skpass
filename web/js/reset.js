// "Set a new password" page. Reached from the recovery email link (the Auth server appends the
// recovery session to the URL hash, which supabase-js consumes) or by a signed-in user.
import { sb } from "./auth.js";

const $ = (id) => document.getElementById(id);
const form = $("reset-form");
const alertBox = $("alert");
const btn = $("submit");

function show(msg, kind = "error") {
  alertBox.textContent = msg;
  alertBox.className = `alert ${kind}`;
  alertBox.hidden = !msg;
}

/** Same rule the server enforces for staff passwords. */
export function passwordProblem(p, confirm) {
  if (typeof p !== "string" || p.length < 10) return "Use at least 10 characters.";
  if (p.length > 72) return "Use at most 72 characters.";
  if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) return "Use both letters and numbers.";
  if (p !== confirm) return "The two passwords do not match.";
  return null;
}

// supabase-js has parsed #access_token=... by the time getSession resolves.
const { data: { session } } = await sb.auth.getSession();
// Never leave the one-time token sitting in the address bar / history.
if (location.hash) history.replaceState(null, "", location.pathname + location.search);

if (!session) {
  form.hidden = true;
  $("invalid").hidden = false;
} else {
  form.hidden = false;
  $("who").textContent = session.user.email ?? "";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  show("");
  const problem = passwordProblem(form.password.value, form.confirm.value);
  if (problem) return show(problem);
  btn.disabled = true;
  btn.textContent = "Saving…";
  try {
    const { error } = await sb.auth.updateUser({ password: form.password.value });
    if (error) {
      show(
        /same|different/i.test(error.message)
          ? "Choose a password you have not used before."
          : /fetch|network/i.test(error.message)
          ? "No connection. Check your internet and try again."
          : /weak|pwned|easy/i.test(error.message)
          ? "That password is too easy to guess. Try a longer one."
          : "Could not update the password. The link may have expired; request a new one.",
      );
      return;
    }
    form.hidden = true;
    $("done").hidden = false;
    setTimeout(() => location.replace("../login/"), 1800);
  } finally {
    btn.disabled = false;
    btn.textContent = "Save new password";
  }
});
