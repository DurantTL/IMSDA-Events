# Profile photos (#1640)

First slice: staff accounts (`User`) only. Attendee photos, photos a club director adds for members without accounts,
Registrations and check-in station photos (#1577), People & access list photos and children are later slices.

## What is stored

- Table `ProfilePhoto`: one row per staff account, holding two storage keys, the 512 px file's size and checksum, when it
  was stored and, if a system administrator removed it, when and by whom. No image bytes are in the database.
- Two WebP files in the shared asset storage (`modules/events/asset-storage.ts`, partition `profile-photos`): a 512 px
  square and a 128 px square. File names are generated; nothing comes from the request.
- The upload is checked from its bytes (JPEG, PNG or WebP; never the claimed type), capped at 5 MB, decoded with a pixel
  limit and re-encoded, so location and other hidden camera data are not kept. The browser shrinks the photo first
  (center square, 512 px), so a large phone photo works. A file that cannot be decoded (a HEIC the browser could not
  open, a corrupt file) gets: "That photo could not be read. Please choose a JPG or PNG."

## Where it shows

- The person's own `/profile` page, the header account button and the account popover.
- The event Staff page (`/staff`) list.
- A system administrator's People & access page for that staff member (with the Remove photo button).

It never shows on public pages, emails, exports, CSV downloads, printed name badges or the attendee community.

## Who can see a photo

Photos load only through `GET /api/profile-photos/[userId]` for a signed-in staff user. The viewer must be the person, a
system administrator, or hold MANAGE_STAFF on an event where the person is on the staff list (the same people who see
them on the Staff page). Anyone else gets "not found", the same as a person with no photo. Responses are not cached
(the site sends `Cache-Control: no-store`), are `nosniff` and sandboxed, and carry no referrer. Page URLs end in
`&v=<uploaded time>` so a new photo always shows as a new address.

## Change, removal and deletion

- Change or remove at any time from `/profile`. Removing deletes both stored files, not just the link.
- A system administrator can remove an inappropriate photo (`DELETE /api/profile-photos/[userId]`). The files are
  deleted, the row keeps a "removed by staff" time, the action is written to the audit log (no image data or file
  paths), and the person sees "A staff member removed your profile photo on <date>. You can add a different one." until
  they add a new one.
- When a person is anonymized (`modules/people/anonymization.ts`), the photos of staff accounts linked to that person
  through `UserPersonLink` are deleted after the anonymization commits. This is best effort and logged; a file error
  never fails the anonymization, and a repeat call retries it. Any earlier staff-removal notice (and who removed
  the photo) is cleared at the same time.
- Deleting the staff account deletes the row (cascade). The stored files are not removed by the database cascade; an
  account-deletion flow must call the removal first (there is no such flow yet).

## What is left

- Attendee `/account/profile` photos, club-director-added photos, Registrations and check-in station photos, People &
  access list avatars.
- A sweep for stored files that have no row (for example after a crash between writing files and saving the row).
