# ADR 0018: "Near me" on Find a club keeps the visitor's location in the browser

Status: Proposed with the build of #2056 (awaiting the Communication Director's review on the PR).
Date: 2026-11-27

## Context

Find a club (`/clubs`) lists the clubs whose directors chose a public listing, with a search box
and a map. #2056 adds a way to sort that list by distance: from the visitor's own location, or
from a town or ZIP code for people who don't share location. The issue asks that the location is
used only in the browser: not sent to the server, stored or logged.

## Decision

- **Near me** asks the browser for the location (`navigator.geolocation`, low accuracy). The
  site-wide `Permissions-Policy` keeps `geolocation=()`; only `/clubs` sends
  `geolocation=(self)` (`next.config.ts`), so no other page, and no embedded frame, can ask.
- **Town or ZIP** is looked up in a table bundled with the page
  (`components/place-lookup-data.ts`: Iowa and Missouri ZIP codes and their towns, from the
  GeoNames postal code file, CC BY 4.0). It is loaded with a dynamic import only when someone
  looks up a place. The Census geocoder the staff "Find map locations" step uses (ADR 0014) is
  not used here, because it would send what the visitor typed to our server and on to the
  Census Bureau. A town that exists in both states asks for IA or MO; a place outside the two
  states is not found, and the message says so.
- The point stays in the page's memory. It is not sent in any request (beyond the map pictures
  below), put in the web address
  (the search box's `?q=` is unchanged), stored in the browser, logged or measured by the
  public metrics beacon. Leaving the page forgets it.
- Distances are straight-line miles. Clubs without a map location keep their usual order at the
  end of the list. The map frames the point and the nearest three pins and marks the point with
  a dot that only the page draws.
- The map's pictures come from OpenStreetMap (as they already do for any area the visitor looks
  at), so centering the map on the point asks OpenStreetMap for the pictures of that area. To keep
  that to a region rather than a street, the map frames a point no closer than zoom 9
  (`NEAR_ME_MAX_ZOOM` in `components/public-club-map.tsx`), where one picture covers roughly
  40 to 50 miles. The point itself is not sent; the visitor can still zoom in by hand.
- If location is refused, blocked (by the visitor, a privacy browser or a policy), unavailable
  or never answered, the page says so in plain words, keeps the usual order and offers the town
  or ZIP box.

## Refreshing the town and ZIP table

Download `US.zip` from https://download.geonames.org/export/zip/, unzip it, then run
`npx tsx scripts/generate-place-lookup-data.ts path/to/US.txt` and commit the regenerated
`components/place-lookup-data.ts`. The page credits GeoNames whenever the list is sorted from a
town or ZIP.

## Consequences

- No new service, key or cost. The table adds about 75 KB (before compression) to a chunk that
  loads only on a town or ZIP lookup.
- Places outside Iowa and Missouri (for example Omaha or Kansas City, Kansas) are not found by
  name or ZIP; Near me still works there.
- Tests: `tests/club-near-me-2056.test.ts` (distances, lookup, the header, and a source check
  that the code sends, stores and measures nothing) and `tests/public-club-near-me-2056-dom.test.ts`
  (allowed, refused, unavailable, unsupported and unanswered location; town and ZIP lookups).
