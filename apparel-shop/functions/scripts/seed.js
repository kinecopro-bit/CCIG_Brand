/**
 * Seeds placeholder products and the first editor.
 *
 *   Emulator:   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=ccig-apparel-shop npm run seed
 *   Production: gcloud auth application-default login && GCLOUD_PROJECT=<project-id> npm run seed
 *
 * Existing products are left untouched unless you pass --force.
 */
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp({ projectId: process.env.GCLOUD_PROJECT || "ccig-apparel-shop" });
const db = getFirestore();
const force = process.argv.includes("--force");

// Editors can change size quantities and prices. Add more emails here (lowercase).
const EDITORS = ["nick.kokat@thinkccig.com"];

const stock = (s, m, l, xl, xxl) => ({ S: s, M: m, L: l, XL: xl, XXL: xxl });

const PRODUCTS = [
  { id: "mens-quarter-zip", category: "mens", name: "Men's Performance Quarter-Zip", description: "Placeholder — midweight pullover with embroidered CCIG logo.", imageUrl: "/assets/products/quarter-zip.svg", price: 55, sizes: stock(4, 8, 8, 6, 3), sortOrder: 1 },
  { id: "mens-polo", category: "mens", name: "Men's Classic Polo", description: "Placeholder — moisture-wicking polo with left-chest logo.", imageUrl: "/assets/products/polo.svg", price: 40, sizes: stock(5, 10, 10, 8, 4), sortOrder: 2 },
  { id: "womens-quarter-zip", category: "womens", name: "Women's Performance Quarter-Zip", description: "Placeholder — fitted pullover with embroidered CCIG logo.", imageUrl: "/assets/products/quarter-zip.svg", price: 55, sizes: stock(6, 8, 6, 4, 2), sortOrder: 1 },
  { id: "womens-polo", category: "womens", name: "Women's Classic Polo", description: "Placeholder — tailored polo with left-chest logo.", imageUrl: "/assets/products/polo.svg", price: 40, sizes: stock(6, 10, 8, 4, 2), sortOrder: 2 },
  { id: "unisex-hoodie", category: "unisex", name: "Unisex Logo Hoodie", description: "Placeholder — fleece hoodie with CCIG wordmark.", imageUrl: "/assets/products/hoodie.svg", price: 60, sizes: stock(5, 10, 10, 8, 5), sortOrder: 1 },
  { id: "unisex-tee", category: "unisex", name: "Unisex Logo Tee", description: "Placeholder — soft cotton tee with CCIG wordmark.", imageUrl: "/assets/products/tee.svg", price: 25, sizes: stock(10, 15, 15, 10, 6), sortOrder: 2 },
];

(async () => {
  for (const { id, ...p } of PRODUCTS) {
    const ref = db.collection("products").doc(id);
    if (!force && (await ref.get()).exists) {
      console.log(`skip   products/${id} (exists)`);
      continue;
    }
    await ref.set({ ...p, active: true, updatedAt: FieldValue.serverTimestamp(), updatedBy: "seed" });
    console.log(`wrote  products/${id}`);
  }
  for (const email of EDITORS) {
    await db.collection("admins").doc(email.toLowerCase()).set({ addedAt: FieldValue.serverTimestamp() }, { merge: true });
    console.log(`editor admins/${email.toLowerCase()}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
