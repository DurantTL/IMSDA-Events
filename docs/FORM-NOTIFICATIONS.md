# Registration form notifications (#1081)

Several notification emails per registration form, routed by one answer (the location, the club, or a registration-level
question) and limited to chosen sections of the registration PDF. Decisions: Caleb, Oct 20, 2026.

## What a form can have

- Up to **10 notifications per form**, each with a name and **1 to 10 typed addresses**. Registrants never choose who is
  notified.
- An optional **condition**: one `field / is (or is not) / value` row, the same shape as a field's own condition. The
  location is one of the choices (`__location`, the value is an event location id), and so is the **club** (`__club`, #1097;
  see "Routing by club" below). Only registration-level questions
  the PDF would print can be used: a sensitive answer is never offered, because who gets an email would reveal it.
  All/Any conditions (#1072) are not built here.
- The **sections** it includes: none chosen means the whole registration, with the fees. A copy with chosen sections has
  only those sections and no fees.
- Edited in the registration form builder, in the form's **Notifications** panel (plain, until the builder redesign #1062
  is reviewed). Event administrators and system administrators only (`CONFIGURE_EVENT`, checked in
  `app/api/events/[eventId]/forms/[formId]/notifications/route.ts`). Saved on its own, with no new form version. The
  audit entry `REGISTRATION_FORM_NOTIFICATIONS_CHANGED` holds ids and counts only, never an address, name or value.
- The platform switch **Registration form notifications** (System management, Email, Staff alerts) turns the whole thing
  off. The event's staff list and the registrant's confirmation are separate and unchanged. The club's own copy is the
  registrant confirmation (it carries the PDF); no notification is needed for it.

## When it sends

- **On registration** (not for a waitlist notice): inside the submission transaction, one message per address of every
  notification whose condition matches is queued **held** (`modules/registration-form-notifications/queue.ts`,
  `registrationPdfHoldUntil`). After the commit (`after-commit.ts`, `finishFormNotificationsAfterSubmit`) each
  notification's PDF is built, filtered to its sections, attached to its messages, the baseline is recorded and the hold is
  released. A PDF failure releases the messages without it and never fails the registration.
- **On a later change** (a director's or staff amendment, an added attendee, a substitution; called from
  `finishRegistrationChange`): after the commit, each notification whose condition matches **now** and whose **included
  sections changed** since it last sent is sent again, subject "Updated: ...", with the new filtered PDF marked Updated. What
  "changed" means is `notificationContentHash`: the model's sections and fees, with the header (event, form, registrant, club,
  location) left out, so a location change does not re-send a notification whose sections did not change.
- **A location or club change** also sends the new location's notification: it matches now, has not sent for this registration, so it
  goes as a first notification. The old location's notification stops matching and sends nothing. A club change behaves the same way (#1097).
- A notification made **after** a registration never starts for it (it was not owed), and editing a notification's sections
  starts a new baseline rather than an "Updated".
- What each notification last sent is `RegistrationNotificationDelivery` (hash and section signature only).

## Routing by club (#1097)

- The **Club** condition (`CLUB_CONDITION_KEY`, `__club`) sits beside Location in the Notifications panel: "Send when Club is /
  is not *club*". The value is a club **organization id**, picked by name from a searchable list of the directory's active
  clubs (`type: CLUB`). The panel shows the club's name, never the id. It is offered when the event is a club event
  (`audience: CLUB`, so its registrations carry a club) or when a notification already routes on a club.
- **Validated on save, on the server** (`replaceFormNotifications`): the value must be the id of an existing organization of
  type `CLUB`; an unknown id, or the id of a church, company or other non-club organization, is refused (400, "choose one of
  the clubs in the directory"). The client's list is never trusted. The audit entry still holds no condition value.
- **Matching** (`notificationApplies`) reads the registration's club (`ClubEventRegistration.organizationId`; the submission
  passes the club it registered for). A registration with **no club** (a Group registration, say) never matches "is" and
  always matches "is not".
- **A club change** (a transfer, say) re-routes like a location change: the new club's notification matches now and has not
  sent for this registration, so it goes as a first notification; the old club's stops matching.
- **A club that no longer exists** (the organization was deleted, or is no longer a club): the panel shows "(club removed)" and
  a warning, and the notification is **skipped** (its id is logged), never sent unconditioned, the same as
  `conditionStillAllowed`. `existingConditionClubIds` looks the stored clubs up in one query, and none when no notification
  routes on a club. An inactive club that still exists keeps routing.

## Delivery and privacy

- Every message is an `INTERNAL` outbox row (`trigger: REGISTRATION_FORM_NOTIFICATION`) and goes through the event's
  effective delivery (#1043): a **paused event** records it SUPPRESSED (never held) and does not advance what was "sent", so a
  later change after resuming still tells the people; an event with no mail configured captures it.
- The switch is read before any transaction (`tests/notifications-no-read-in-transaction-1016.test.ts`).
- The email is a short summary (event, form, who registered, location, which notification, which sections). It never carries
  an answer. The PDF follows `docs/REGISTRATION-PDF.md`: sensitive fields (by `resolveFieldFlags` with the real section
  title, except the `PRINT_EVEN_IF_SENSITIVE` allowlist), birth dates, card details, codes and links are never in it.

## Known behavior

- A registration that was never announced (a waitlist registration that is later promoted; promotion sends no notice) gets its
  first notification on a later change that sends, not at promotion.
- A location switched A, then B, then A does not notify A again: A's notification already sent for this registration and its
  sections did not change. Only a change in A's included sections re-sends it.
- A stored condition is re-checked when the email is queued. If its question is now sensitive, sits in a health section,
  follows a sensitive question or is gone, that notification is skipped (its id is logged, nothing else) and the panel shows a
  warning on it. It is never sent unconditioned.
- Sections and the condition's question are checked against the form's latest version when saved. The panel warns when they
  exist only in an unpublished draft. At send time a condition must be allowed in the registration's own version AND in the
  latest published one, or the notification is skipped. If none of a notification's chosen sections are in the version the
  registration was made on, the summary email goes with NO PDF and says so; it is never widened to the full registration.
- A notification with no section filter attaches the stored registration PDF (#1082) only when its Updated mark and content match
  this send (read only: this path never makes a #1082 version), else it renders its own copy; filtered ones store one PDF per distinct
  set of sections per send. A paused event, or a retry of the same change, stores no PDF.
- The retry-failed guard (`modules/communications/retry-failed.ts`) keys a form notification by notification and address, so
  a later send of the staff copy or of another notification never counts as proof that this one was delivered, and the reverse.

## Not built

- All/Any conditions (#1072); more than one condition per notification.
- Promoting a waitlisted registration does not send its notifications (no notice is sent at promotion).
- A mobile layout audit run of the panel needs a seeded database and the audit script; not run in this build.
