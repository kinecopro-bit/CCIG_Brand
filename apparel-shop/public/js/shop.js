// Apparel page: Men's / Women's / Unisex tabs, live size quantities and prices,
// add-to-cart, and in-place editing of quantities/prices for editors.
import {
  collection, doc, onSnapshot, updateDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import {
  db, requireCcigUser, cart, SIZES, CATEGORIES, money, toast, updateCartBadge,
} from "./common.js";

const { email, isEditor } = await requireCcigUser();

const products = new Map(); // id -> product data
const cards = new Map(); // id -> card element
const dirty = new Set(); // product ids with unsaved editor changes

document.getElementById("editor-banner").hidden = !isEditor;
setupTabs();
setupFloatingCart();

onSnapshot(collection(db, "products"), (snap) => {
  products.clear();
  snap.forEach((d) => {
    const p = d.data();
    if (p.active !== false) products.set(d.id, { id: d.id, ...p });
  });
  renderGrids();
}, (err) => {
  console.error(err);
  document.querySelectorAll("[data-grid]").forEach((g) => {
    g.innerHTML = `<p class="empty-state">We couldn't load apparel right now. Please refresh the page.</p>`;
  });
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderGrids() {
  for (const { id: category } of CATEGORIES) {
    const grid = document.querySelector(`[data-grid="${category}"]`);
    const list = [...products.values()]
      .filter((p) => p.category === category)
      .sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99) || a.name.localeCompare(b.name));

    grid.querySelector(".loading, .empty-state")?.remove();
    const wanted = new Set(list.map((p) => p.id));
    grid.querySelectorAll("[data-product-id]").forEach((el) => {
      if (!wanted.has(el.dataset.productId)) {
        cards.delete(el.dataset.productId);
        el.remove();
      }
    });

    list.forEach((p) => {
      let card = cards.get(p.id);
      if (!card) {
        card = createCard(p);
        cards.set(p.id, card);
      }
      grid.appendChild(card); // keeps sort order
      updateCard(card, p);
    });

    if (list.length === 0) {
      grid.insertAdjacentHTML("beforeend", `<p class="empty-state">No items here yet — check back soon.</p>`);
    }
  }
}

function createCard(p) {
  const card = document.createElement("article");
  card.className = "product-card";
  card.dataset.productId = p.id;
  const group = `size-${p.id}`;

  const sizeRows = SIZES.map((size) => `
    <div class="size-row" data-size-row="${size}">
      <label class="size-choice">
        <input type="radio" name="${group}" value="${size}">
        <span class="size-name">${size}</span>
      </label>
      ${isEditor
        ? `<input class="stock-input" type="number" min="0" step="1" inputmode="numeric"
             data-stock="${size}" aria-label="${size} quantity available">`
        : `<output class="stock-value" data-stock="${size}" aria-label="${size} quantity available"></output>`}
    </div>`).join("");

  card.innerHTML = `
    <div class="product-media"><img alt="" loading="lazy" data-image></div>
    <div class="product-body">
      <h3 class="product-name" data-name></h3>
      <p class="product-desc" data-desc></p>

      <fieldset class="size-list">
        <legend>Sizes available</legend>
        <div class="size-list-head" aria-hidden="true"><span>Size</span><span>Qty available</span></div>
        ${sizeRows}
      </fieldset>

      <div class="price-block">
        ${isEditor
          ? `<label class="field-label" for="price-${p.id}">Price (USD)</label>
             <div class="money-input"><span aria-hidden="true">$</span>
               <input id="price-${p.id}" type="number" min="0" step="0.01" inputmode="decimal" data-price-input>
             </div>`
          : `<span class="price-label">Price</span><span class="price" data-price></span>`}
      </div>

      ${isEditor ? `
      <div class="editor-actions">
        <button type="button" class="button button-secondary" data-save disabled>Save changes</button>
        <span class="save-state" data-save-state aria-live="polite"></span>
      </div>` : ""}

      <div class="purchase">
        <div class="purchase-row">
          <div>
            <label class="field-label" for="qty-${p.id}">Quantity</label>
            <div class="stepper">
              <button type="button" data-step="-1" aria-label="Decrease quantity">−</button>
              <input id="qty-${p.id}" type="number" min="1" step="1" value="1" inputmode="numeric" data-qty>
              <button type="button" data-step="1" aria-label="Increase quantity">+</button>
            </div>
          </div>
          <button type="button" class="button button-primary add-button" data-add>Add to cart</button>
        </div>
        <p class="purchase-hint" data-hint aria-live="polite"></p>
      </div>
    </div>`;

  card.addEventListener("change", (e) => {
    if (e.target.matches('input[type="radio"]')) refreshPurchase(card);
  });
  card.querySelector("[data-qty]").addEventListener("input", () => refreshPurchase(card, false));
  card.querySelectorAll("[data-step]").forEach((b) => b.addEventListener("click", () => {
    const qty = card.querySelector("[data-qty]");
    qty.value = String(Math.max(1, (parseInt(qty.value, 10) || 1) + Number(b.dataset.step)));
    refreshPurchase(card);
  }));
  card.querySelector("[data-add]").addEventListener("click", () => addToCart(card));

  if (isEditor) {
    card.querySelectorAll(".stock-input, [data-price-input]").forEach((input) => {
      input.addEventListener("input", () => markDirty(card));
    });
    card.querySelector("[data-save]").addEventListener("click", () => saveEdits(card));
  }
  return card;
}

function updateCard(card, p) {
  const img = card.querySelector("[data-image]");
  const src = p.imageUrl || "/assets/products/tee.svg";
  if (img.getAttribute("src") !== src) img.src = src;
  img.alt = p.name;
  card.querySelector("[data-name]").textContent = p.name;
  card.querySelector("[data-desc]").textContent = p.description || "";

  const editing = dirty.has(p.id);
  for (const size of SIZES) {
    const n = stockOf(p, size);
    const el = card.querySelector(`[data-stock="${size}"]`);
    if (isEditor) {
      if (!editing) el.value = String(n);
    } else {
      el.textContent = n > 0 ? String(n) : "Out of stock";
      el.classList.toggle("is-out", n === 0);
    }
  }
  if (isEditor) {
    if (!editing) card.querySelector("[data-price-input]").value = Number(p.price || 0).toFixed(2);
  } else {
    card.querySelector("[data-price]").textContent = money(p.price);
  }
  refreshPurchase(card);
}

const stockOf = (p, size) => Math.max(0, parseInt(p?.sizes?.[size], 10) || 0);

// Enable/disable sizes and the add button based on stock minus what's already in the cart.
function refreshPurchase(card, clampQty = true) {
  const p = products.get(card.dataset.productId);
  if (!p) return;
  let selected = card.querySelector('input[type="radio"]:checked');

  for (const size of SIZES) {
    const radio = card.querySelector(`input[type="radio"][value="${size}"]`);
    const out = stockOf(p, size) === 0;
    radio.disabled = out;
    radio.closest(".size-row").classList.toggle("is-out", out);
    if (out && radio.checked) {
      radio.checked = false;
      selected = null;
    }
  }

  const qtyInput = card.querySelector("[data-qty]");
  const addBtn = card.querySelector("[data-add]");
  const hint = card.querySelector("[data-hint]");
  const allOut = SIZES.every((s) => stockOf(p, s) === 0);

  if (allOut) {
    addBtn.disabled = true;
    hint.textContent = "Out of stock in all sizes.";
    return;
  }
  if (!selected) {
    addBtn.disabled = true;
    hint.textContent = "Select a size to add this item.";
    return;
  }

  const size = selected.value;
  const inCart = cart.qtyFor(p.id, size);
  const canAdd = Math.max(0, stockOf(p, size) - inCart);
  qtyInput.max = String(Math.max(1, canAdd));
  const qty = parseInt(qtyInput.value, 10);
  if (clampQty && (!qty || qty < 1)) qtyInput.value = "1";
  if (clampQty && qty > canAdd && canAdd > 0) qtyInput.value = String(canAdd);

  const current = parseInt(qtyInput.value, 10) || 0;
  addBtn.disabled = canAdd === 0 || current < 1 || current > canAdd;
  if (canAdd === 0) {
    hint.textContent = `All available ${size} are already in your cart.`;
  } else if (current > canAdd) {
    hint.textContent = `Only ${canAdd} more available in size ${size}.`;
  } else {
    hint.textContent = inCart ? `${inCart} already in your cart.` : "";
  }
}

function addToCart(card) {
  const p = products.get(card.dataset.productId);
  const selected = card.querySelector('input[type="radio"]:checked');
  const qty = parseInt(card.querySelector("[data-qty]").value, 10);
  if (!p || !selected || !qty || qty < 1) return;
  const size = selected.value;
  const canAdd = stockOf(p, size) - cart.qtyFor(p.id, size);
  if (qty > canAdd) {
    refreshPurchase(card);
    return;
  }
  cart.add(p.id, size, qty);
  card.querySelector("[data-qty]").value = "1";
  refreshPurchase(card);
  toast(`Added ${qty} × ${p.name} (${size}) to your cart.`);
}

// ---------------------------------------------------------------------------
// Editor tools
// ---------------------------------------------------------------------------

function markDirty(card) {
  dirty.add(card.dataset.productId);
  card.classList.add("is-dirty");
  card.querySelector("[data-save]").disabled = false;
  card.querySelector("[data-save-state]").textContent = "Unsaved changes";
}

async function saveEdits(card) {
  const id = card.dataset.productId;
  const saveBtn = card.querySelector("[data-save]");
  const state = card.querySelector("[data-save-state]");

  const sizes = {};
  for (const size of SIZES) {
    const input = card.querySelector(`[data-stock="${size}"]`);
    const n = Number(input.value);
    if (!Number.isInteger(n) || n < 0) {
      state.textContent = `${size} must be a whole number of 0 or more.`;
      input.focus();
      return;
    }
    sizes[size] = n;
  }
  const priceInput = card.querySelector("[data-price-input]");
  const price = Math.round(Number(priceInput.value) * 100) / 100;
  if (!Number.isFinite(price) || price < 0 || priceInput.value === "") {
    state.textContent = "Price must be 0 or more.";
    priceInput.focus();
    return;
  }

  saveBtn.disabled = true;
  state.textContent = "Saving…";
  try {
    await updateDoc(doc(db, "products", id), {
      sizes, price, updatedAt: serverTimestamp(), updatedBy: email,
    });
    dirty.delete(id);
    card.classList.remove("is-dirty");
    state.textContent = "Saved";
    toast("Changes saved.");
    const p = products.get(id);
    if (p) updateCard(card, { ...p, sizes, price });
  } catch (e) {
    console.error(e);
    saveBtn.disabled = false;
    state.textContent = "Couldn't save — you may not have edit access.";
  }
}

// ---------------------------------------------------------------------------
// Tabs and floating cart
// ---------------------------------------------------------------------------

function setupTabs() {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const select = (tab, focus = false) => {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
    });
    if (focus) tab.focus();
    history.replaceState(null, "", `#${tab.dataset.category}`);
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", (e) => {
      const delta = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (delta) select(tabs[(i + delta + tabs.length) % tabs.length], true);
      if (e.key === "Home") select(tabs[0], true);
      if (e.key === "End") select(tabs[tabs.length - 1], true);
    });
  });
  const fromHash = tabs.find((t) => `#${t.dataset.category}` === location.hash);
  if (fromHash) select(fromHash);
}

function setupFloatingCart() {
  const el = document.querySelector("[data-floating-cart]");
  const refresh = () => {
    el.hidden = cart.count() === 0;
    updateCartBadge();
    cards.forEach((card) => refreshPurchase(card, false));
  };
  window.addEventListener("cart-changed", refresh);
  refresh();
}

// Warn editors before leaving with unsaved changes.
window.addEventListener("beforeunload", (e) => {
  if (dirty.size) e.preventDefault();
});
