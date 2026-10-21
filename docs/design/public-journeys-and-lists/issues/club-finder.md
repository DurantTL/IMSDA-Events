# Find a club: clarify search results, map coverage and phone navigation

Tracking: [#1118](https://github.com/DurantTL/IMSDA-Events/issues/1118).

Context: #1114. Bounded enhancement to delivered #437, preserving #1014's Start a new club entry and current Pathfinder-only application. Parent direction: #99/#68.

## Existing behavior

The public finder already searches and synchronizes list/map selection, groups clubs sharing a church pin, handles listed clubs without coordinates, and shows meeting schedules. Only opted-in active clubs with active sponsoring organizations are projected. Search matches **town, ZIP, club name and church name**, while the visible/accessibility label only says “Search by town or ZIP.” The list has no explicit result count or dedicated Clear search action. On phones the map precedes the list. Map-library/tile failures have no explicit unavailable/retry presentation in this component.

This is a source review, not a claim the map is currently failing in production.

Evidence: [search and results](https://github.com/DurantTL/IMSDA-Events/blob/72a6cb214185cd7b74696f8913535f85330b690f/components/public-club-directory.tsx#L17), [map lifecycle](https://github.com/DurantTL/IMSDA-Events/blob/72a6cb214185cd7b74696f8913535f85330b690f/components/public-club-map.tsx#L61), [current public-field allowlist](https://github.com/DurantTL/IMSDA-Events/blob/72a6cb214185cd7b74696f8913535f85330b690f/modules/organizations/public-club-directory.ts).

## Design behavior

- Label the actual search capability, e.g. **Search town, ZIP, club or church**, with an associated visible label and matching accessible name. Preserve case-insensitive matching and usable whitespace/clear behavior.
- Show **N publicly listed clubs found · M shown on map** from the same filtered set. Distinguish zero published clubs, zero search results, missing coordinates and unavailable map imagery.
- Keep unlocated clubs in the list. Provide a useful “Map location unavailable” explanation when selecting such a result; no geocoding, precise-address disclosure or inferred distance claim.
- Add Clear search and a useful no-match reset. Announce result changes politely without moving focus on each keystroke.
- On phones provide an accessible List/Map choice or another compact arrangement that gets people to results promptly. Preserve query and selection between modes. The list must remain usable if map JS or tiles fail; provide honest unavailable/retry feedback without destroying the working list.
- Preserve keyboard pin/list interaction, same-church grouping and selecting a pin's appropriate club. Results do not imply current enrollment, approved membership, availability or an invitation to arrive at a private address.
- Keep Start a new club clearly separate from finding/joining an existing club. Reuse an already approved conference-help destination if needed; do not invent public director contacts.

## Acceptance criteria

- [ ] Town, ZIP, club and church-name examples match the advertised behavior; counts agree with filtered list and mapped subset.
- [ ] Synthetic mix of mapped/unmapped and same-pin clubs remains discoverable; no-match/empty/clear state works.
- [ ] Phone list/map navigation preserves search/selection, with no document overflow or focus loss. Keyboard, visible focus, 44px controls, long names and 200% zoom remain usable.
- [ ] Slow/failing map load or tile errors leave a usable result list and accurate status; recovery does not reset unrelated user choices.
- [ ] The existing public DTO remains unchanged: no person names, contact phone/email, street/meeting address, private description, roster, screening or health details are fetched or serialized.
- [ ] Existing opt-in and active-club/sponsor filters, shared-pin behavior and Pathfinder-only application wording remain verified.

No new map provider, geolocation prompt, radius search, ministry authorization, directory permission, contact publication or club-registration workflow. Schedule through #98; no automatic `codex-ready`.
