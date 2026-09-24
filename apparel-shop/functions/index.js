/**
 * CCIG Apparel Shop — Cloud Functions
 *
 * placeOrder (callable):
 *   1. Confirms the caller is signed in with a verified @thinkccig.com email.
 *   2. Validates the cart, re-prices it from Firestore (client prices are never trusted),
 *      checks stock, and optionally decrements size quantities — all in one transaction.
 *   3. Saves the order to /orders.
 *   4. Emails the order to ORDER_INBOX ("An order has been placed for CCIG Apparel.")
 *      and sends the orderer a confirmation ("CCIG APPAREL ORDER SUMMARY").
 */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineString, defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const nodemailer = require("nodemailer");

initializeApp();
const db = getFirestore();

const ORDER_INBOX = defineString("ORDER_INBOX", { default: "nick.kokat@thinkccig.com" });
const ALLOWED_DOMAIN = defineString("ALLOWED_DOMAIN", { default: "thinkccig.com" });
const EMAIL_TRANSPORT = defineString("EMAIL_TRANSPORT", { default: "log" });
const SMTP_HOST = defineString("SMTP_HOST", { default: "smtp.office365.com" });
const SMTP_PORT = defineString("SMTP_PORT", { default: "587" });
const SMTP_USER = defineString("SMTP_USER", { default: "" });
const GRAPH_TENANT_ID = defineString("GRAPH_TENANT_ID", { default: "" });
const GRAPH_CLIENT_ID = defineString("GRAPH_CLIENT_ID", { default: "" });
const DECREMENT_INVENTORY = defineString("DECREMENT_INVENTORY", { default: "true" });
const SHOP_URL = defineString("SHOP_URL", { default: "" });
// SMTP password or Graph client secret, depending on EMAIL_TRANSPORT.
const EMAIL_SECRET = defineSecret("EMAIL_SECRET");

const SIZES = ["S", "M", "L", "XL", "XXL"];
const CATEGORY_LABELS = { mens: "Men's", womens: "Women's", unisex: "Unisex" };
const MAX_LINES = 50;
const MAX_QTY_PER_LINE = 50;
const MAX_RECIPIENTS_LENGTH = 2000;

const SUBJECT_ORDER = "An order has been placed for CCIG Apparel.";
const SUBJECT_CONFIRMATION = "CCIG APPAREL ORDER SUMMARY";

