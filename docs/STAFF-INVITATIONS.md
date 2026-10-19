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
- The preview shows the email with a placeholder where the personal link goes (never a working link) and returns a digest of
  exactly which invitations would be sent. The send must present that digest, so a changed selection or a changed list sends
  nothing; a second click within two minutes does not queue again.
- Each invitation email carries that person's personal link in its body in the outbox (the same as club invites do with their
  sign-up link). The link is a bearer link, and the exposure is limited: it allows one registration, which waits for the office,
  and the office can reissue it (every earlier copy stops working) or revoke it.
- The invite list shows Not sent, Sent, Delivery failed (from the message's own status), Registered (waiting), Approved, Declined
  and Revoked.

**Registering through a link** (public, no account)

- One registration per link: the invited person, an optional spouse, and children or dependants up to age 18 on the first day of
  the event (the server enforces it; no other relative). The person can say they need on-site housing and add a note.
- The price is $0 for the whole registration: total 0, no adjustments, no payment, so invoice and balance screens show nothing due.
  There are no meal questions: every person is recorded as `Covered (staff)`.
- Everything the registrant could later change on the private manage page that would add rooms or priced items is closed for these
  registrations. The lodging card is hidden, and saving a lodging request (the $0 direct save and the priced change request),
  roommate requests and joining the lodging waitlist are refused for the registrant (`STAFF_REGISTRATION`), so housing is only
  ever assigned by the office. Answer edits and amendments need a public form submission, which these registrations don't have,
  there is no balance to pay, and the manage link has no merchandise, meal-ticket or add-attendee path. Staff can still do all of
  these from the workspace. The private link is also redacted from request logs (`/staff-invite/` and
  `/api/public/staff-invitations/`).
- It is written in one transaction that also uses the link up, so two clicks make one registration. The registrant gets a receipt,
  and the event's internal notification addresses get one digest per 15 minutes.
- The registration carries the invitation's group on every attendee's profile (`staffGroup`).
- **The event's own questions (#1027).** The link form also asks the attendee-level questions of the event's published
  registration form (the oldest published form if there are several), for every person in the party, in the form's order.
  `modules/staff-invitations/event-questions.ts` decides which are asked, on the server. Left out: priced questions (a price, a
  choice price, a late price, a credit, an automatic fee), meal questions (the meal ticket quantity fields and anything about a
  meal, which stay `Covered (staff)`), lodging questions (housing, rooms, nights, roommates, campsites, which stay blocked for
  staff) and limited-places choices, health-type or sensitive questions (medical data never travels through a personal link),
  registration-level questions, recorded acknowledgments, addresses, directory lists, and what the page already knows (name, age,
  attendee type). A question that only applies when a left-out question is answered a certain way is left out too.
  Required questions are enforced on the server for every person; an answer to a question that is not asked is dropped, so a
  crafted request can't write a priced, meal or lodging answer, or replace `meal_coverage`. Answers are saved on each attendee's
  `formResponses`, with the form version id in the profile snapshot and the audit row. An event with no published form asks
  nothing extra.

**Approval** (`/people/staff-invitations/approvals`)

- A registration made through a link is a `DRAFT` registration until the office approves it, so a waiting one is in no count,
  capacity check, report, check-in list or room list. Approve or decline in one batch, with select-all, normally when housing is
  assigned.
- A batch is at most 200 registrations. Approve is refused unless the event has exactly one active conference-paid meal plan,
  or the office ticks "approve without meal coverage"; then the screen names who has no meals, and "Retry meal coverage" gives
  them the plan once it is fixed. A failure of any one person's entitlement never undoes an approval; it is reported by name.
- The office digest is one email per event per 15 minutes naming how many registrations wait (refreshed while it waits, so it
  counts everyone), with a link to the approval list. Cancelling a waiting registration from People marks its invitation
  declined, and a declined or never-approved registration can't be reactivated from People.
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
- **Meal counts by service (#1027).** The kitchen report (page and CSV) and the meal ticket summary CSV also show, for each meal
  service, how many approved staff, pastor and volunteer people the conference-paid plan covers, split by group. The count is read
  from the meals module's own selections (`modules/meals/staff-coverage.ts`): active conference-paid selections at an active
  service, on a submitted or confirmed registration whose invitation is approved, one count per person. A waiting registration
  (a draft with no selections) or a declined one (cancelled) is never counted, and there is no second table of counts. The
  section is left out when nobody is covered, so an event without staff keeps the same files as before.

**Re-inviting after a decline (#1027)**

- On the invite list, a person whose registration was declined, or cancelled while it waited (which settles the invitation as
  declined), has a **Re-invite** action (`MANAGE_REGISTRATION`, like copy and reissue). It makes a NEW invitation for the same
  address and group (a new id, so a new single-use link, "not sent") and marks the old one superseded; a superseded link never
  opens again. Nothing is emailed: the office selects the new invitation and uses the same preview and Send step as any other
  (`MANAGE_COMMUNICATIONS`).
- The old declined registration is not touched. It stays cancelled as history, still tied to the old invitation, so its group
  label and the staff rules (no lodging requests, no reactivation) keep applying to it, and it still shows in the approval list.
  The invite list shows the person once, by the new invitation. A person can be re-invited once per decline.
- Audited as `STAFF_INVITATION_REINVITED` with ids only (the new and old invitation, the old registration).
- Database: additive migration `20261109100000_staff_invitation_reinvite` adds `supersededAt` and replaces the plain
  one-invitation-per-address key with a partial unique index over invitations that are not superseded, plus a check that only a
  declined invitation can be superseded.

## Not built yet (follow-up slices)

- **Housing priority.** Staff, pastor and volunteer room requests should not hold rooms or count toward the public "Full" limit,
  the party cannot add extra rooms, and at assignment the office places them in the rooms left over. The invitation form only
  records "needs housing" and a note, which the approval list shows; there is no lodging step on the link yet, and the lodging
  assignment screens do not label these people. The off-site placement itself already exists (the Hotel, Airbnb, Home, Offsite
  and Other buckets of #200), so nothing new is needed there.
- **Headcount capacity.** Whether approved staff count toward the event's overall headcount capacity waits on an owner decision
  (tracked on #804). Today they do, once approved.
