# Ledger module (slice 1 of #74, issue #117)

An append-only record of every charge, discount and credit on a registration. Slice 1 runs it in **shadow mode**:
nothing user-visible reads it, `Registration.totalAmount` is still written exactly as before and stays authoritative,
and a health view proves the two agree. Later slices (payments, allocations, refunds, adjustments, cutover) build on it.

## Model: `RegistrationLedgerEntry`

| Column | Meaning |
| --- | --- |
| `eventId`, `registrationId` | Both cascade on delete (a deleted registration or event takes its entries with it). |
| `kind` | `CHARGE`, `DISCOUNT` or `CREDIT`. |
| `amountCents` | Integer cents, **signed**: `CHARGE >= 0`, `DISCOUNT <= 0`, `CREDIT <= 0` (a database `CHECK`). A registration's total is the plain sum of its entries. |
| `currency` | `USD` unless the form says otherwise. |
| `pricingSnapshot` | Required JSON: the pricing facts behind the entry (line items, totals, the promo rule, before and after totals for an amendment). |
| `sourceType`, `sourceId` | `REGISTRATION_SUBMISSION` (the registration id), `AMENDMENT` (the `RegistrationOperation` id) or `PROMO_REDEMPTION` (the `PromoCodeRedemption` id). |
| `origin` | `LIVE` (written with the change) or `BACKFILL` (reconstructed by the script). |
| `actorType`, `actorId`, `actorNameSnapshot` | An immutable snapshot of who made the change. **No foreign keys**: `SET NULL` would be an UPDATE, and removing a user must not rewrite history. |
| `reason`, `createdAt` | Optional free text (an amendment's reason) and the time. |

`(sourceType, sourceId, kind)` is unique. It is the idempotency key live writes and the backfill share, so a re-run never
duplicates. Indexes: `(registrationId, createdAt)` and `(eventId)`.

## Money and the conversion boundary

The ledger holds integer cents, the representation the application reasons in. `Registration.totalAmount`,
`Payment.amount` and `Refund.amount` are `Decimal(12,2)`. The **only** place a Decimal becomes cents is
`moneyToCents` (`modules/payments/square-domain.ts`), applied when the reconciliation or the backfill reads
`Registration.totalAmount`. Live writers already hold cents (the same integer they store as `cents / 100`), so they never
convert.

## Append-only, in two layers

1. **Code.** `entries.ts` exports only create and append functions. `tests/ledger-append-only-guard.test.ts` scans
   `modules/`, `app/`, `scripts/` and `prisma/` and fails on any `registrationLedgerEntry.update`, `updateMany`, `upsert`,
   `delete` or `deleteMany`, or raw SQL that changes a ledger row.
2. **Database.** A trigger raises on every `UPDATE`, and on a `DELETE` unless it is the foreign key's own cascade from a
   deleted registration or event (`pg_trigger_depth() > 1`, because the cascade runs inside the referential-integrity
   trigger). A correction is always a new entry. `TRUNCATE` is not a row operation and is not covered. The migration is
   `20261206100000_registration_ledger_entries` (additive only).

## What writes entries (same transaction as the stored total)

| Writer | Entries |
| --- | --- |
| Public form submission (`forms/public-repository.ts`) | `CHARGE` = stored total + the registration-level promo discount actually applied; the discount is its own entry, so the two sum exactly to the stored total. A waitlisted registration (no processing fee) splits the same way. A per-person code (#397) is already a `PROMO_CODE` adjustment line inside the total, so it stays in the one charge (its amount is in the snapshot). |
| `recordPromoCodeRedemption` (`promo-codes/repository.ts`) | `DISCOUNT` of minus the applied discount, keyed to the redemption, snapshot of the code's rule. A zero discount writes nothing. |
| Staff-created registration, staff invitation, import of a new registration | `CHARGE` of the stored total (0 cents when the total is zero, so every registration has an entry). |
| Amendment repricing (`registrations/amendments-repository.ts`) | The change in total (`final - previous`) as `CHARGE` (up) or `CREDIT` (down), keyed to the `RegistrationOperation`, actor from the operation. No change, no entry. |

Cancelling a registration changes nothing here: totals are preserved, so are the entries.

## `deriveRegistrationTotalCents(entries)`

Pure, in `domain.ts`. Nothing user-visible calls it in slice 1; the shadow reconciliation uses it as the proof that the
entries reproduce today's number. Slice 5 switches reads to it.

## Backfill (`backfill.ts`, `npm run ledger:backfill`)

Run by hand, never from the seed, a migration, postinstall, the Docker entrypoint or app start. Dry run by default;
`--apply` writes; `--event <id>` limits it. It rebuilds history without flattening it: the submission `CHARGE` is the total
before the first amendment (else today's total) plus the promo discount that applied then, the redemption is a
`DISCOUNT`, and each amendment whose snapshots show a change in total is a `CHARGE` or `CREDIT`. Existing keys are
skipped. **It never writes a balancing entry**: when the reconstruction differs from today's total it reports the
residual and leaves it for the health view. One small transaction per registration.

## Shadow reconciliation (`reconciliation.ts`) and the health view

For each registration it compares `deriveRegistrationTotalCents(entries)` with `moneyToCents(totalAmount)` and returns
the failing ones (expected, ledger, difference, entry count, and whether it has no entries). It backs
`scripts/verify-ledger-shadow.ts` (`npm run test:ledger-shadow`, CI) and the read-only page
`/more/ledger-health` ("Ledger check (shadow)"), which needs the same permission as Payments (`MANAGE_FINANCE`).

## Not covered yet (will show as discrepancies until slices 2 to 5)

These still change `Registration.totalAmount` without writing an entry:

- staff adjustments, including a promo code applied after submission (`registrations/adjustments.ts`, #396);
- card surcharge increments and decrements (`payments/square-repository.ts`);
- payment-choice repricing (`payments/payment-choice-repository.ts`);
- club member transfers (`club-transfers/repository.ts`);
- staff direct total edit (`registrations/repository.ts`, `updateRegistration`);
- an import that updates an existing registration (`imports/repository.ts`).

Club registrations made through the club form (`club-registrations/`) go through the public submission transaction
and are covered.
