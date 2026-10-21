# User-orientation revision — source and content checks

Prepared October 21, 2026 against `47cd5c00780d0c2dd9e618b56c32e2fbd04b041a`. That main revision merges the preceding documentation pack; its application source is unchanged from the reports' `5e367b7c` baseline.

## What the owner requested

Replace the general technical/future-feature briefing with a practical explanation of what IMSDA Events does, why it helps, how to sign in and how club directors and Area Coordinators use it. Keep the code/checks, camp discovery and future-feature material in the separate reports.

## Result

- A 31-slide user orientation with an introduction, first-time and returning sign-in, director tasks, coordinator tasks, practical follow-up, help and sign-out.
- Spoken notes for every slide, with an optional demonstration and question. Source references are marked as preparation material, not spoken content.
- A three-page quick-start handout in PDF, Word and Markdown.
- Numbered task illustrations using actual current labels. No accepted/proposed role mockup is presented as a current application screen, and no new menu is proposed.

## Source review

Separate source investigations verified sign-in/first-use, director work and coordinator work. Their findings are preserved in `orientation-signin.md`, `orientation-director.md` and `orientation-coordinator.md`. Referenced file paths are checked against the pinned source.

The final wording preserves these practical details:

- Begin at the website's **Sign in** link; do not teach a fixed staff login route as the universal director/coordinator entry.
- Existing users reuse their account. New invited directors verify the invited address and **Accept** the club invitation; account creation alone does not attach a club.
- Email verification and authenticator confirmation are different codes. The current setup key/help and recovery labels are described without promising a QR on every setup screen.
- Directors use **My club/My clubs**; coordinators use **Clubs overview/Clubs**. Training says to check the year shown, without inventing a universal year selector.
- Roster membership and event attendance are separate. Draft/save/submit/confirm states and sponsoring-church billing retain their meaning.
- **Forms** is a director/deputy workflow; registrar/reporter tools remain narrower. **Orders** is a helper/stock workflow, and **Class tracking** is described only for its supported records.
- Coordinator work is predominantly view-only. **Team approvals** is the specific own-location decision exception; **New clubs** is review-only for coordinators. No area-only filter or automatic reminder button is invented.
- A name search does not narrow the full-year coordinator CSV. Missing, Draft, Due and submitted report points remain distinct.

## Export validation

`orientation-checks.json` records the final slide/notes/source/package checks. The HTML deck is checked after font loading, and overflowing text is corrected before final export. PowerPoint shape bounds and Office ZIP integrity are checked. PDFs contain extractable text and tagged structures; the presentation also has bookmarks for its slide titles.

The full deck and handout contact sheets, detailed account-verification and coordinator Monthly Records slides, and a full-size spoken-notes page were inspected for obvious clipping/overlap and readable teaching flow. These are documentation checks, not a live production or assistive-technology audit. No application test run, application change, message send, real report submission or access change is part of this revision.
