# Visual user orientation — source and content checks

Prepared October 21, 2026 against application source `7f77c1dfeadd004deb51f91e2bae1b6c4754638b`. This revision follows the merged practical-orientation documentation. The application source is unchanged; the five reference reports retain their historical `5e367b7c` baseline and original exports.

## Owner's request and revised teaching approach

The owner asked for fictional data and visual screenshots so the presentation demonstrates what happens rather than repeating feature descriptions. The revised storyboard has **31 slides**: introduction/sign-in (1–7), director story (8–16), coordinator story (17–22), follow-up/help (23–24), optional current capabilities and future outlook (25–30), and sign-out (31).

The scenario uses Riverton Pathfinders, director Jordan Ellis, member Morgan Reed and Area Coordinator Alex Morgan, with three other fictional clubs for comparisons. The working date is October 21, 2026, the club year is 2026–27, and Fall Camporee is November 6–8. September records illustrate overdue status differences; October's director report is within its November 10 deadline. Actual figures and transitions must follow the captured local fixture, not invented totals in slide annotations.

The presentation combines actual local application captures, short captions and editable instructional callouts. Spoken notes retain explanations and exceptions. The companion quick-start remains three pages. Reports 01–05 and their exports remain unchanged; the code/checks, camp discovery and future-feature material stay separate from the user orientation.

## Capture provenance and limits

Screens are captured from an isolated local instance of the pinned application using synthetic records. No production session or production database is used. The capture register, `screenshot-capture.json`, records the source revision and each screenshot's page/role/fixture context. This is evidence of repository behavior under the local configuration, not verification of public production switches, availability, enabled templates or current production records.

Every visual uses a fictional-data label. Annotations belong to the presentation and do not imply new app controls. Accepted future role designs must not be substituted for current application screenshots. The existing System navigation, role permissions and build order remain unchanged.

## Source review and teaching safeguards

The prior source investigations remain in `orientation-signin.md`, `orientation-director.md` and `orientation-coordinator.md`. The screenshot-specific acceptance checklist is `visual-training-qa-plan.md`. Current source confirms these details:

- Begin at the website's **Sign in** link, not a hard-coded staff route. Reuse an existing account; a new invited director verifies the invited address and **Accepts** the correct club invitation. Account creation alone does not grant club access.
- The extra confirmation protects club information. Email verification and authenticator confirmation have different purposes. Captures must not contain passwords, usable email codes, MFA setup keys, recovery codes, invitation tokens or private links.
- Directors use **My club/My clubs**; coordinators use **Clubs overview/Clubs**. Show the current year heading without inventing a universal year dropdown or area filter.
- Roster membership is separate from event participation. **Add to roster**, saved draft, submitted report and confirmed registration remain distinct results. **Deactivate** is not irreversible **Remove**.
- Meeting notes do not submit a Monthly Record. A saved report is refreshed explicitly from notes. A September report can be **Missing** after October 10; an existing overdue draft remains **Draft**. An unsubmitted October report on October 21 is **Due** or **Draft**, not overdue Missing.
- **Forms** is a director/deputy workflow; narrower club roles retain their restrictions. **Orders** is a helper/stock workflow, and **Class tracking** covers its supported records rather than an invented universal curriculum checklist. Sponsoring-church billing remains distinct from a personal payment flow.
- Coordinator work is predominantly view-only. **Team approvals** is the narrow own-location decision exception; **New clubs** is review-only. There is no general Send reminder action or automatic follow-up message in this training.
- A coordinator name search does not narrow the full-year CSV or recalculate full-scope rankings. Event totals may remain full-event totals when visible club rows are filtered.

## Added feature outlook

The latest request adds six closing slides so the audience sees more of the current system and its future direction. Two slides cover implemented club/event tools with setup and role boundaries. Two cover planned workspace, public-journey and form-builder improvements; administrator alerts and kitchen closeout are also named as ordered roadmap work. Two cover possible camp workflows and later Adventurer, wallet, merchandise, fundraising and feedback/certificate scope. Each has a status label and matching footer; none uses an unreleased app mockup or promises a delivery date. The original screenshot walkthrough is retained.

The outlook was checked against main `2cac4150c2b237b02190495d931e6bffb2189184` and fresh owner-issue/roadmap status. `closing-feature-audit.md` records boundaries and `outlook-independent-qa.md` records the final visual/content review. The screenshot source remains pinned separately to `7f77c1df`.

## Final export review status

The final presentation has **31 slides, 42 embedded screenshot placements and 34 registered capture examples from 33 unique images**. Every slide has spoken notes; every picture has an alternative description. All 70 distinct referenced source files exist at the pinned revision. The five reference reports' 20 Markdown/Word/HTML/PDF files are byte-identical to the merged versions.

PowerPoint shape bounds and Office package integrity pass. After fonts and images load, the deck has **zero overflowing text boxes and zero failed images**. All eight PDFs open with text and tagged structures; the deck has 31 slide-title bookmarks. Presenter notes are 19 pages; the retained quick-start is three pages. Machine-readable results are in `orientation-checks.json`, `render-checks.json` and `pdf-manifest.json`.

The complete contact sheet and enlarged task/detail slides were visually inspected. An independent review checked fictional-state continuity, source permissions, authentication examples and the before/after report story. Crops were enlarged to show roster saving, returned form states, report submission, event confirmation and the registered headcount. Annotation positions were corrected where they covered a value. The gallery excludes the local check-in QR from the shared confirmation capture; original hash and crop coordinates remain in the capture register.

These documentation checks do not constitute a live production, assistive-technology or physical-printer audit. No application test run, application change, external message, production report submission or access change is part of this revision. All demonstrated saves and submissions affect only the isolated fictional database.
