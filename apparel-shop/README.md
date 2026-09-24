# CCIG Apparel Shop (Firebase)

An internal apparel store for CCIG team members, branded to this repo's standards (CCIG palette, Playfair Display + Source Sans, logos from `logos/primary/`).

**Everything uses placeholders for now:** products, images, prices, stock, the Firebase project ID, and email credentials. Swap them for real values when you're ready.

## What it does

| Page | Features |
|---|---|
| **Sign in** (`/login`) | Only `@thinkccig.com` emails. We send a one-time sign-in link, so nobody needs a password. Sign-in is remembered on the device, and every order is tied to that email. |
| **Apparel** (`/`) | Men's / Women's / Unisex tabs. Each item has an image, the S–XXL quantities available, a price in USD, a size picker, a quantity stepper, and an **Add to cart** button. **Editors** (see below) can change quantities and prices on the page and click **Save changes**. |
| **Cart** (`/cart`) | Line items with editable quantities, an automatic **total items** count and subtotal, the private **"Who are these for?"** field, the **required** payroll-deduction checkbox, and **Check out**. |

When someone checks out, the `placeOrder` Cloud Function runs these steps:
1. It re-checks their domain, the stock and the prices on the server.
2. It subtracts the ordered quantities from stock.
3. It saves the order to Firestore under `orders`.
4. It emails **"An order has been placed for CCIG Apparel."** to `ORDER_INBOX` (nick.kokat@thinkccig.com).
5. It emails **"CCIG APPAREL ORDER SUMMARY"** from `ORDER_INBOX` to the person who ordered.

The "Who are these for?" answer stays in that person's browser tab until they check out. Nobody else sees it.

## Project layout

```
apparel-shop/
  firebase.json / .firebaserc     Hosting, Firestore, Functions, emulator config
  firestore.rules                 Domain gate, editor-only edits, private orders
  public/                         The website (no build step)
    index.html  cart.html  login.html
    css/styles.css                CCIG brand styles
    js/firebase-config.js         ← paste your Firebase web config here
    assets/products/*.svg         Placeholder product images
  functions/
    index.js                      placeOrder function + email templates
    .env                          Non-secret settings (inbox, email mode, etc.)
    scripts/seed.js               Loads placeholder products + first editor
```

## Try it locally (no Firebase account needed)

Requires Node 22, Java 11+ and `npm i -g firebase-tools`.

```bash
cd apparel-shop/functions && npm install
echo "EMAIL_SECRET=placeholder" > .secret.local
cd .. && firebase emulators:start --project ccig-apparel-shop
# in a second terminal:
cd apparel-shop/functions
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=ccig-apparel-shop npm run seed
```

Open http://127.0.0.1:5000 and sign in with any `@thinkccig.com` address. The sign-in link doesn't get emailed. Find it in the terminal or at http://127.0.0.1:4000/auth. `nick.kokat@thinkccig.com` is seeded as an editor. Emails aren't sent in this mode (`EMAIL_TRANSPORT=log`). You can read them in the Firestore `mail_log` collection at http://127.0.0.1:4000/firestore.

## Going live

1. **Create a Firebase project** and upgrade it to the **Blaze (pay-as-you-go)** plan. Cloud Functions need Blaze, but an internal shop this size should stay within the free usage tiers.
2. Put the project ID in `.firebaserc`. Paste the web app config into `public/js/firebase-config.js`.
3. **Authentication** → Sign-in method → enable **Email/Password** and turn on **Email link (passwordless sign-in)**. Under Settings → Authorized domains, add your hosting domain.
4. **Firestore** → create the database.
5. Set up email (see below). Then set the secret: `firebase functions:secrets:set EMAIL_SECRET`.
6. Deploy: `firebase deploy`.
7. Seed or add products. Run `gcloud auth application-default login`, then `GCLOUD_PROJECT=<id> npm run seed` from `functions/`. You can also add products in the Firestore console.

### Managing editors
To make someone an editor, add a document to the `admins` collection. The document ID must be their lowercase email, e.g. `admins/jane.doe@thinkccig.com`. Editors can change quantities and prices, and nothing else. The Firestore rules enforce this, so it holds even if someone bypasses the page.

### Product fields (`products/{id}`)
`category` (`mens` | `womens` | `unisex`), `name`, `description`, `imageUrl`, `price` (number), `sizes` (`{S, M, L, XL, XXL}` whole numbers), `sortOrder`, `active`.
For images, drop real photos into `public/assets/products/` and point `imageUrl` at them.

## Email setup

CCIG is on Microsoft 365 and uses **`smtp` mode**, so IT doesn't need to register an app:

- **Order email** ("An order has been placed for CCIG Apparel."): sent to `ORDER_INBOX` from Nick's mailbox. The sender name reads **"Jane Doe via CCIG Apparel"** and **Reply-To** is the orderer. The body starts with **"The request is from: Jane Doe"**.
- **Confirmation email** ("CCIG APPAREL ORDER SUMMARY"): sent from nick.kokat@thinkccig.com to the orderer.

The name comes from the signed-in CCIG email. Everything before the first "." is the first name, and everything after it (up to the "@") is the last name. So `jane.doe@thinkccig.com` becomes **Jane Doe**. The name is also saved on the order (`firstName`, `lastName`, `name`).

To turn sending on:
1. In `functions/.env`, set `EMAIL_TRANSPORT=smtp`. Check that `SMTP_USER` is the sending mailbox (nick.kokat@thinkccig.com) and that `SMTP_HOST=smtp.office365.com` and `SMTP_PORT=587`.
2. Run `firebase functions:secrets:set EMAIL_SECRET` and enter that mailbox's password. If the account uses MFA, use an app password.
3. Run `firebase deploy --only functions`, place a test order, and check both inboxes.

If Microsoft 365 rejects the login (`535 5.7.139 Authentication unsuccessful`), password sign-in for SMTP is turned off for that mailbox or the organization. Microsoft has been phasing it out. The fallback is to register a small app for the mailbox and send through Microsoft Graph instead.

Other modes: `log` (the default while testing) writes emails to the `mail_log` collection instead of sending them. `graph` sends through Microsoft Graph and needs `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID` and a client secret in `EMAIL_SECRET`.

If an email fails, the order is still saved. Its `emailStatus` shows `failed`/`partial`, and the error appears in the function logs.
