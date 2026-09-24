// Firebase web config — PLACEHOLDER VALUES.
// Replace with the values from Firebase console → Project settings → Your apps → Web app.
// These values are not secret; access is enforced by Firestore rules and the placeOrder function.
export const firebaseConfig = {
  apiKey: "PLACEHOLDER_API_KEY",
  authDomain: "ccig-apparel-shop.firebaseapp.com",
  projectId: "ccig-apparel-shop",
  storageBucket: "ccig-apparel-shop.firebasestorage.app",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:0000000000000000000000",
};

// Only emails on this domain may sign in. (Also enforced server-side.)
export const ALLOWED_DOMAIN = "thinkccig.com";

// Where order questions go; shown in the UI.
export const ORDER_CONTACT = "nick.kokat@thinkccig.com";

// When the site is opened from localhost, talk to the Firebase emulators instead of production.
export const USE_EMULATORS = ["localhost", "127.0.0.1"].includes(location.hostname);