exports.placeOrder = onCall({ secrets: [EMAIL_SECRET] }, async (request) => {
  const email = requireCcigUser(request.auth);
  const { lines, recipients } = validateOrderInput(request.data);

  const orderRef = db.collection("orders").doc();
  const orderNumber = makeOrderNumber(orderRef.id);
  const decrement = DECREMENT_INVENTORY.value().toLowerCase() === "true";

  const order = await db.runTransaction(async (tx) => {
    const productIds = [...new Set(lines.map((l) => l.productId))];
    const refs = productIds.map((id) => db.collection("products").doc(id));
    const snaps = await tx.getAll(...refs);
    const products = new Map(snaps.map((s) => [s.id, s]));

    const items = [];
    const newSizes = new Map();
    for (const line of lines) {
      const snap = products.get(line.productId);
      if (!snap || !snap.exists || snap.get("active") === false) {
        throw new HttpsError("failed-precondition", "An item in your cart is no longer available.");
      }
      const p = snap.data();
      const sizes = newSizes.get(snap.id) || { ...p.sizes };
      const available = Number(sizes[line.size] || 0);
      if (decrement && available < line.qty) {
        throw new HttpsError(
          "failed-precondition",
          `Only ${available} left of ${p.name} in size ${line.size}. Please update your cart.`
        );
      }
      if (decrement) {
        sizes[line.size] = available - line.qty;
        newSizes.set(snap.id, sizes);
      }
      const unitPrice = Number(p.price || 0);
      items.push({
        productId: snap.id,
        name: p.name,
        category: p.category,
        size: line.size,
        qty: line.qty,
        unitPrice,
        lineTotal: round2(unitPrice * line.qty),
      });
    }

    for (const [id, sizes] of newSizes) {
      tx.update(db.collection("products").doc(id), { sizes });
    }

    const data = {
      orderNumber,
      email,
      uid: request.auth.uid,
      ...nameFromEmail(email),
      items,
      totalItems: items.reduce((n, i) => n + i.qty, 0),
      subtotal: round2(items.reduce((n, i) => n + i.lineTotal, 0)),
      recipients,
      payrollAcknowledged: true,
      inventoryDecremented: decrement,
      createdAt: FieldValue.serverTimestamp(),
      emailStatus: "pending",
    };
    tx.create(orderRef, data);
    return data;
  });

  // Emails go out after the order is safely saved, so an email outage never loses an order.
  const results = await Promise.allSettled([
    sendOrderNotification(order),
    sendConfirmation(order),
  ]);
  const failures = results.filter((r) => r.status === "rejected");
  failures.forEach((f) => logger.error("Order email failed", { orderNumber, error: String(f.reason) }));
  const emailStatus = failures.length === 0 ? "sent" : failures.length === 2 ? "failed" : "partial";
  await orderRef.update({ emailStatus, emailTransport: EMAIL_TRANSPORT.value() });

  return { orderId: orderRef.id, orderNumber, emailStatus, totalItems: order.totalItems };
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function requireCcigUser(auth) {
  const email = (auth?.token?.email || "").toLowerCase();
  const domain = ALLOWED_DOMAIN.value().toLowerCase();
  if (!auth || !email) {
    throw new HttpsError("unauthenticated", "Please sign in with your CCIG email.");
  }
  if (!auth.token.email_verified || !email.endsWith(`@${domain}`)) {
    throw new HttpsError("permission-denied", `Only verified @${domain} accounts can place orders.`);
  }
  return email;
}

function validateOrderInput(data) {
  if (!data || typeof data !== "object") {
    throw new HttpsError("invalid-argument", "Missing order details.");
  }
  if (data.acknowledged !== true) {
    throw new HttpsError("invalid-argument", "Please accept the payroll deduction acknowledgement.");
  }
  const recipients = typeof data.recipients === "string" ? data.recipients.trim() : "";
  if (!recipients) {
    throw new HttpsError("invalid-argument", 'Please answer "Who are these for?"');
  }
  if (recipients.length > MAX_RECIPIENTS_LENGTH) {
    throw new HttpsError("invalid-argument", '"Who are these for?" is too long.');
  }
  if (!Array.isArray(data.items) || data.items.length === 0) {
    throw new HttpsError("invalid-argument", "Your cart is empty.");
  }
  if (data.items.length > MAX_LINES) {
    throw new HttpsError("invalid-argument", "Too many items in one order.");
  }

  // Merge duplicate product/size lines.
  const merged = new Map();
  for (const raw of data.items) {
    const productId = typeof raw?.productId === "string" ? raw.productId : "";
    const size = raw?.size;
    const qty = raw?.qty;
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(productId) || !SIZES.includes(size)
        || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY_PER_LINE) {
      throw new HttpsError("invalid-argument", "Your cart contains an invalid item.");
    }
    const key = `${productId}|${size}`;
    const prev = merged.get(key);
    merged.set(key, { productId, size, qty: (prev?.qty || 0) + qty });
  }
  return { lines: [...merged.values()], recipients };
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

async function sendOrderNotification(order) {
  const html = emailLayout({
    heading: "New apparel order",
    requestFrom: order.name,
    intro: `A new order was placed by ${esc(order.email)}.`,
    order,
    outro: `Reply to this email to reach ${esc(order.name)} directly.`,
  });
  await sendMail({
    // In "smtp" mode (default for CCIG) it's sent from the ORDER_INBOX mailbox, shown as
    // "First Last via CCIG Apparel", with Reply-To set to the orderer.
    // In "graph" mode it's sent from the orderer's own mailbox.
    fromUser: order.email,
    fromName: order.name,
    to: ORDER_INBOX.value(),
    replyTo: order.email,
    subject: SUBJECT_ORDER,
    html,
    text: emailText(order, `The request is from: ${order.name}\n\nA new order was placed by ${order.email}.`),
  });
}

async function sendConfirmation(order) {
  const inbox = ORDER_INBOX.value();
  const shopUrl = SHOP_URL.value();
  const html = emailLayout({
    heading: "We received your order",
    intro: `Hi ${esc(order.firstName || order.name)}, thanks for your order! Here's a summary.`,
    order,
    outro:
      `If you need to submit any changes to your order, please reach out to ` +
      `<a href="mailto:${esc(inbox)}" style="color:#366E8E;">${esc(inbox)}</a>.` +
      (shopUrl ? `<br><br><a href="${esc(shopUrl)}" style="color:#366E8E;">Back to the CCIG Apparel Shop</a>` : ""),
  });
  await sendMail({
    fromUser: inbox,
    fromName: "CCIG Apparel",
    to: order.email,
    replyTo: inbox,
    subject: SUBJECT_CONFIRMATION,
    html,
    text: emailText(
      order,
      "Thanks for your order! Here's a summary.",
      `If you need to submit any changes to your order, please reach out to ${inbox}.`
    ),
  });
}

async function sendMail({ fromUser, fromName, to, replyTo, subject, html, text }) {
  const transport = EMAIL_TRANSPORT.value().toLowerCase();

  if (transport === "graph") {
    return sendViaGraph({ from: fromUser, to, replyTo, subject, html });
  }

  if (transport === "smtp") {
    const smtpUser = SMTP_USER.value();
    const port = Number(SMTP_PORT.value());
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST.value(),
      port,
      secure: port === 465,
      auth: { user: smtpUser, pass: EMAIL_SECRET.value() },
    });
    // Most mail servers only let an account send as itself, so the orderer's
    // name is shown as the sender and Reply-To points at their address.
    const fromName2 = fromUser.toLowerCase() === smtpUser.toLowerCase() ? fromName : `${fromName} via CCIG Apparel`;
    return transporter.sendMail({
      from: { name: fromName2, address: smtpUser },
      to,
      replyTo,
      subject,
      html,
      text,
    });
  }

  // "log" mode: nothing is sent. Useful while the foundation is being tested.
  logger.info(`[EMAIL_TRANSPORT=log] ${subject}`, { from: fromUser, to, replyTo });
  await db.collection("mail_log").add({
    from: fromUser, to, replyTo, subject, html, text, createdAt: FieldValue.serverTimestamp(),
  });
}

