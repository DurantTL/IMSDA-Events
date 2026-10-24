# Shirt sizes: boundary and retirement path

Status: shirt-size collection works as it always has. This document records where the
bespoke subsystem lives (#104) and how it is retired once merchandise variants
(#54, #148) replace it. Nothing here is a schedule; each step is gated on the one
before it, and every step that touches stored data is a human decision.

## What the subsystem is

A per-event switch plus a per-attendee answer, with its own request email:

| Piece | Where | Stored? |
| --- | --- | --- |
| Per-event switch | `Event.collectsShirtSizes` (Boolean, default false) | Yes, a column; copied by event clones; set by event starters |
| The answer | `shirt_size` and `shirt_size_confirmed_at` keys in an attendee's form responses | Yes, in registration history |
| Size list, schemas, response readers | `modules/registrations/shirt-sizes.ts` | No (code) |
| Reviewed request audience | `modules/communications/shirt-size-audience.ts` | No (recomputed and fingerprinted at preview time) |
| Request template | `SHIRT_SIZE_REQUEST` (enum value, `MessageTemplate` rows and versions) | Yes |
| Batch audit actions | `SHIRT_SIZE_REQUEST_BATCH_ENQUEUED` (activity log) and the `STAFF_SHIRT_SIZE_REQUEST_BATCH` send trigger | Yes, in history |
| Staff batch screen | Communications, "Shirt sizes" view | No |
| Public reconfirm | `POST /api/public/manage/[token]/shirt-sizes` and `components/public-shirt-size-confirmation.tsx` | Writes the response keys above |
| Command line audit | `npm run event:shirt-sizes -- --event <slug>` (`scripts/shirt-size-audience.ts`) | Read only |
| Badge and packet columns | check-in badges and `Event.operationalPacketConfig.sections.shirtSize` | Read only |

## The boundary

All code outside the two legacy modules reaches them through the merchandise
directory:

- `modules/merchandise/legacy-shirt-size-compat.ts`: size options, schemas,
  `shirtSizeFromResponses`, `shirtSizeConfirmedAtFromResponses`,
  `eventCollectsShirtSizes`, and `legacyShirtSizeForAttendee` (the reader the
  packets use).
- `modules/merchandise/legacy-shirt-size-audience-compat.ts`: the request audience
  builder. Kept separate because it uses Node crypto and must not enter client
  bundles.

`tests/shared-module-event-neutrality-155.test.ts` fails when any file under
`modules/`, `components/`, `app/`, `lib/` or `scripts/` imports
`registrations/shirt-sizes` or `communications/shirt-size-audience` directly.
Tests of the legacy modules themselves are exempt. Reading the Prisma column
`collectsShirtSizes` in selects, event settings, clones and starters is plain
event configuration, not a use of the legacy modules, and stays until step 5.

## Migration path to merchandise variants

Each step is its own issue and PR. Do not combine them.

1. **Prove merchandise sizes (#148 and the catalog work in #54).** A shirt is a
   `MerchandiseProduct` whose `MerchandiseProductVariant` labels are the sizes
   ("Youth S" ... "Adult 5XL"), with availability (price, which may be zero, and
   inventory policy `UNLIMITED` or `TRACKED`) from `MerchandiseVariantAvailability`.
   Exit criterion: a pilot event collects sizes entirely through an order, with
   the same Youth/Adult list, per attendee, and staff can read a per-size count.
2. **Switch the readers inside the boundary.** Change what
   `legacyShirtSizeForAttendee` and `shirtSizeFromResponses` return: read the
   attendee's merchandise order line variant first, and fall back to the
   historical `shirt_size` answer for events that predate merchandise. Callers do
   not change; this is the point of the boundary. Packets, badges, the readiness
   report and the public manage page follow automatically.
3. **Replace the request flow.** The staff batch (audience, template, command
   line script) becomes "remind unfulfilled merchandise" using the standard
   merchandise messaging, not a dedicated path. Keep `SHIRT_SIZE_REQUEST`
   templates and the `SHIRT_SIZE_REQUEST_BATCH_ENQUEUED` history readable after
   the batch stops being sendable (see "Stored identifiers").
4. **Stop new use.** A new event no longer offers the `collectsShirtSizes` switch
   (settings field and starter flag hidden); clones copy it only when the source
   has it on. Existing events keep working until they finish.
5. **Remove code.** Once no open or upcoming event has `collectsShirtSizes` on and
   a human has confirmed that, delete in this order: the staff "Shirt sizes" view
   and batch repository code, the audience module and its compat file, the
   request template default text, `scripts/shirt-size-audience.ts` and the
   `event:shirt-sizes` script, the public reconfirm route and component, then the
   registrations module and its compat file. The guard test's boundary section is
   deleted with the last compat file.
6. **Retire the column (human-gated).** Drop `Event.collectsShirtSizes` only in a
   later, separately approved migration, after the readers no longer select it.
   Migrations stay additive until then; no data is rewritten.

## Stored identifiers: keep, do not rename

- `SHIRT_SIZE_REQUEST` is a Postgres enum value (`MessageTemplateKey`) and is
  referenced by stored `MessageTemplate` rows. Enum values are not renamed. After
  the flow is retired, hide it from the editable template list, keep the value.
- `SHIRT_SIZE_REQUEST_BATCH_ENQUEUED` and `STAFF_SHIRT_SIZE_REQUEST_BATCH` appear
  in activity and message history; keep their labels so old rows still render.
- `shirt_size` and `shirt_size_confirmed_at` response keys live in historical
  registrations. They are never rewritten. The step 2 fallback keeps reading them.
- The migration from historical answers into merchandise orders, if ever wanted,
  is a production data change and needs a human decision. It is not required for
  the steps above.

## Human gates

Pricing (paid shirts), capacity or inventory, bulk communications (the request
batch and its replacement), and any production data migration are human-approved.
Automation prepares reviewable code and runbooks only.

## Known event-specific leftovers (not part of this retirement)

Shared code still carries event-specific names and copy from the 2026 event
systems. They were left alone on purpose and are tracked here so a pull request
can name them:

- The Camp Meeting presets (`prisma/seed-data/event-content/camp-meeting-meals.json` and the Camp Meeting
  defaults in the meals, lodging, cancellation-policy and event-template
  starters).
- The WR26 importer copy (`modules/imports/wr26-bundle.ts`,
  `modules/imports/google-sheets.ts`, `components/import-workspace.tsx` and
  `scripts/imports/README.md`). It describes a one-time legacy import.
