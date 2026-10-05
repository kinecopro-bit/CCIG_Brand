# Self-Funded Onboarding Portal

Client-facing home page: timeline on top, full checklist below. Source content comes from
`../CCIG Self-Funded Transition Roadmap Tool (1).xlsx` (Document & Task Library) and
`../20260924-Benefits-SelfFundedOnboardingChecklist.docx` (timeline phases/weeks).

- `index.html` – single static page, brand fonts/colors, Firebase Auth + Firestore via CDN ES modules.
- `firestore.rules` – security rules (publish in Firebase console → Firestore Database → Rules).

## Checklist columns
Item · What This Covers · Responsible Party · Signer · **Sign** (button on document rows) · **Status** (Not Started / Scheduled / In Progress / Complete / Submitted) · **Notes** · **Applicability** (Applicable / Not Applicable, staff only).
*Not Applicable* fades and greys the row and disables Status/Notes. "Hide items that don't apply" removes those rows from view.

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

## Deploy
`firebase deploy --only hosting` from this folder (see `firebase.json`: public dir `.`, with README/rules ignored).
