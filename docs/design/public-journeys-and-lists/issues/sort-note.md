# Registration search: describe the effective sort in the result-order note

Tracking: [#1116](https://github.com/DurantTL/IMSDA-Events/issues/1116).

## Problem

`PeopleWorkspace` always shows `sortOrderText("submitted date", "desc", "date")`. The server-side search supports `sort=name`, `sort=submitted.asc`, total and other authorized sorts, and the page explicitly loads results in the service's canonical order. The note can therefore say newest first while the visible records are alphabetic or oldest first. This is a source-confirmed presentation inconsistency, not a claim that the search service sorts incorrectly.

Source: [constant](https://github.com/DurantTL/IMSDA-Events/blob/72a6cb214185cd7b74696f8913535f85330b690f/components/people-workspace.tsx#L251), [note rendering](https://github.com/DurantTL/IMSDA-Events/blob/72a6cb214185cd7b74696f8913535f85330b690f/components/people-workspace.tsx#L789), [canonical search order and workspace props](https://github.com/DurantTL/IMSDA-Events/blob/72a6cb214185cd7b74696f8913535f85330b690f/app/%28workspace%29/people/page.tsx#L66), and `tests/operations-search-domain.test.ts` supported sort cases.

## Reproduction

With an authorized synthetic event containing differently named registrations, open `/people?event=<id>&sort=name`, then `sort=submitted.asc`. Records follow the requested canonical order; the workspace note continues to claim submitted date descending. The local in-page search does not change ordering and should not change the effective order label.

## Scope and ownership

Bounded follow-up to delivered #180 under #75. #181 retains saved view/column/drilldown persistence. Do not hold this wording correction for the full saved-view build, add client re-sorting, broaden sort authorization or change pagination/query semantics.

## Acceptance criteria

- [ ] Pass a permitted, effective sort description from the server search/query contract into the result workspace, rather than deriving it from arbitrary raw URL text.
- [ ] Ordinary non-search results keep their actual submitted-date-newest-first note.
- [ ] Name ascending/descending, submitted oldest/newest and other supported authorized sorts show a truthful readable label and direction.
- [ ] Invalid/unavailable sort uses the service's actual fallback/error result; never claim an unauthorized field or expose a hidden sort dimension.
- [ ] Local filtering, selected records, page changes and an off-page registration opened in the detail retain their current semantics and do not alter the note incorrectly.
- [ ] Desktop/phone present the same meaning. Focused checks cover default, name ascending, submitted ascending and denied/invalid sort without mirroring a hardcoded implementation string.

Design review context: #1114. Keep #98 ordering and no automatic `codex-ready`.
