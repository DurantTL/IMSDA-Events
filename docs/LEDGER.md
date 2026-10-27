# Registration ledger runbook (#117)

Slice 1 of the append-only ledger (#74) adds a new table and writes entries beside today's totals. Nothing anyone sees
changes: `Registration.totalAmount` is still the number used everywhere. The model, the rules and the list of totals
that are not covered yet are in `modules/ledger/README.md`. These are the steps only a human does.

## Before and during the deploy

1. **Back up the production database** (`docs/BACKUPS.md`).
2. **Deploy the migration** `20261206100000_registration_ledger_entries`. It is additive (one new table, enums, indexes, a
   check and a trigger) and touches no existing table, so the old code keeps working while the deploy rolls out.
3. **Wait until the new code is fully live.** From then on every new registration, promo redemption and amendment writes
   its entries in the same transaction as its total.

Registrations the old code created (or amended) during the deploy window have no entries yet. The backfill picks them up.

## Backfill (by hand, after the new code is live)

It never runs on its own: not from the seed, a migration, postinstall, the Docker entrypoint or app start.

1. `npm run ledger:backfill`: a **dry run**. It prints how many registrations are missing entries, how many entries it
   would write, and any **residuals**. Nothing is written.
2. **Review the residuals.** A residual is a registration whose reconstructed ledger does not equal its current total,
   because a total was changed by something the ledger does not record yet (staff adjustments, card fees, payment-choice
   changes, club transfers, direct total edits, imports that update an existing registration). They are expected. The
   backfill does not write a balancing entry for them.
3. `npm run ledger:backfill -- --apply`: writes the missing entries. Add `--event <id>` to do one event at a time. It is
   safe to stop and start again; it commits one registration at a time.
4. `npm run ledger:backfill`: run the dry run again. It must report **0 entries to write**.
5. Open **Ledger check (shadow)** (`/more/ledger-health?event=<id>`, needs finance access) for each event. It lists every
   registration whose ledger differs from its current total. Those are the same residuals from step 2 plus anything
   changed since. An empty list means the ledger matches every registration in that event.

If something looks wrong, do not edit anything: entries cannot be changed or deleted, and nothing reads them yet. Tell
the build team with the confirmation code.

## What the health view does and does not mean

- It is read-only and changes nothing.
- A registration listed there is not a billing error today. The current total is still correct and authoritative; the list
  shows where the new ledger has not caught up with a kind of change it does not record yet.
- The list is the safety net for the next slices: each one covers more kinds of change, and the list must shrink to
  empty before any screen switches over to the ledger.
