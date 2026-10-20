# Registration PDF (#1082)

An easy-to-read PDF copy of a registration: the whole registration laid out like the form, attached to the registrant's
confirmation and the staff "new registration" copy, and re-sent marked **Updated** when a director or staff change it.
Decisions: Caleb, Oct 20, 2026 (ages only; whole registration; Spring Camporee club registration is the model).

## What it shows

- Event, club (or registrant), dates, location, submitted date.
- Each form section in order: registration-level answers as label and value rows; the section's attendee questions as a
  roster table (one row per person, "Name" and "Age" first). A roster with more than six columns is laid out one person
  per block. Conditional questions appear only when they applied.
- Fees: the line items, total, what was paid and the amount owed **when the copy was made**. A church-billed
  registration shows the per-person price only, never a total (#621), the same rule as the confirmation email.
- Built from the published form version the registration is on (the stored submission's version), so a registration made
  on an older form version (PBE, #1044/#1050) shows that version's questions.

## What it never shows

- A field marked sensitive, a field that reads as health, medical, insurance, dietary, guardian or custody wording (even if
  staff turned "sensitive" off), and any follow-up question that depends on one.
- A birth date. Only the age the registration saved (the age field, else the roster's age on the event date).
- The payment-method answer, the promo code, calculated prices (they are in Fees), the confirmation code, private links,
  card details. Protected health records are never read.

## Versions, storage and sending

- `RegistrationPdfDocument`: one row per version; the bytes are a `MessageAttachment` made once and never regenerated.
  `sha256` is checked at send (the outbox) and at download. A version is added only when what the PDF says changes
  (`contentHash`, which ignores payments), so a no-op save sends nothing.
- Version 1 is made in the submit transaction and attached to the registrant's confirmation and the staff copy (not to a
  waitlist notice). Every amendment (`amendRegistration`: director, staff, group contact, cancellation execution) makes
  the next version marked **UPDATED**, attaches it to the registrant's "Registration updated" email, and re-sends the
  staff copy ("Updated: New registration ...") to the same team addresses. The staff-copy switch
  (`NEW_REGISTRATION_STAFF_COPY`) governs the Updated staff copy too.
- Every send goes through the effective delivery decision (#1043): a paused event captures the messages, nothing is sent.
- Over 10 MB: no PDF is stored and the messages go without it (logged).
- Not in scope here: the several-notifications-per-form hook and section filtering (#1081); it can attach the same PDF.

## Download

- Staff (MANAGE_REGISTRATION): `GET /api/events/{eventId}/registrations/{registrationId}/pdf`, the registration's Download
  registration PDF button. A registration changed by a path that sends no notice (a self-service answer) gets its new
  version on the first download.
- Director: `GET /api/attendee/clubs/{organizationId}/events/{eventId}/registration/pdf[?team=key]`, the club event page.

Samples with made-up names: `docs/samples/registration-pdf-sample.pdf` (Spring Camporee, church-billed) and
`docs/samples/registration-pdf-sample-updated.pdf` (self-pay, Updated mark, totals). `tests/registration-pdf-sample.test.ts`
fails when they are out of date; remake with `WRITE_REGISTRATION_PDF_SAMPLES=1`.
