// Cart page: line items, totals, "Who are these for?", payroll acknowledgement, checkout.
import { collection, onSnapshot } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js";
import {
  db, functions, requireCcigUser, cart, categoryLabel, money, escapeHtml,
} from "./common.js";
import { ORDER_CONTACT } from "./firebase-config.js";

const { email } = await requireCcigUser();

const list = document.getElementById("cart-list");
const totalItemsEl = document.getElementById("total-items");
const subtotalEl = document.getElementById("subtotal");
const form = document.getElementById("checkout-form");
const recipients = document.getElementById("recipients");
const recipientsError = document.getElementById("recipients-error");
const acknowledge = document.getElementById("acknowledge");
const checkoutButton = document.getElementById("checkout-button");
const checkoutHint = document.getElementById("checkout-hint");
const checkoutError = document.getElementById("checkout-error");

document.querySelectorAll("[data-order-contact]").forEach((a) => {
  a.href = `mailto:${ORDER_CONTACT}`;
  a.textContent = ORDER_CONTACT;
});

// "Who are these for?" is private to this person and this browser tab — it is never
// shared with other shoppers; it's only sent with the order at checkout.
const DRAFT_KEY = `ccig-apparel-recipients:${email}`;
try { recipients.value = sessionStorage.getItem(DRAFT_KEY) || ""; } catch { /* storage blocked */ }
recipients.addEventListener("input", () => {
  try { sessionStorage.setItem(DRAFT_KEY, recipients.value); } catch { /* storage blocked */ }
  if (recipients.value.trim()) setRecipientsError("");
  refreshCheckout();
});
acknowledge.addEventListener("change", refreshCheckout);

let products = null; // Map id -> product, null until loaded
let submitting = false;

onSnapshot(collection(db, "products"), (snap) => {
  products = new Map();
  snap.forEach((d) => products.set(d.id, { id: d.id, ...d.data() }));
  render();
}, (err) => {
  console.error(err);
  list.innerHTML = `<li class="empty-state">We couldn't load your cart. Please refresh the page.</li>`;
});
window.addEventListener("cart-changed", render);

const stockOf = (p, size) => Math.max(0, parseInt(p?.sizes?.[size], 10) || 0);

function lineProblem(line) {
  const p = products?.get(line.productId);
  if (!p || p.active === false) return "This item is no longer available. Please remove it.";
  const stock = stockOf(p, line.size);
  if (stock === 0) return `Size ${line.size} is now out of stock. Please remove it.`;
  if (line.qty > stock) return `Only ${stock} available in size ${line.size}. Please lower the quantity.`;
  return "";
}

function render() {
  if (!products) return;
  const items = cart.items();

  if (items.length === 0) {
    list.innerHTML = `
      <li class="empty-state">
        <p>Your cart is empty.</p>
        <a class="button button-primary" href="/">Browse apparel</a>
      </li>`;
  } else {
    list.innerHTML = items.map((line) => {
      const p = products.get(line.productId);
      const name = p?.name || "Unavailable item";
      const problem = lineProblem(line);
      const max = Math.max(1, stockOf(p, line.size));
      return `
        <li class="cart-line ${problem ? "has-problem" : ""}" data-product-id="${escapeHtml(line.productId)}" data-size="${escapeHtml(line.size)}">
          <img class="cart-thumb" src="${escapeHtml(p?.imageUrl || "/assets/products/tee.svg")}" alt="" width="88" height="88">
          <div class="cart-line-info">
            <p class="cart-line-category">${escapeHtml(categoryLabel(p?.category))}</p>
            <h3 class="cart-line-name">${escapeHtml(name)}</h3>
            <p class="cart-line-meta">Size <strong>${escapeHtml(line.size)}</strong> · ${money(p?.price)} each</p>
            ${problem ? `<p class="field-error">${escapeHtml(problem)}</p>` : ""}
          </div>
          <div class="cart-line-controls">
            <div class="stepper stepper-small">
              <button type="button" data-step="-1" aria-label="Decrease quantity of ${escapeHtml(name)} size ${escapeHtml(line.size)}">−</button>
              <input type="number" min="1" max="${max}" step="1" value="${line.qty}" inputmode="numeric"
                     aria-label="Quantity of ${escapeHtml(name)} size ${escapeHtml(line.size)}" data-line-qty>
              <button type="button" data-step="1" aria-label="Increase quantity of ${escapeHtml(name)} size ${escapeHtml(line.size)}">+</button>
            </div>
            <p class="cart-line-total">${money((p?.price || 0) * line.qty)}</p>
            <button type="button" class="link-button remove-button" data-remove>Remove</button>
          </div>
        </li>`;
    }).join("");
  }

  const totalItems = items.reduce((n, i) => n + i.qty, 0);
  const subtotal = items.reduce((n, i) => n + (products.get(i.productId)?.price || 0) * i.qty, 0);
  totalItemsEl.textContent = String(totalItems);
  subtotalEl.textContent = money(subtotal);
  refreshCheckout();
}

