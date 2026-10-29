# Upcoming-events widget (#107)

`/embed/calendar` is a compact list of the next public calendar items, made to sit in an
iframe on another website. It reads `listPublicCalendarItems` (the same read as `/calendar`
and `feed.ics`), so nothing unpublished, hidden, archived, deadline-only or
`showOnCalendar = false` can appear. It inherits the embed layout (auto-resize through
`/embed/embed.js`) and the `/embed/:path*` Content-Security-Policy `frame-ancestors`
allow-list (`EMBED_ALLOWED_ORIGINS`; imsda.org and its subdomains by default).

Options (query string):

- `limit`: 1 to 12 items, default 5.
- `filter`: a calendar filter group slug (`main` by default, `everything`, `camps`, ...).
- `category`: one category name (first 40 characters), as on `/calendar`.

Items already under way stay until their last day; a repeating entry shows once. IMSDA events
and informational entries are labelled differently, and every link opens in the top window.

Staff copy the embed code (iframe plus `embed-host.js`) from Admin > Calendar > Events.
