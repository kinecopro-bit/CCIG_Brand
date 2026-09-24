// Passwordless sign-in: we email a one-time link to the @thinkccig.com address.
// Clicking it proves the person owns that mailbox; the session is then remembered on this device.
import {
  onAuthStateChanged, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, signOut,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { auth, isCcigEmail } from "./common.js";
import { ALLOWED_DOMAIN, USE_EMULATORS } from "./firebase-config.js";

const EMAIL_KEY = "ccig-apparel-signin-email";
const params = new URLSearchParams(location.search);
const rawNext = params.get("next") || "/";
const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

const form = document.getElementById("signin-form");
const input = document.getElementById("email");
const button = document.getElementById("signin-button");
const error = document.getElementById("signin-error");
const stepEmail = document.getElementById("step-email");
const stepSent = document.getElementById("step-sent");
const sentTo = document.getElementById("sent-to");
const heading = document.getElementById("signin-heading");

function showError(message) {
  error.textContent = message;
  error.hidden = !message;
  input.setAttribute("aria-invalid", message ? "true" : "false");
}

function storedEmail() {
  try { return localStorage.getItem(EMAIL_KEY) || ""; } catch { return ""; }
}

function rememberEmail(email) {
  try { localStorage.setItem(EMAIL_KEY, email); } catch { /* private mode */ }
}

async function completeLinkSignIn(email) {
  button.disabled = true;
  button.textContent = "Signing in…";
  try {
    await signInWithEmailLink(auth, email, location.href);
    rememberEmail(email);
    location.replace(next);
  } catch (e) {
    console.error(e);
    button.disabled = false;
    button.textContent = "Continue";
    showError(e.code === "auth/invalid-email"
      ? "That email doesn't match the one the link was sent to."
      : "This sign-in link is invalid or has expired. Enter your email to get a new one.");
    history.replaceState(null, "", `/login?next=${encodeURIComponent(next)}`);
  }
}

const arrivedFromLink = isSignInWithEmailLink(auth, location.href);

if (arrivedFromLink) {
  const email = storedEmail();
  if (email) {
    heading.textContent = "Signing you in…";
    completeLinkSignIn(email);
  } else {
    // Link opened on a different device/browser: ask for the email to confirm.
    heading.textContent = "Confirm your email";
    button.textContent = "Continue";
  }
} else {
  input.value = storedEmail();
  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    if (user.emailVerified && isCcigEmail(user.email)) location.replace(next);
    else await signOut(auth);
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = input.value.trim().toLowerCase();
  showError("");
  if (!isCcigEmail(email) || !/^[^\s@]+@[^\s@]+$/.test(email)) {
    showError(`Please use your @${ALLOWED_DOMAIN} email address.`);
    input.focus();
    return;
  }

  if (arrivedFromLink) {
    completeLinkSignIn(email);
    return;
  }

  button.disabled = true;
  button.textContent = "Sending…";
  try {
    await sendSignInLinkToEmail(auth, email, {
      url: `${location.origin}/login?next=${encodeURIComponent(next)}`,
      handleCodeInApp: true,
    });
    rememberEmail(email);
    sentTo.textContent = email;
    stepEmail.hidden = true;
    stepSent.hidden = false;
    if (USE_EMULATORS) {
      document.getElementById("emulator-hint").hidden = false;
    }
  } catch (e) {
    console.error(e);
    showError("We couldn't send the sign-in link. Please try again in a moment.");
  } finally {
    button.disabled = false;
    button.textContent = "Email me a sign-in link";
  }
});

document.getElementById("use-different-email").addEventListener("click", () => {
  stepSent.hidden = true;
  stepEmail.hidden = false;
  input.focus();
});
