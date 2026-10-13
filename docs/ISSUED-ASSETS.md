# Issued assets (#213, slice 1)

Keys, keycards, wristbands, radios, welcome packets and other items an event hands out. Code lives in
`modules/issued-assets/`. Returns, deposits, loss, damage and charges are slice 2 (#214) and are not built here.

## Who can do what

| Action | Permission | Where |
| --- | --- | --- |
| Set up kinds of item, add items, add a numbered range, change condition, location, status | `CONFIGURE_EVENT` | More > Issued assets (`/more/issued-assets`) |
| Issue, transfer, replace, correct, look up | `MANAGE_CHECK_IN` | Check-in > Issue keys and items (`/check-in/assets`) |

Every route checks the permission on the server and refuses a cross-origin mutation.

## Model

- `IssuedAssetType`: a name, `SERIALIZED` (one numbered item, one holder at a time) or `QUANTITY` (a lot of N identical
  items), active, the holder kinds it may go to (attendee, registration, staff member, room, vehicle, team), a
  room-linked flag, and a deposit and replacement policy *reference* (text only; no amounts). The behaviour cannot change
  once the type has items.
- `IssuedAsset`: one numbered item (`quantityTotal` 1) or one lot. `identifier` (what staff say, `K-214`) and `scanCode`
  (what the barcode or QR carries, the identifier by default) are trimmed, upper case and unique in the event. Condition,
  location and a staff-controlled status (available, unavailable, retired). "Issued" is never stored: it is read from the
  open issuances.
- `AssetIssuance`: one holder's claim on one asset, with actor, purpose, when it happened (`issuedAt`, set by an offline
  desk) and when the server recorded it (`createdAt`), expected return, entry method (manual, scan, offline), a saved
  retry key, the room it opens (`roomUnitId`) and the exact lodging assignment it was issued against
  (`sourceAssignmentId`). It changes only to end (`endedAt`, `endReason` of transferred, replaced or corrected, actor,
  note), and a transfer or replacement starts a new issuance that points back (`previousIssuanceId`).
- `AssetIssuanceHistory`: append-only, one row per change (issued, transferred out and in, replaced out and in,
  corrected), with the holder and lodging reference as they were at the time.

## Rules the database enforces (migration `20261018120000_issued_assets`)

- At most one open issuance per serialized asset (partial unique index).
- Open quantities never exceed the lot (a trigger locks the asset row and sums).
- Holder columns match the holder kind; an attendee or registration belongs to the issuance's event.
- An issuance changes only to end; an ended one never changes; every change raises its revision and must append its
  history row in the same transaction (deferred constraint trigger).
- History is never updated. Nothing is deleted while the event exists; the event deletion service removes these rows
  before registrations and lodging assignments (`modules/events/deletion-repository.ts`).
- Retired or unavailable assets cannot be newly issued.

## One issue service

`issueAssets` is the only writer of new issuances. A typed identifier, a scanned barcode value and an offline entry sent
later are the same call with a different `entryMethod`; the shared decision is `decideIssue` in `domain.ts`.

- It runs in a SERIALIZABLE transaction through `runSerializableTransaction` (`modules/payments/serializable.ts`), takes
  the asset rows `FOR UPDATE` in id order and bumps each row's `issueVersion` before reading who holds the asset, so
  racing staff leave one winner and group issues in opposite orders cannot deadlock.
- Several items for one holder go in one request. Items that cannot be issued are reported one by one and the rest are
  issued (`atomic: false`), or nothing is issued (`atomic: true`).
- A repeated scan for the same holder is a `DUPLICATE`: nothing is written. A quantity item already issued to the holder
  is also a duplicate unless the request says `addMore`.
- A saved `idempotencyKey` makes a retry return the original result.
- An offline entry may state when it happened (`occurredAt`, at most 14 days back). If it names a lodging assignment that
  was moved after that moment, the original assignment is kept as the reference; the same entry made online is refused.

## Room-linked keys and moves

Issuing a room-linked kind to an attendee or registration records the room and the lodging assignment (found
automatically when the holder has one room, otherwise chosen). A later move cancels that assignment; the issuance keeps
pointing at it. The desk compares it with where the holder stays now (current, moved, released) and tells staff when a
key opens a room the family has left. Replacing the key records a new issuance against the current assignment and ends
the old one as replaced; `listRoomIssuances` returns the room's whole key history across moves.

## Left for slice 2 (#214)

Return, partial return, loss, damage, waiver, charge and closeout events; deposits and fees (use the append-only ledger);
outstanding reports; offline return sheets. The model leaves room: new `endReason` and history types are additive enum
values, a quantity partial return can end an issuance and start a remainder, and `AssetIssuance.sourceAssignmentId` and
`roomUnitId` are what checkout and room-damage reports join on.
