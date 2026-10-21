# Lists and public journeys — design review

Tracking index: [#1114](https://github.com/DurantTL/IMSDA-Events/issues/1114). Reviewed October 21, 2026 against main `72a6cb214185cd7b74696f8913535f85330b690f`.

- [Read the complete review](review.md)
- [Download the five-page review PDF](review.pdf)
- [Detailed additions to existing implementation owners](existing-owner-notes.md)
- [Validation and scope](validation.md)

The review covers registration cards, attendee-list and club-roster columns, icon/action language, public calendar, Find a club, event-page customization, public links and embeds. It distinguishes current strengths, source-confirmed inconsistencies, proposed presentation changes and future feature ownership. It is source/test/issue evidence; no production session or production data was used.

## Interactive design mockups

[Six proposed desktop/phone screen designs](mockups/README.md) translate this report into visible examples. Includes a seven-page PDF, 19 screenshots and a downloadable offline interactive kit. New visual studies remain proposals; implementation issues stay open.

## Focused new follow-ups

| Issue | Reference specification |
|---|---|
| [#1115 — Saved public sharing addresses](https://github.com/DurantTL/IMSDA-Events/issues/1115) | [Use persisted settings for public URLs and embed code](issues/saved-links.md) |
| [#1116 — Effective result sort](https://github.com/DurantTL/IMSDA-Events/issues/1116) | [Describe the actual server search order](issues/sort-note.md) |
| [#1117 — Crowded calendar days](https://github.com/DurantTL/IMSDA-Events/issues/1117) | [Navigate to the full dated agenda](issues/calendar.md) |
| [#1118 — Club finder](https://github.com/DurantTL/IMSDA-Events/issues/1118) | [Search feedback, map coverage and phone navigation](issues/club-finder.md) |

Existing owners expanded in place: #181, #1112, #1074, #448, #283 and #284. #107 and #99 link the public follow-ups. #1109 retains the separately accepted four-role design. #98's stale admin-layout review status was reconciled with that acceptance without changing its queue or build frontier.

The recommendations add no new roles, sensitive public fields, registration/billing rules or production settings. #448's actual public-setup scope decision remains open. Implementation issues remain open, and this reference does not approve all future layouts or add `codex-ready`.
