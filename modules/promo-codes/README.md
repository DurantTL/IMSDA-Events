# Promo codes

Promo codes are event-scoped registration discounts. Staff with
`MANAGE_FINANCE` use **More → Promo codes** to create, edit, or deactivate
them. Published forms opt in through the one-click **Promo code** builder
module; staff never need to know its canonical `promo_code` field key.

## Rules

- Codes normalize with Unicode NFKC, trim surrounding whitespace, and compare
  case-insensitively as 3–32 uppercase letters, numbers, hyphens, or
  underscores. One normalized code may exist only once per event.
- A code is either a positive fixed-cent discount or 1–10,000 basis points
  (0.01%–100%). Percentage calculations floor fractional cents.
- Optional start/end dates are inclusive calendar dates in the event timezone.
- Optional minimum subtotal, maximum total uses, and per-registration maximum
  percentage discount are enforced on the server.
- The eligible subtotal is the complete priced form subtotal before card fees.
  A discount is capped at that subtotal, so totals never become negative.
- If card processing is passed to the registrant, its gross-up is recalculated
  from the discounted subtotal.

## Quote, claim, and history

The public **Apply / Remove** control calls a same-origin, durable
rate-limited quote endpoint. That quote is display-only. Submission reloads
the published form, recalculates the subtotal, revalidates the code, and claims
one use inside the registration’s serializable transaction.

`PromoCode.redeemedCount` is incremented with an optimistic compare-and-swap.
The unique registration redemption and serializable retry protect the final
available use under concurrency. A replay with the same registration
idempotency key returns its original immutable result without claiming another
use.

`PromoCodeRedemption` stores the exact code, rule bounds, eligible subtotal,
discount amount, and event-local pricing date promised to that registration.
Waitlist requests intentionally consume and preserve a use; promotion cannot
silently lose the promised discount. Cancellation does not restore a use.
Used codes are never deleted or renamed; deactivate them and create a new code.

The local seed and `npm run db:refresh-demo` upsert the fictitious `LOCAL10`
code for Women’s Retreat (`10%` off, `$50` maximum, `$100` minimum). A refresh
extends the local-only ceiling so at least 25 test uses remain without deleting
any immutable redemption history. It must not be treated as a live event offer.

## Church-sponsored codes (#545)

