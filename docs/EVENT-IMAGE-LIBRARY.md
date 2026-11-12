# Event image library (#1913, part 1)

A shared library of event header images, so staff pick a past image instead of uploading again.

## How it works

- **Kept automatically, published content only.** A banner image joins the library when its banner section is published
  AND its event is published and not archived: on a page save, and again when the event is published (a banner saved
  while the event was a draft). The entry carries the alt text and the event's title and start date. It happens after the
  save has committed; if it fails it is logged and the save stands. Draft banners and unpublished events never enter the
  library. Direct uploads to the library are shared by design. A later save that supplies alt text fills in a library
  entry that has none.
- **Own copy.** The library stores its own copy of each file (`image-library/` under the asset storage directory).
  Deleting an event or one of its uploads never breaks a library entry.
- **No duplicates.** Images are matched by file checksum. The same bytes are never added twice.
- **Images only.** PNG, JPEG and WebP, with the same size, type and file-signature checks as event uploads. No PDFs.
- **Using an image** copies it into the event once, as an ordinary event file, and sets the banner image. Using it again
  in the same event reuses that file. A retired image cannot be used. Alt text is prefilled from the library only when the
  field is empty, and stays required.
- **Retire / Restore** hides an image from the picker (unless "Show retired" is on). Events that already use it are not
  touched.
- **Tags** are trimmed, lower-cased and de-duplicated: at most 12 per image, 30 characters each.
- **Where it is used** counts events whose content blocks actually show a copy of the image. The count is always shown;
  event names are listed only for events the viewer can configure (system administrators see all).
- **Audit:** retiring, restoring and tag changes are audited with the image id and its source event id. Retire and
  Restore stay open to any event editor (reversible and audited).
- **Search** covers file name, source event title and tags; filters are tag and the source event's year.

## Who can use it

Everything needs the `CONFIGURE_EVENT` permission on the event being edited; writes also reject cross-origin requests.
Routes are under `/api/events/[eventId]/image-library/`: list and upload; `[imageId]` for tags and retire; `[imageId]/use`;
`[imageId]/file` for the staff-only preview.

## Rollout (human steps)

1. Apply migration `20270130100000_event_image_library` (adds one table and one nullable column; nothing is changed or dropped).
2. Optionally run `npm run event-image-library:sync` once to add the published banners of published events. It is safe to
   repeat and only writes library rows and the library's own copies.

Part 2 (AI generator) is not part of this change.