list.addEventListener("click", (e) => {
  const li = e.target.closest(".cart-line");
  if (!li) return;
  const { productId, size } = li.dataset;
  if (e.target.closest("[data-remove]")) {
    cart.remove(productId, size);
    return;
  }
  const step = e.target.closest("[data-step]");
  if (step) {
    const current = cart.items().find((i) => i.productId === productId && i.size === size)?.qty || 0;
    const stock = stockOf(products.get(productId), size);
    const next = Math.min(Math.max(1, current + Number(step.dataset.step)), Math.max(1, stock));
    cart.setQty(productId, size, next);
  }
});

list.addEventListener("change", (e) => {
  if (!e.target.matches("[data-line-qty]")) return;
  const li = e.target.closest(".cart-line");
  const n = parseInt(e.target.value, 10);
  if (!n || n < 1) cart.remove(li.dataset.productId, li.dataset.size);
  else cart.setQty(li.dataset.productId, li.dataset.size, n);
});

function refreshCheckout() {
  const items = cart.items();
  const hasProblems = !products || items.some((l) => lineProblem(l));
  const ready = items.length > 0 && !hasProblems && recipients.value.trim() !== "" && acknowledge.checked;
  checkoutButton.disabled = !ready || submitting;

  if (items.length === 0) checkoutHint.textContent = "Your cart is empty.";
  else if (hasProblems) checkoutHint.textContent = "Fix the items marked above to continue.";
  else if (!recipients.value.trim()) checkoutHint.textContent = 'Answer "Who are these for?" to continue.';
  else if (!acknowledge.checked) checkoutHint.textContent = "Check the payroll acknowledgement box to continue.";
  else checkoutHint.textContent = "";
  checkoutHint.hidden = checkoutHint.textContent === "";
}

function setRecipientsError(message) {
  recipientsError.textContent = message;
  recipientsError.hidden = !message;
  recipients.setAttribute("aria-invalid", message ? "true" : "false");
}

const placeOrder = httpsCallable(functions, "placeOrder");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  checkoutError.hidden = true;
  if (!recipients.value.trim()) {
    setRecipientsError('Please tell us who these are for.');
    recipients.focus();
    return;
  }
  if (!acknowledge.checked) {
    acknowledge.focus();
    return;
  }

  submitting = true;
  refreshCheckout();
  checkoutButton.textContent = "Placing order…";
  try {
    const { data } = await placeOrder({
      items: cart.items().map(({ productId, size, qty }) => ({ productId, size, qty })),
      recipients: recipients.value.trim(),
      acknowledged: true,
    });
    cart.clear();
    try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* storage blocked */ }
    showConfirmation(data);
  } catch (err) {
    console.error(err);
    checkoutError.textContent = err?.message && err.code !== "functions/internal"
      ? err.message
      : "Something went wrong placing your order. Please try again.";
    checkoutError.hidden = false;
  } finally {
    submitting = false;
    checkoutButton.textContent = "Check out";
    refreshCheckout();
  }
});

function showConfirmation(data) {
  document.getElementById("cart-view").hidden = true;
  document.getElementById("order-number").textContent = data.orderNumber;
  document.getElementById("confirmation-email").textContent = email;
  if (data.emailStatus !== "sent") {
    document.getElementById("confirmation-email-note").textContent =
      `Your order was saved, but the confirmation email may be delayed. Your order number is ${data.orderNumber}.`;
  }
  const section = document.getElementById("confirmation");
  section.hidden = false;
  section.focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