On a GENERAL event, staff with `MANAGE_FINANCE` may link a code to a sponsoring
church (an active CHURCH organization) in the same editor. The attendee gets the
normal discount; the church is billed that discount after the event, not paid
online. Nothing is stored per redemption: like church-billed club registrations
(#409), what a church owes is computed from `PromoCodeRedemption.discountAmountCents`
when someone looks.

- One line per redeemed registration, counted only while the registration is
  SUBMITTED or CONFIRMED (the statuses `churchOwedCents` bills). Cancelled,
  waitlisted, and draft registrations drop out on their own.
- Lines appear on `/finance/church-owed` and its CSV grouped under the church,
  by confirmation code and amount only (the church report panel on that page also
  shows the registrant's name, #960; the CSV and the invoice do not), and count in the overview
  "Billed to churches" figure. Each surface keeps its existing permission.
- A church is never billed twice: an event that is a CLUB event, or already
  bills organizations (`DEFERRED_ORGANIZATION_INVOICE`), bills no sponsored
  lines even if a code there names a church.
- The church's exposure is the code's own `maximumUses` and
  `maximumDiscountCents`; there is no separate cap.
- Linking and unlinking are audited with ids only. A used code cannot change or
  lose its sponsor (deactivate it and create a new one), and cloning an event
  never copies a sponsor.
- Attendees see only "Sponsored by <church>" on the code they entered.

### Which redemptions become church lines

- A code entered for the whole registration is one line (its `PromoCodeRedemption`).
- A per-person code (#397) or a code a staff member applies is one line per
  person: a `RegistrationAdjustment` of kind PROMO_CODE, billed at the
  discount (its negative amount, made positive). An adjustment that a later
  adjustment reverses, and the reversal row itself, are both left out.
- Each source is counted once; a registration may hold both kinds.
- Linking is allowed only while the event is GENERAL and attendee-paid, and the
  event's settings save refuses to leave that (club audience, or billing
  organizations) while any code on it has a sponsor: unlink them first. Events
  made by cloning or from a template start with no sponsors.

### Ordering of unlink and claim

Unlinking (or moving) a sponsor is allowed only while `redeemedCount` is 0, and
the write is guarded on that count. If a claim commits first, the unlink is
refused; if the unlink commits first, the claim redeems an unsponsored code and
no church is billed. Either order is consistent, and a church is never billed
for a use it could not have been linked to.

## Church promo code invoices and the church report (#399)

Owner decision (Caleb, Oct 14, 2026): a church is **invoiced** for what its code
covered, through the organization invoicing built for Camporee (#165-#168). The
office finalizes and sends the invoice; finalizing stays a named human action.
Automation may prepare a draft and must never finalize or send one.

- **Draft, by a staff action.** On **Finance, Owed by churches**, staff with
  `MANAGE_FINANCE` press **Create draft invoice** for a church. It builds one
  draft `Invoice` per church per event (group key `church-promo:<churchId>`,
  version basis `CHURCH_PROMO_CODES`, no reconciliation) from the lines #545
  already counts: one line per billed redemption, at the amount the church owes
  for it, in whole cents. Cancelled, waitlisted and draft registrations and other
  churches' lines are left out.
- **Safe to repeat.** It runs SERIALIZABLE and retries conflicts
  (`isSerializationFailure`), under the same per-event lock finalizing takes. With
  nothing changed it writes nothing; a change to the redemptions or to the church's
  billing contact refreshes the same draft; after finalization a change starts a
  revision draft beside the finalized version, which stays as it was. With nothing
  billable, no draft is made.
- **Never finalized or sent from here.** A draft has no number, receivable,
  delivery or email. Finalizing needs the Finalize invoices permission and is
  refused when the draft no longer matches the redemptions or the church has no
  billing contact. Sending, "Posted to AR" and recording payments are the existing
  invoice actions. The PDF prints one row per redemption and never the promo code,
  a confirmation code or an attendee name; the invoice goes to the church's own
  active billing contact.
- **The church report** (same page) shows, per church that sponsors a code on the
  event: who used the code (the registrant's name, or the covered attendee's on a per-person line, with the confirmation
  code and the code; #960), covered, invoiced (the live finalized invoice), paid and
  still owed (both from the invoice ledger), and what is not yet invoiced (or
  invoiced beyond current use). The names are read on the server by
  `getChurchCodeReport` only after the page checks `MANAGE_FINANCE`, and are added
  to the report's own line type, never to the sponsored line the invoice is built
  from.
- **Decisions (Caleb, Oct 15, 2026, #960).** (1) The staff church report shows
  attendee names: a whole-registration line shows the registrant, and a per-person
  line (#397) shows the covered attendee ("used for that person"). Names are read the
  way the rest of the app reads them: the registration's `contactSnapshot` (or the
  attendee's `profileSnapshot`) first, then the stored Person. If a covered attendee
  is later removed in an amendment, the per-person line stays billed (the adjustment
  remains) and its name falls back to the registrant's. (2) The church invoice keeps one line per sponsored registration with
  **no names**, as built; so do the PDF, the send preview and any email to the
  church. (3) The invoice code is **not** chosen by staff on attendee-paid events;
  it stays derived from the event name. (4) Audits keep ids only.
- **Audit** (`CHURCH_CODE_INVOICE_DRAFT_PREPARED`) holds ids, counts and amounts
  only. Money is integer cents throughout.
- **Not built here** (see the follow-up on issue #399): a contact-only revision of a finalized church code invoice, a CSV of the
  report. (An invoice code setting for general events is not planned: Oct 15 decision above.)

Real-database check: `npm run test:church-code-invoices`.

## Church group registration (#961)

Owner decisions (Caleb, Oct 15, 2026): a church contact (or the office) registers
several women on the roster form, and the church's code covers only the people
ticked as covered; the rest pay for themselves.

- **A church code is the registration's only code.** On a form with the per-person
  promo field (#397), several people may use the same church-sponsored code, each
  taking one use. A different church code, or any other code beside a church code,
  is refused for that person, when previewing, claiming, and in a staff per-person
  code adjustment (`PROMO_ALREADY_APPLIED`). Different ordinary (non-church) codes
  for different people stay allowed, as #397 requires, until Caleb decides otherwise.
  The rule counts only codes that validated, so a mistyped first code never blocks a
  valid one after it.
- **The tick.** The person who types the code first holds it. Once it is applied,
  every other person shows a "Covered by the code ...: name" tickbox, unticked by
  default; ticking fills their code, unticking clears it, and changing or removing the
  holder's code rewrites every ticked person to match. Unticked people pay for
  themselves.
- **Amendments.** A person added in an amendment takes no promo code (use Adjust
  amount owed in Payments).
- **Use limits count per person.** Each person who receives the code takes one use,
  so a single-use code covers one person and a multi-use code covers up to its limit.
  The code shows as used for that person on the church report (#960).
- **Contacts and accounts.** The church treasurer is the billing contact (#165); the
  invoice is emailed to them as in #399. No account is needed to register.
- **Club registrations** already cover every person on the registration and bill the
  club's church (#409); nothing changes there.
- **Not built here:** a separate non-billing church (pastor) contact in the directory.
  It is tracked in a follow-up issue (to be opened by the coordinator).

