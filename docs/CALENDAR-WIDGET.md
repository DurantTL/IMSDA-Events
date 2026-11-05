# Upcoming-events widget (#107)

`/embed/calendar` is a compact list of the next public calendar items, made to sit in an
iframe on another website. It reads `listPublicCalendarItems` (the same read as `/calendar`
and `feed.ics`), so nothing unpublished, hidden, archived, deadline-only or
`showOnCalendar = false` can appear. It inherits the embed layout (auto-resize through
`/embed/embed.js`) and the `/embed/*` Content-Security-Policy `frame-ancestors` (built in `modules/security/content-security-policy.ts`, sent by `proxy.ts`)
allow-list (`EMBED_ALLOWED_ORIGINS`; imsda.org and its subdomains by default).

Options (query string):

- `limit`: 1 to 12 items, default 5.
- `filter`: a calendar filter button slug (`main` by default, `ministry-1` to `ministry-6` for the six homepage tiles, `schools`, `meetings`, `closed`, `everything`). Old slugs (`camps`, `pathfinders`, `adventurers`, `ministries`, `club`) go to the tile that lists that category, else Everything (#1611).
- `category`: one category name (first 40 characters), as on `/calendar`.

Items already under way stay until their last day; a repeating entry shows once. IMSDA events
and informational entries are labelled differently, and every link opens in the top window.

Staff copy the embed code (iframe plus `embed-host.js`) from Admin > Calendar > Events.
