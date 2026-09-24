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

Set `EMAIL_TRANSPORT` in `functions/.env`:

| Mode | Order email to Nick comes from… | Confirmation comes from… | Needs |
|---|---|---|---|
| `log` (default) | not sent; written to `mail_log` | not sent | nothing, for testing |
| `smtp` | Nick's mailbox, shown as **"Jane Doe via CCIG Apparel"**, with **Reply-To: jane.doe@thinkccig.com** | nick.kokat@thinkccig.com | SMTP enabled for that mailbox. Put its password (or app password) in `EMAIL_SECRET` |
| `graph` (Microsoft 365) | **the orderer's own mailbox** (jane.doe@thinkccig.com) | nick.kokat@thinkccig.com | An Entra ID app registration with the **Mail.Send application** permission (admin consent). Set `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, and the client secret in `EMAIL_SECRET` |

Why the modes differ: a website can't send email *as* someone without access to their mailbox. `graph` mode gets that access through an IT-approved Microsoft 365 app permission. It's recommended if CCIG is on Microsoft 365, and IT can use an *application access policy* to limit which mailboxes it may send from. If IT won't grant that, `smtp` mode is the standard workaround: the email names the orderer and replies go straight to them.

If an email fails, the order is still saved. Its `emailStatus` shows `failed`/`partial`, and the error appears in the function logs.
