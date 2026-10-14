# Staff, pastor and volunteer invitations (#804)

Camp Meeting staff, pastors and the volunteers the office chooses register for free, together with their immediate family. The
office imports a CSV of email addresses, each address becomes one personal link, a person sends the invitations, and the
registrations that come back wait for the office to approve them in one batch. The decisions behind this are on issue #804
(Caleb, Oct 6 and Oct 14, 2026).

## What is built

**Import** (`/people/staff-invitations`, registration managers and event administrators)

- A required `email` column, and optional `first name`, `last name` and `group` (Staff, Pastor or Volunteer). A file with no group
  column, or a blank group cell, uses the group the office picks for the whole file. At most 500 people per file.
- The preview reports every row: invalid email, group not recognized, repeated in the file (the first one is used), already
  invited, already registered. Nothing is created and nothing is sent by a preview. Confirming re-reads the file and creates only
  the "will be invited" rows; if the list changed since the preview (its digest), it refuses and asks for a new preview.

**Personal links**

- One invitation per address per event. The link is `/staff-invite/<id>.<signature>`. It is never stored: the signature is an
  HMAC of the invitation id and its `linkVersion` under `MANAGE_LINK_DERIVATION_SECRET` (with its `_PREVIOUS` rotation partner), so
  the office can copy the same link again, and a **reissue** (which bumps `linkVersion`) makes every earlier copy stop working.
  **Revoke** turns a link off; a revoked link can be reissued. A person who has registered can be neither revoked nor reissued.
- The page and its API are `no-store`, `noindex` and send no referrer. A link that does not work for any reason (wrong, replaced,
  revoked, event unpublished or over) shows the same words.

**Sending** (needs `MANAGE_COMMUNICATIONS`)

- Select people (filters and select-all), choose Send or resend, read the exact email and the count, then Send. This only queues
  one message per person in the event's outbox (`CUSTOM_MESSAGE`, `metadata.trigger = STAFF_INVITATION_SENT`); the outbox worker
  delivers, captures or suppresses it according to the event's message settings. Nothing in the app calls this on its own: not the
  import, not a schedule.
- The send must match the count the preview showed, and a second click within two minutes does not queue again.
- The invite list shows Not sent, Sent, Delivery failed (from the message's own status), Registered (waiting), Approved, Declined
  and Revoked.

**Registering through a link** (public, no account)

- One registration per link: the invited person, an optional spouse, and children or dependants up to age 18 on the first day of
  the event (the server enforces it; no other relative). The person can say they need on-site housing and add a note.
- The price is $0 for the whole registration: total 0, no adjustments, no payment, so invoice and balance screens show nothing due.
  There are no meal questions: every person is recorded as `Covered (staff)`.
- It is written in one transaction that also uses the link up, so two clicks make one registration. The registrant gets a receipt,
  and the event's internal notification addresses get one digest per 15 minutes.
- The registration carries the invitation's group on every attendee's profile (`staffGroup`).

**Approval** (`/people/staff-invitations/approvals`)

- A registration made through a link is a `DRAFT` registration until the office approves it, so a waiting one is in no count,
  capacity check, report, check-in list or room list. Approve or decline in one batch, with select-all, normally when housing is
  assigned.
- Approve makes it `CONFIRMED`, queues the registrant's confirmation in the outbox (not sent from the request), and gives every
  person in the party the event's conference-paid meal plan through `entitleAttendeeToPlan` (#905/#916: every meal, one ticket per
  service, charged to no one; the café scan and its CSV are unchanged). If the event does not have exactly one active
  conference-paid plan, meals are skipped and the screen says so.
- Decline cancels the registration through the ordinary cancellation (which queues its usual notice). A declined person's link
  cannot be used again.

**Where the group shows**

- People: a Staff / Pastor / Volunteer chip on the registration card and in the detail, a "Waiting for office approval" status and
  filter.
- Attendee listing: a Group column (also in the CSV).
- Kitchen report: a count per group of people whose meals the conference covers, no names.

## Not built yet (follow-up slices)

- **Housing priority.** Staff, pastor and volunteer room requests should not hold rooms or count toward the public "Full" limit,
  the party cannot add extra rooms, and at assignment the office places them in the rooms left over. The invitation form only
  records "needs housing" and a note, which the approval list shows; there is no lodging step on the link yet, and the lodging
  assignment screens do not label these people. The off-site placement itself already exists (the Hotel, Airbnb, Home, Offsite
  and Other buckets of #200), so nothing new is needed there.
- **Exact kitchen counts from meals.** The kitchen report counts people by group; counts of meals per service come from the meals
  module and the café scan (#916), not from this report.
- **Event-specific questions.** The link uses its own short form (people, housing note). The event's published registration form
  is not used, so questions such as shirt sizes are not asked.
- **Re-inviting after a decline**, and a bulk "retry meal coverage" button for an approval whose meal entitlement failed (the
  Meals screen can entitle a person by hand).
