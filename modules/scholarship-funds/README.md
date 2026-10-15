# Scholarship funds (#398)

Each event has one scholarship fund. Decision (owner, Oct 14, 2026): contributions and awards belong to that
event's fund, and nothing carries over to another event or year (a new event, or a clone, starts with no fund).

This module records money; it never moves any. There is no refund, charge, or payment action here.

## How it fits the existing ledger

- There is no second ledger. An award is the scholarship adjustment line from #396
  (`RegistrationAdjustment`, kind `SCHOLARSHIP`, negative cents) plus a `ScholarshipAward` row saying which fund and
  sponsor it draws on. `createRegistrationAdjustment` takes an optional `fundAward` and records both in one
  SERIALIZABLE transaction, so a refused draw rolls the adjustment back too.
- Reversing the award is the existing adjustment reversal. An award counts against the fund only while its adjustment
  line has not been reversed, so a reversal returns the money with no extra step.
- Contributions are append-only lines in integer cents (`ScholarshipContribution`). A mistake is a negative reversal
  line pointing at the original; the original stays.

## Balances

- received: contribution lines summed, reversals included.
- funded awards: active awards that are not pledged, plus pledged ones that were settled.
- balance: received minus funded. A funded award, a settlement, and a contribution reversal are each refused when they
  would take it below zero. Those writes are SERIALIZABLE and retried on conflict (P2034).
- pledged award ("pledged, not yet received"): the one exception to the balance rule. The sponsor has promised money
  that has not arrived, so it may exceed the balance. It must name the sponsor, it still lowers what the attendee owes,
  and it shows as outstanding for that sponsor until staff mark it received, which needs the contribution recorded and
  unspent first.

## Per-sponsor rule

A sponsor's unallocated money is what they gave (reversals included) minus the funded awards attributed to them.
A funded award attributed to a sponsor, settling that sponsor's pledge, and reversing that sponsor's contribution are
each refused when they would take that sponsor's unallocated money below zero, on top of the fund-level rule. A funded
award with no sponsor draws on the fund in general; the matching view shows it on its own line, so per-sponsor
unallocated money minus general draws always equals the fund balance. A pledged award is the exception at creation
(promised money is not checked), but must be covered by its own sponsor's money before it can be marked received.

## Cancelled registrations

Nothing is released automatically. A pledge can't be marked received while its registration is not submitted or
confirmed. The fund page flags active awards on cancelled registrations ("registration cancelled — reverse to return
to fund"), and a fund-linked scholarship line (and nothing else) can be reversed on a cancelled registration so staff
can release the money by hand. Fund awards are refused on registrations billed to their church. A club member
transfer moves the award row along with its scholarship line. An event with recorded contributions cannot be deleted.

## Sponsors

A sponsor is a church, club, company or group chosen from the shared directory (preferred; its name is copied from the
directory, not from the request) or a free-text name. Lines group by the directory id, else the normalized typed name.

## Access, audit, export

- Everything needs MANAGE_FINANCE on the event, checked on the server.
- Audit rows hold ids, amounts, and counts only: never a sponsor name, note, reason, or attendee.
- The finance export (`/api/events/[eventId]/exports/scholarship-fund`) goes through `toCsv`/`csvCell`, which
  neutralizes formula injection, and is itself audited with counts only.

Real-database check: `npm run test:scholarship-funds`.
