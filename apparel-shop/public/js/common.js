// Shared setup for every page: Firebase, the @thinkccig.com sign-in gate,
// the site header, the per-user cart, and small UI helpers.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signOut, connectAuthEmulator,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getFirestore, connectFirestoreEmulator, doc, getDoc,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import {
  getFunctions, connectFunctionsEmulator,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js";
import { firebaseConfig, ALLOWED_DOMAIN, USE_EMULATORS } from "./firebase-config.js";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app);

if (USE_EMULATORS) {
  connectAuthEmulator(auth, `http://${location.hostname}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, location.hostname, 8080);
  connectFunctionsEmulator(functions, location.hostname, 5001);
}

export const SIZES = ["S", "M", "L", "XL", "XXL"];
export const CATEGORIES = [
  { id: "mens", label: "Men's" },
  { id: "womens", label: "Women's" },
  { id: "unisex", label: "Unisex" },
];
export const categoryLabel = (id) => CATEGORIES.find((c) => c.id === id)?.label || id;

export function isCcigEmail(email) {
  return typeof email === "string" && email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`);
}

/**
 * Resolves with { user, email, isEditor } once a verified @thinkccig.com user is signed in.
 * Anyone else is sent to the sign-in page. Sign-in is remembered on this device.
 */
export function requireCcigUser() {
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user || !user.emailVerified || !isCcigEmail(user.email)) {
        if (user) await signOut(auth);
        const next = encodeURIComponent(location.pathname + location.hash);
        location.replace(`/login?next=${next}`);
        return;
      }
      unsubscribe();
      const email = user.email.toLowerCase();
      let isEditor = false;
      try {
        isEditor = (await getDoc(doc(db, "admins", email))).exists();
      } catch (e) {
        console.warn("Could not check editor access", e);
      }
      renderHeader(email);
      document.body.classList.remove("auth-pending");
      resolve({ user, email, isEditor });
    });
  });
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function renderHeader(email) {
  const header = document.querySelector("[data-site-header]");
  if (!header) return;
  const page = document.body.dataset.page;
  header.innerHTML = `
    <div class="header-inner">
      <a class="brand" href="/" aria-label="CCIG Apparel home">
        <img src="/assets/CCIG-Reverse-Horizontal-RGB.png" alt="CCIG" width="130" height="36">
        <span class="brand-divider" aria-hidden="true"></span>
        <span class="brand-label">Apparel</span>
      </a>
      <nav class="site-nav" aria-label="Main">
        <a href="/" ${page === "shop" ? 'aria-current="page"' : ""}>Apparel</a>
        <a href="/cart" ${page === "cart" ? 'aria-current="page"' : ""}>
          Cart <span class="cart-badge" data-cart-count>0</span>
        </a>
      </nav>
      <div class="user-menu">
        <span class="user-email" title="${escapeHtml(email)}">${escapeHtml(email)}</span>
        <button type="button" class="link-button" data-sign-out>Sign out</button>
      </div>
    </div>`;
  header.querySelector("[data-sign-out]").addEventListener("click", async () => {
    await signOut(auth);
    location.replace("/login");
  });
  updateCartBadge();
}

export function updateCartBadge() {
  const count = cart.count();
  document.querySelectorAll("[data-cart-count]").forEach((el) => {
    el.textContent = String(count);
    el.classList.toggle("is-empty", count === 0);
  });
}

// ---------------------------------------------------------------------------
// Cart — kept in this browser only, per signed-in email.
// ---------------------------------------------------------------------------

const cartKey = () => `ccig-apparel-cart:${auth.currentUser?.email?.toLowerCase() || "anon"}`;

function readCart() {
  try {
    const items = JSON.parse(localStorage.getItem(cartKey()) || "[]");
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function writeCart(items) {
  try {
    localStorage.setItem(cartKey(), JSON.stringify(items));
  } catch (e) {
    console.warn("Cart could not be saved", e);
  }
  updateCartBadge();
  window.dispatchEvent(new CustomEvent("cart-changed"));
}

export const cart = {
  items: readCart,
  count: () => readCart().reduce((n, i) => n + i.qty, 0),
  qtyFor: (productId, size) =>
    readCart().filter((i) => i.productId === productId && i.size === size).reduce((n, i) => n + i.qty, 0),
  add(productId, size, qty) {
    const items = readCart();
    const line = items.find((i) => i.productId === productId && i.size === size);
    if (line) line.qty += qty;
    else items.push({ productId, size, qty });
    writeCart(items);
  },
  setQty(productId, size, qty) {
    const items = readCart()
      .map((i) => (i.productId === productId && i.size === size ? { ...i, qty } : i))
      .filter((i) => i.qty > 0);
    writeCart(items);
  },
  remove(productId, size) {
    writeCart(readCart().filter((i) => !(i.productId === productId && i.size === size)));
  },
  clear: () => writeCart([]),
};

window.addEventListener("storage", (e) => {
  if (e.key === cartKey()) {
    updateCartBadge();
    window.dispatchEvent(new CustomEvent("cart-changed"));
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export const money = (n) => usd.format(Number(n) || 0);

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

let toastTimer;
export function toast(message, kind = "success") {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.dataset.kind = kind;
  el.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-visible"), 3200);
}