async function sendViaGraph({ from, to, replyTo, subject, html }) {
  const tokenRes = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(GRAPH_TENANT_ID.value())}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GRAPH_CLIENT_ID.value(),
        client_secret: EMAIL_SECRET.value(),
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    }
  );
  if (!tokenRes.ok) throw new Error(`Graph token request failed: ${tokenRes.status} ${await tokenRes.text()}`);
  const { access_token: token } = await tokenRes.json();

  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: "HTML", content: html },
        toRecipients: [{ emailAddress: { address: to } }],
        replyTo: replyTo ? [{ emailAddress: { address: replyTo } }] : [],
      },
      saveToSentItems: true,
    }),
  });
  if (!res.ok) throw new Error(`Graph sendMail failed: ${res.status} ${await res.text()}`);
}

function emailLayout({ heading, intro, order, outro, requestFrom = "" }) {
  const rows = order.items.map((i) => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #EDECED;">${esc(i.name)}<br>
        <span style="color:#366E8E;font-size:12px;">${esc(CATEGORY_LABELS[i.category] || i.category)}</span></td>
      <td style="padding:10px 12px;border-bottom:1px solid #EDECED;text-align:center;">${esc(i.size)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #EDECED;text-align:center;">${i.qty}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #EDECED;text-align:right;">${money(i.lineTotal)}</td>
    </tr>`).join("");

  return `<!doctype html>
<html><body style="margin:0;background:#EDECED;font-family:'Source Sans Pro',Segoe UI,Arial,sans-serif;color:#153243;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EDECED;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:8px;overflow:hidden;">
        <tr><td style="background:#153243;padding:22px 28px;">
          <div style="color:#FFC666;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:600;">CCIG Apparel</div>
          <div style="color:#FFFFFF;font-family:'Playfair Display',Georgia,serif;font-size:26px;font-weight:800;margin-top:6px;">${esc(heading)}</div>
        </td></tr>
        <tr><td style="height:4px;background:#8FB24E;"></td></tr>
        <tr><td style="padding:24px 28px 8px;font-size:15px;line-height:1.5;">
          ${requestFrom ? `<p style="margin:0 0 14px;font-size:17px;padding:12px 14px;background:#EDECED;border-left:4px solid #8FB24E;">
            The request is from: <strong>${esc(requestFrom)}</strong></p>` : ""}
          <p style="margin:0 0 14px;">${intro}</p>
          <p style="margin:0 0 4px;font-size:13px;color:#366E8E;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Order number</p>
          <p style="margin:0 0 16px;font-weight:700;">${esc(order.orderNumber)}</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;border-collapse:collapse;">
            <tr style="background:#153243;color:#FFFFFF;">
              <th align="left" style="padding:10px 12px;">Item</th>
              <th style="padding:10px 12px;">Size</th>
              <th style="padding:10px 12px;">Qty</th>
              <th align="right" style="padding:10px 12px;">Price</th>
            </tr>
            ${rows}
            <tr>
              <td colspan="2" style="padding:12px;font-weight:700;">Total items: ${order.totalItems}</td>
              <td colspan="2" style="padding:12px;text-align:right;font-weight:700;">Subtotal: ${money(order.subtotal)}</td>
            </tr>
          </table>
          <p style="margin:20px 0 4px;font-size:13px;color:#366E8E;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Who are these for?</p>
          <p style="margin:0 0 16px;white-space:pre-wrap;">${esc(order.recipients)}</p>
          <p style="margin:0 0 16px;font-size:13px;color:#153243;background:#EDECED;padding:10px 12px;border-left:4px solid #FFC666;">
            Payroll deduction acknowledged: ${esc(order.name)} understands and authorizes the payroll deduction, if applicable.
          </p>
          <p style="margin:0 0 20px;">${outro}</p>
        </td></tr>
        <tr><td style="background:#153243;color:#BFC7CB;font-size:12px;padding:14px 28px;">CCIG · Denver · Austin · Phoenix</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function emailText(order, intro, outro = "") {
  const lines = order.items.map((i) =>
    `- ${i.name} (${CATEGORY_LABELS[i.category] || i.category}) — Size ${i.size} × ${i.qty} — ${money(i.lineTotal)}`);
  return [
    intro,
    "",
    `Order number: ${order.orderNumber}`,
    ...lines,
    `Total items: ${order.totalItems}`,
    `Subtotal: ${money(order.subtotal)}`,
    "",
    "Who are these for?",
    order.recipients,
    "",
    "Payroll deduction acknowledged.",
    outro,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// CCIG emails are first.last@thinkccig.com: everything before the first "." is the
// first name, everything after it (up to the "@") is the last name.
function nameFromEmail(email) {
  const local = email.split("@")[0];
  const dot = local.indexOf(".");
  const firstName = capitalize(dot === -1 ? local : local.slice(0, dot));
  const lastName = capitalize(dot === -1 ? "" : local.slice(dot + 1));
  return { firstName, lastName, name: [firstName, lastName].filter(Boolean).join(" ") || email };
}

// "smith-jones" -> "Smith-Jones", "o'brien" -> "O'Brien"
function capitalize(s) {
  return s.toLowerCase().replace(/(^|[-'. ])([a-z])/g, (_, sep, c) => sep + c.toUpperCase());
}

function makeOrderNumber(id) {
  const d = new Date();
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  return `CCIG-${ymd}-${id.slice(0, 5).toUpperCase()}`;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function money(n) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
