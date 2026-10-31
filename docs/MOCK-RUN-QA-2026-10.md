# Mock run QA, October 2026

Audit only. This document changes no app code. It records a full mock run through
IMSDA Events on October 31, 2026, as every role, and lists what broke, what was
confusing and what needs polish, with draft issues at the end for Caleb to approve.

- **Base:** `main` at `1550114` (after the consistency work, PRs #1367 to #1372).
- **Data:** synthetic seed data only, plus records made during the run: one event
  ("Mock Run Retreat 2027", from the Women's Retreat template), one church, one
  club, one attendee account ("Quinn Mockrun", `quinn.mockrun@example.test`) and
  one promo code. No real payment, email or personal data was used. Email went to
  a local catcher on the same machine; no Square credentials were set.
- **How:** Playwright in a real Chromium browser at 1280px and 390px, against the
  production build (`next build`, `next start`) with local-only secrets. Every
  page in each role's list was screenshotted and measured (text size, tap
  targets, horizontal overflow, fixed bars, first ten focus stops, console and
  server errors). The hands-on journeys (create an event, register, pay, cancel,
  check in, schedule an email, give a club role) were run step by step.
- **Screenshots:** a small set in [`mock-run-qa/`](mock-run-qa/).

## Summary for Caleb

The core works: an event can be built from a template, published, registered
for with a promo code, checked in and cancelled, and the attendee sees the right
status throughout. Focus rings, page headings and phone layouts held up well;
no page scrolled sideways at phone width.

What would hurt on a real event day:

1. **Scheduled emails reach nobody.** No event has attendee types set up (not
   the seeded ones, not ones made from a template), so the app treats every
   attendee as "age unknown", which it handles like a child. A balance reminder
   for Women's Retreat 2026 shows "Will receive it: 0 people". Nothing in event
   setup warns about this.
2. **On a phone, Submit can silently do nothing.** Right after choosing card
   payment (with a promo code applied), tapping "Submit registration" sent
   nothing and showed no message, three times out of three. Waiting a few
   seconds first worked.
3. **Card fees are added even when card payment can't happen.** The form
   offered "Credit / debit card" and added a $4.35 card fee while online
   payment was not set up. At check-in the same person is then quoted a second
   card fee on top.
4. **Events made from a template keep last year's wording.** The 2027 event's
   form is titled "Women's Retreat 2026 registration", its web address says
   2026, and every event's private page says "Convention shirts".
5. **The form builder's test run fails without saying why.** The preview lets
   you skip required questions; the saved test is invalid, and the panel only
   says "A valid test is required".
6. **Set-up gaps nobody is told about:** email waits until a central sender is
   saved (and the Email page says "Real email is on" while also saying it
   isn't), attendees can't ask to cancel until a cancellation policy exists, and
   a new club director must set up two-step sign-in before they can open
   anything, including their own registrations.
7. **A fresh local copy can't sign staff in.** Following the README, admin
   sign-in fails because `SECRET_ENCRYPTION_KEY` is blank.

In all: 33 findings, 7 of them broken. Nine draft issues are at the end. Items 1 to 3 touch money or who receives
email, so they should not wait.

## Findings by journey

Ranked within each journey: **broken**, then **confusing**, then **polish**.
"Needs mockup" marks a design change.

### Setup (local copy)

**S1. Broken: staff sign-in fails on a fresh copy.**
- Steps: follow README "Local setup" (`cp .env.example .env`, migrate, seed),
  start the app, sign in as `admin@imsda-events.test`.
- Result: "Sign-in is temporarily unavailable." The server logs
  `SecretBoxError` from `POST /api/auth/mfa/challenge` (500). Admins must enrol a
  second factor, and sealing its secret needs `SECRET_ENCRYPTION_KEY`, which is
  blank in `.env.example:111`.
- Fix: say in the README to set `SECRET_ENCRYPTION_KEY` (any 32+ characters
  locally), or have development fall back to a fixed local key, and show "The
  server is missing SECRET_ENCRYPTION_KEY" to the operator instead of a generic
  message.

**S2. Confusing: the seed has no churches or clubs.** The Women's Retreat
template requires "Church", which can't be answered until an admin adds a
church; "Find a club" and the club portal have nothing to show. Fix: seed one
fictional church and club.

### Public visitor

Measured on home, events, event page, calendar, find a club, club forms,
registration, recovery and sign-in pages: no horizontal overflow, one h1 each,
navy 3px focus on links and buttons, purple 2px on fields, no glow. Calendar
month navigation works with the keyboard.

**P1. Confusing: a new event shows times nobody chose.** Event creation asks only
for dates, but the public page then says "Fri 7:00 AM – Sun 7:00 AM CDT"
(`/events/mock-run-retreat-2027`). Fix: ask for start and end times at creation,
or hide times until they are set.

**P2. Polish: repeated empty lanes on the home page.** "Nothing in this lane."
appears in every month (`components/public-home-page.tsx:126`). Fix: one line for
the whole row with a link to the calendar. Needs mockup.

**P3. Polish: sign-in and sign-up repeat the "Accounts are new" explanation**
twice on the same page.

### Attendee

**A1. Broken: Submit does nothing on a phone right after choosing card.**
- Steps: at 390px, open the event's form, fill steps 1 and 2, on step 3 apply
  promo `MOCK10`, choose "Credit / debit card", tick the acknowledgment, tap
  "Submit registration" straight away.
- Result: no registration request is sent (only the promo re-quote), no
  message, the page stays put. Reproduced 3 of 3 times at 390px; at 1280px, and
  at 390px after waiting about four seconds, it submitted.
- Likely cause: the price re-quote that runs when the payment method changes
  swallows the submit. Not confirmed in code.
- Fix: queue the submit until the quote finishes, or disable the button with
  "Updating total…" while it runs.
- Screenshot: [`registration-card-fee-390.png`](mock-run-qa/registration-card-fee-390.png)

**A2. Broken: card fee charged when card payment is not available.**
- Steps: with Square not configured, register and choose "Credit / debit card".
- Result: the total adds "Card processing $4.35" ($139.35). After submitting,
  the private page says "Pay the balance below" with nothing below
  (`modules/public-access/domain.ts:245`), and "Continue payment" on the account
  opens "Online payment is not available yet". At check-in the roster says
  "$139.35 due · Card in Square app: $143.23 (includes $3.88 card fee)", a
  second fee on a total that already has one, and "Cash or check is the balance
  shown", so a cash payer is asked for the online card fee.
- Fix: hide the card choice and fee when online payment is off; at check-in,
  quote cash without the online card fee. Money correctness, so not deferrable.
- Screenshots: [`registration-card-fee-390.png`](mock-run-qa/registration-card-fee-390.png),
  [`checkin-double-card-fee-390.png`](mock-run-qa/checkin-double-card-fee-390.png)

**A3. Broken: an event made from a template shows last year's form name.** The
form title "Women's Retreat 2026 registration", the web address
`/register/mock-run-retreat-2027/women-s-retreat-2026-registration` and the
confirmation "Your Women's Retreat registration has been received" all came over
unchanged to Mock Run Retreat 2027. Fix: name the copied form after the new event
(or prompt for it) when the event is created. Related to #137.
Screenshot: [`event-page-old-form-title-390.png`](mock-run-qa/event-page-old-form-title-390.png)

**A4. Confusing: "Convention shirts" on every event.** The private registration
page's shirt section is headed "Convention shirts" on a retreat
(`components/public-shirt-size-confirmation.tsx:127`). It also marks a size the
registrant already chose as "Needs confirmation". Fix: "Shirt sizes", and treat a
size chosen on the form as confirmed (or say why it must be confirmed again).

**A5. Confusing: no way to ask to cancel.** Without a cancellation policy the
request panel is hidden entirely (`app/(public)/manage/[token]/page.tsx:397`,
`modules/cancellation-requests/repository.ts:240`), so the attendee sees only
"The event team can help with cancellations". Events from templates have no
policy and setup never mentions it. Fix: show the "not available yet, contact
the team" line, and add the policy to the publish checklist.

**A6. Polish: the plain-text email is raw Markdown.** The text part of
"Registration received" shows `# We received…`, `**Confirmation code:**` and
`[View, pay, or edit your registration](…)`. The HTML part is fine. Fix: render
the text part as plain text.

**A7. Polish: a raw error if the hidden spam field is filled.** If anything
(a form-filling tool, an aggressive autofill) fills the hidden "website" field,
the registrant sees `Invalid input: expected ""`. Fix: a plain message.

The account pages worked well: sign-up with an emailed code, the registrations
list, "Nothing due now" after cancellation, and the keyboard-only church picker.

### Event staff

Measured on 24 staff pages at both widths: no overflow, no errors, one h1 each.
Uppercase 12px labels (eyebrows, table headers) are deliberate
(`app/globals.css:85-88`, `--type-label-floor`), so they are not listed.

**E1. Broken: scheduled emails reach nobody.**
- Steps: Emails, Scheduled emails, New schedule, "Balance reminder", a date,
  "Registration contact", Review schedule. Tried on Women's Retreat 2026 (seed)
  and on Mock Run Retreat 2027 with one adult registration.
- Result: "Will receive it: 0 people", "Youth are not sent scheduled email…: 1"
  for an adult, and "Nobody in this audience can receive this message, so it
  cannot be saved or approved."
- Cause: no event has attendee types (`EventAttendeeType` is empty for all
  three seeded events and the new one), so every attendee has no type, and "No
  type definition at all is unknown, which is never an adult"
  (`modules/communications/scheduled-email-repository.ts:238-240`).
- Fix: give templates their attendee types, list "attendee types" in publish
  readiness, and say "age unknown: set attendee types" instead of "youth".
  Who-receives-email correctness, so not deferrable.
- Screenshot: [`scheduled-email-zero-recipients.png`](mock-run-qa/scheduled-email-zero-recipients.png)

**E2. Broken: the builder's test run fails silently.**
- Steps: Registration forms, Preview & test, fill only some fields, Continue
  through each step, Run test submission.
- Result: Continue moves past empty required questions (church, shirt size,
  meal, ranked sessions); the test is saved as invalid ("Church is required." and
  others are stored); the panel says only "1 test submission. A valid test is
  required before this form's first publish", and Publish stays disabled. It took
  five tests to find out what was missing.
- Fix: validate each preview step like the public form, and list the failed
  test's reasons in the panel.

**E3. Confusing: publish readiness mixes signals.** "1 of 4 ready" sits next to
"It needs one thing first: the event location is missing", while support
contact and a published form are also unticked. Fix: split "required" from
"recommended" and add email sender, attendee types and cancellation policy
(see E1, A5, X2). Needs mockup.

**E4. Confusing: check-in and cancel don't warn.** Checking in a registration
with $139.35 unpaid took one tap with no prompt (Undo is there). Cancelling the
same registration after check-in gave no "already checked in" warning. Fix: a
one-line warning in both places.

**E5. Confusing: "Narrow the audience" expects URL syntax.** The help says "for
example status=CONFIRMED&payment=UNPAID". Fix: the same filter dropdowns the
People list uses. Needs mockup.

**E6. Confusing: the event admin's "no access" message is wrong.** Opening
`/event-setup` or `/admin/event-templates` as an Event Admin lands on
`/no-access`: "does not have an active event assignment", while the same person
is working in Women's Retreat 2026 (`app/no-access/page.tsx:16`). Fix: "Creating
events needs a system administrator."

**E7. Confusing: search works three different ways.** Check-in filters as you
type; the attendee list needs Apply; Clubs and churches needs "Filter". All
return to the full list when cleared. Fix: follow the shared search field
behavior from `docs/CONSISTENCY-AUDIT-2026-10.md`.

**E8. Confusing: one area, four names.** Sidebar "Emails", tab "Messages", header
"Messages & announcements", page "Scheduled emails". The duplicate finder's page
heading is "Registrations" (`/people/duplicates`).

**E9. Polish: the promo code field's pattern is invalid.**
`pattern="[A-Za-z0-9][A-Za-z0-9_-]{2,31}"` (`components/promo-code-workspace.tsx:455`)
is rejected by the browser ("Invalid character in character class"), so the
browser check is skipped and a console error is logged. The server still
validates. Fix: escape the hyphen (`[A-Za-z0-9_\-]`).

**E10. Polish: wording.** "1 codes" (promo codes), "Same as central. Same as the
platform default…" (event timezone), the template list is unordered and
defaults to Hispanic Institute, and long notes in jargon on the builder
("Never kept: long-text, address and calculated fields; …").

**E11. Polish: two stacked bars on the phone builder.** At 390px, "Preview /
Create new version" sits above the bottom tab bar, about 150px together, and
cards scroll under them. Check that the last card can be scrolled clear.

### Club leader

**C1. Confusing: a new director is locked out until two-step sign-in is set
up, and nobody tells them.**
- Steps: as system admin, club page, Club admins, give Quinn "Director". Then
  sign in as Quinn.
- Result: the admin sees "Role given. They will see this club under My club on
  their account." (`components/club-directors-workspace.tsx:88`). Quinn is sent
  to "Set up two-step sign-in" for every account page, including their own
  registrations, until an authenticator or passkey is added. The gate page
  calls it "two-step sign-in" and "Two-factor authentication" side by side.
- Fix: the admin notice should say the person must set up two-step sign-in, the
  director should get an email saying so, and the gate should only cover club
  and medical pages, not the person's own registrations.

**C2. Confusing: no way to add a leader from the leaders list.** "Club leaders"
(`/admin/clubs/leaders`) says "No club has a current Director…" with no add
button; "Club invites" says "Import clubs to create them" next to a disabled
"Send all unsent (0)". The place to do it is the club page, then "Club admins".
Fix: an "Add a leader" link on both pages.

Once two-step sign-in was on, the club portal opened for the new, empty club.
Measured on 22 club and account pages at both widths: no errors, no overflow,
one h1 each, and every club tab reachable with Tab. The home page gives a clear
first step ("Add your club members to this year's roster" with "Add people"), and
the roster's "Add to roster" dialog opens and closes cleanly (not submitted).

**C3. Confusing: a club made today is shown as behind.** Monthly Records says
"September 2026 · Missing · was due October 10" and Year-End says "Pathfinder
year 2025-26 · Not filed · was due April 1, 2026" for a club created on
October 31. Fix: skip periods before the club joined, or say "Not due for this
club".
Screenshot: [`club-new-director-390-and-records-1280.png`](mock-run-qa/club-new-director-390-and-records-1280.png) (right)

**C4. Confusing: club tabs cut off on a phone.** At 390px the tab row shows Home,
Roster, Forms, Club events and half of "Honors"; Class tracking, Monthly Records,
Orders, Health and Club settings are off-screen with no scroll cue. Fix: a fade or
arrow at the edge, or wrap to two rows. Needs mockup. Related to #1112.
Screenshot: same file (left).

**C5. Confusing: names don't match.** Tab "Orders" opens a page labelled "Club
supplies"; "Club settings" opens "Club team"; old links (`/reports`, `/notes`,
`/supplies`, `/awards`, `/exports`, `/team`, `/profile`) redirect to differently
named pages. The empty roster shows two "Add to roster" buttons and "Request a
transfer".

**C6. Polish: club tab focus is purple.** Club tabs show a 3px purple outline on
focus; the rule is navy for links and buttons, purple for fields and the
current-tab underline.

### System admin

**X1. Broken: the Email page contradicts itself.** The heading "Real email is on
for every event" (`components/email-delivery-section.tsx:126`) sits above the red
"Central sender not set; emails are waiting". After "Save sender", the success
message appears but the red alert stays until the page is reloaded.
Screenshot: [`admin-email-contradiction.png`](mock-run-qa/admin-email-contradiction.png)

**X2. Confusing: registration emails wait silently.** Until a central sender is
saved, confirmation emails queue without a word on the event's setup page; the
outbox sweep reports "Set the central sender email on System management > Email
before sending real email." Fix: show it in event publish readiness (see E3) and
on the admin home.

**X3. Confusing: summary cards read as fragments.** On `/admin`: "2 / Upcoming
events / Next starts in 133 days / events. Not archived and not ended, so an
event in progress counts. Read at 6:02 AM UTC." Fix: start the note with a
capital sentence; one "Updated" time for the page, in Central time, not UTC on
every card.

**X4. Polish: "View all 0 clubs"** shows under "No active clubs"
(`app/(workspace)/admin/clubs/page.tsx:186`), and "View all 1 clubs" after one is
added. Fix: hide at 0; singular at 1.

**X5. Not tested: Test connections.** It records a check result row, so it was
left alone; #1383 already covers the Square and email testers.

Adding a church and a club, giving a club role and saving the sender all worked
and showed clear success messages.

### Keyboard and rules checks

- Keyboard only: calendar month navigation, the registration church picker
  (Enter, type, Down, Enter), and Tab order on the sign-in and two-step pages
  all work.
- Focus: links and buttons show a 3px navy outline (gold on the sidebar), fields
  a 2px purple outline, no glow. The sidebar's current page keeps its inset gold
  bar while focused; that is the current-page marker, not a focus glow.
- Tap targets at 390px: no misses on the measured pages. Desktop sizes under 44px
  (sidebar links, "Forgot password?") are outside the rule, which applies to
  phones (`scripts/verify-mobile-layout.ts:142`).
- Fixed bars: none covers text on the measured pages; see E11 for the phone
  builder.
- Errors: no server errors and no console errors in the production build except
  the promo pattern (E9). A dev-only hydration warning appeared on
  `/more/event-settings`.

## Already tracked

- #137 Event templates as data: related to A3 and E1 (templates carrying the
  right wording and attendee types).
