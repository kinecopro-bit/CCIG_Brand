# Self-Funded Onboarding Portal

Client-facing home page: timeline on top, full checklist below. Source content comes from
`../CCIG Self-Funded Transition Roadmap Tool (1).xlsx` (Document & Task Library) and
`../20260924-Benefits-SelfFundedOnboardingChecklist.docx` (timeline phases/weeks).

- `index.html` – single static page, brand fonts/colors, Firebase Auth + Firestore via CDN ES modules.
- `firestore.rules` – production security rules (publish in Firebase console → Firestore Database → Rules).
- `firestore.rules.open-test` – wide-open rules for no-sign-in test mode.

## Checklist columns
Item · What This Covers · Responsible Party · Signer · **Sign** (button on document rows) · **Status** (Not Started / Scheduled / In Progress / Complete / Submitted) · **Notes** · **Applicability** (Applicable / Not Applicable, staff only).
*Not Applicable* fades and greys the row and disables Status/Notes. "Hide items that don't apply" removes those rows from view.

## Open test mode vs. sign-in
`index.html` has a switch near the top: `const REQUIRE_SIGN_IN = false;`
- **false (current): open test mode.** No sign-in. Anyone with the URL can edit everything, including Applicability and signing links. Publish `firestore.rules.open-test`. Never use real client data in this mode.
- **true: production mode.** Email-link sign-in, per-client access lists, staff-only Applicability and links. Publish `firestore.rules` and follow the setup below.
Switching back and forth loses no data (same Firestore documents).

## Sign-in (emailed link)
Clients enter their email and receive a one-time sign-in link; no passwords. Access is by client link, e.g.
`https://self-funded-onboarding.web.app/?client=acme`, and only emails on that client's access list can open it.
The page shows the sync badge: "Saved to CCIG portal" appears only after Firestore's server confirms.

### One-time Firebase setup
1. **Authentication → Get started → Sign-in method → Email/Password → enable it, and turn on "Email link (passwordless sign-in)".**
2. Authentication → Settings → Authorized domains: `self-funded-onboarding.web.app` is there by default; add a custom domain if you use one.
3. Publish `firestore.rules`.
4. Create your first staff record (Firestore Database → Data → Start collection `staff` → Document ID = your **lowercase email**, any field, e.g. `active: true`). Only the console can create staff.
5. Redeploy: `firebase deploy --only hosting`.

### Signing links (per client, per document)
Each row in "Documents to Sign" has a **Sign document** button that opens that client's own signing link (DocuSign, Adobe Sign, etc.) in a new tab.
Staff see an **Add link / Edit link** button under it: paste the full `https://` link (empty removes it). Until a link is set, clients see "Link coming soon".
Only `https://` links are accepted. Links are stored in `clients/{id}.docLinks` (staff write only), so one client never sees another's links.
Marking the row Submitted/Complete is still done by the client; status does not update automatically.

### Adding a client
1. Open `?client=<id>` and sign in as staff. A "CCIG staff tools" card appears.
2. Enter the client name and approved emails (one per line), then Save.
3. Send the client their link. Staff can set Applicability per item on the same page.

## Data model
- `clients/{id}`: `clientName`, `allowedEmails[]`, `applicability{taskId: ...}`, `docLinks{taskId: https-url}`. Staff write only.
- `clients/{id}/progress/main`: `items{taskId: {status, note}}`. Staff and approved client emails.
- `staff/{email}`: marks approved CCIG staff. Console only.

## Embedding in an iframe (auto-height, no scroll bar)
The portal reports its content height to the parent page (`postMessage`, type `ccig-portal-height`) whenever it changes (tab switch, long note, resize). Add this where the iframe lives on your site:
```html
<iframe id="ccig-portal"
  src="https://self-funded-onboarding.web.app/?client=CLIENTID"
  style="width:100%; border:0; height:900px;"
  scrolling="no"></iframe>
<script>
  window.addEventListener("message", function (e) {
    if (e.origin !== "https://self-funded-onboarding.web.app") return;
    if (!e.data || e.data.type !== "ccig-portal-height") return;
    document.getElementById("ccig-portal").style.height = e.data.height + "px";
  });
</script>
```
`900px` is only the starting height. The parent can send `{type:"ccig-portal-ping"}` to the iframe's `contentWindow` to ask for the height again.
Email sign-in links open in their own browser tab, not inside the iframe.

## Deploy
`firebase deploy --only hosting` from this folder (see `firebase.json`: public dir `.`, with README/rules ignored).
