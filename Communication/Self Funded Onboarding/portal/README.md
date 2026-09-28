# Self-Funded Onboarding Portal (template)

Client-facing home page: timeline on top, full checklist below. Source content comes from
`../CCIG Self-Funded Transition Roadmap Tool (1).xlsx` (Document & Task Library) and
`../20260924-Benefits-SelfFundedOnboardingChecklist.docx` (timeline phases/weeks).

- `index.html` – single static page, brand fonts/colors, Firebase (Firestore) via CDN ES modules.
- `firestore.rules` – template rules (open). **Tighten before production.**

## Checklist columns
Item · What This Covers · Responsible Party · Signer · **Status** (Not Started / Scheduled / In Progress / Complete / Submitted) · **Notes** (wraps) · **Applicability** (Applicable / Not Applicable).
Selecting *Not Applicable* greys out and fades the row and disables Status/Notes. "Hide items that don't apply" removes them from view.

## Firebase
Data lives in Firestore at `clients/{clientId}`; open the page with `?client=acme-inc` for a per-client copy (default `template`). Fields: `items.{taskId}.{status,note,applicable}`.
If Firestore is unreachable the page falls back to browser localStorage.
Enable Firestore in the `client-self-funded-onboarding` project (Build → Firestore Database) before first use.

## Locking Applicability (production)
In the template every viewer can change Applicability. To restrict it to approved CCIG users:
1. Set `CAN_EDIT_APPLICABILITY = false` for clients (or derive it from a sign-in / custom claim for staff).
2. Add Firebase Auth and rules so only staff (e.g. `request.auth.token.ccig == true`) may write `items.*.applicable`, and clients are limited to `status` and `note`.

## Deploy
Any static host, e.g. `firebase deploy --only hosting` with `public` set to this folder.