- #1112 Director portal: related to C1 and C2.
- #1114 Design review (public calendar, club finder): related to P2.
- #1342 and the consistency follow-ups: E7 extends them.
- #1383 System report testers: covers X5.

## Draft issues

Not created. In priority order; each is sized for one build.

### 1. Scheduled email: attendees without a type are treated as youth

- Give the Women's Retreat, Camp Meeting and other starter templates their
  attendee types when an event is created from them.
- Add "Attendee types set" to event publish readiness.
- In the schedule review, say "age unknown (no attendee type)" instead of
  "Youth", with a link to attendee configuration.
- Seed attendee types for the three seeded events.
- Test: an adult registration on a templated event is counted in "Will receive it".

### 2. Registration: Submit ignored while the total is re-quoted (phone)

- Reproduce A1 in a test (card plus promo, submit during the re-quote).
- Queue or block the submit until the quote settles; show "Updating total…".
- Never let a tap on Submit end with no request and no message.

### 3. Card fee only when card payment is possible

- Hide the "Credit / debit card" choice and its fee when online payment is not
  configured for the event.
- Remove "Pay the balance below" when there is nothing below.
- Check-in: quote cash and in-person card without the online card fee already in
  the total. Run `rg` on the fee helpers in `scripts/` and update the pricing
  scripts.

### 4. New event from a template: rename what carries last year's name

- Name the copied form and its web address after the new event.
- Replace event-specific confirmation text from the template ("Your Women's
  Retreat registration…") with the new event's name.
- "Convention shirts" becomes "Shirt sizes"; a size picked on the form is not
  "Needs confirmation".
- Ask for start and end times when creating an event (P1).

### 5. Form builder: preview validates each step and failed tests explain why

- Preview steps block Continue on empty required questions, like the public form.
- The test panel lists the last failed test's reasons.

### 6. Event publish readiness covers what silently blocks attendees (needs mockup)

- Split required from recommended.
- Add: central email sender saved, cancellation policy set, attendee types set.
- Show the attendee "cancellation not available, contact the team" line when no
  policy exists.

### 7. Email page and admin home copy

- The Delivery & sender heading reflects the real state; the "not set" alert
  clears after saving.
- `/admin` summary card notes read as sentences; one Central-time "Updated" line.
- "View all 0 clubs" hidden; "1 clubs" and "1 codes" plurals.

### 8. Club director onboarding

- The "Role given" notice and an email to the person say two-step sign-in is
  needed first.
- The two-step gate covers club and medical pages only, not the person's own
  registrations (needs a decision: confirm with Caleb).
- "Add a leader" links on Club leaders and Club invites.
- One name on the gate page: "two-step sign-in".
- Monthly Records and Year-End skip periods before the club joined (C3).
- Club tab row on phones shows that more tabs exist (C4, needs mockup; may fold
  into #1112).
- Tab names match page names (C5).

### 9. Small fixes

- README: set `SECRET_ENCRYPTION_KEY` for local sign-in, or a development
  fallback key with a clear operator error (S1).
- Seed one fictional church and club (S2).
- Promo code `pattern` escape (E9).
- Event admin no-access copy for event creation (E6).
- Plain-text email part without Markdown (A6); plain message for the spam-field
  rejection (A7).
- Check-in and cancel warnings (E4).
