# Visual training: screenshot acceptance checklist

Prepared October 21, 2026. This checklist supports a screenshot-led orientation for club directors and Area Coordinators. It is documentation review, not application implementation or a production access review. Current labels and status logic were checked against `modules/club-rosters/portal-nav.ts`, `components/area-clubs-subnav.tsx` and `modules/club-reports/area-summary-domain.ts` in addition to the three orientation evidence reports.

## A coherent fictional story

- Use **Riverton Pathfinders**, director **Jordan Ellis**, coordinator **Alex Morgan**, the **2026–27** club year and **Fall Camporee** consistently. Use reserved example email domains and invented member/contact information throughout.
- Mark captures **Fictional training data**. Describe them as captures of the local current application only if they actually are; a reconstruction or accepted design proposal must carry its own explicit label.
- Keep the same roster count, names, report state, selected event participants and submitted totals across related screens. Explain a before/after transition in its slide title or notes rather than appearing to contradict the previous capture.
- On **October 21**, the **October** report is due on **November 10**. It may be Due or Draft, not overdue Missing. Use **September** (due October 10) for an overdue example. An existing overdue draft remains **Draft** in the coordinator grid.
- A roster addition does not register the person for an event. A saved event draft does not establish a confirmed place. Keep these two distinctions visible in the story.

## Screen truth and navigation

- Start from **events.imsda.org → Sign in**. Do not tell users to type `/sign-in` or `/login`; switch settings affect those routes. Do not show staff sign-in as the ordinary club-account entry.
- Show the real role-specific account entry: director **My club / My clubs**; coordinator **Clubs** or **Clubs overview** on the **Area coordinator** card. No universal role picker or administrator workspace appears in this orientation.
- Director/deputy menu: **Home, Roster, Honors, Class tracking, Club events, Forms, Health, Monthly Records, Orders, Club settings**, subject to the person's actual capabilities. Do not add proposed menu items.
- Coordinator cross-club menu: **All clubs, Overview, Monthly Records, Points, Club events, Team approvals, New clubs**. The individual view-only club menu is **Home, Roster, Honors, Events, Club forms, Monthly Records, Earned awards**. Do not show director-only Orders, Health, Club settings or Class tracking as coordinator tasks.
- Show the displayed club/year heading. Do not draw a universal year dropdown or enforce a fictional “my area” filter: neither is established by current pages. Current coordinator queries cover active clubs.
- For another club, show **View only** and ages rather than full birth dates. A coordinator's separately assigned director role must not be presented as authority over every club.

## Task results and status meanings

- Roster: use the actual **Add to roster**, person-specific **Edit**, **Save**, **Show inactive**, **Deactivate** and **Reactivate** labels. Do not teach irreversible **Remove** as routine deactivation. If the icons are magnified, preserve their actual appearance and give the accessible action name in the annotation.
- Forms: only enabled templates should appear. Keep **Filled forms**, **Open** for a draft and **View and print** for submitted forms distinct. Avoid displaying health answers even in the ordinary demo; form status is sufficient to teach the task.
- Monthly Records: **Add meeting note** saves a meeting; it does not submit the report. **Save draft** differs from **Submit report · [points] points**. Notes edited after report creation require **Refresh from meeting notes** to update the saved report. Use actual computed points from the seeded fixture.
- Event registration: preserve **Who's going → Each person's details → Review**. Use the actual final action rather than inventing a generic button. Show submitted confirmation/status after submission. **Registered, Draft, Waitlisted, Cancelled, Not registered** remain distinct.
- A church-billed event follows office billing; do not add personal checkout or payment illustrations. **Orders** is a helper list, stock and hand-outs workflow, not an online camp store.
- Coordinator Monthly Records: numeric points open submitted reports; late reports retain **Late**; **Due**, **Missing**, **Draft** and **Not yet due** have different meanings. Reading a row does not resolve it or submit on the director's behalf.
- Points: show the split between submitted report points and the current **1,500** on-time annual registration points. A name search changes displayed rows; ranking remains full-scope. **Download points CSV / Download summary CSV** include the authorized year's list, not just the search subset.
- Coordinator event totals cover registered clubs and may remain unchanged when name search narrows visible rows. Avoid implying the coordinator can edit all registrations.
- **Team approvals** is a narrow permitted exception to oversight: actual eligible older team-member requests at the coordinator's own event locations. Decline does not automatically remove a person. **New clubs** is review-only for coordinators; administrator approval is separate.
- Do not invent **Send reminder**, automatic follow-up messaging or a universal curriculum checklist as current functionality. The coordinator contacts the director through the normal conference process.

## Account and screenshot hygiene

- Use only a disposable local synthetic database and accounts. Never capture a production member, guardian, health record, private link, invitation token, password, MFA setup key or recovery code.
- Account creation and club access are separate: invited address → email verification → **Accept** the correct invitation. Coordinators receive an office assignment; there is no public coordinator application toggle.
- Keep authenticator setup keys and recovery codes out of the captured image, including hidden lower-page regions and browser address bars. A screenshot of the initial two-step choice or blank code prompt teaches the protection without sharing a usable secret.
- Do not show an email verification code as an authenticator code. No need to teach both passkey and authenticator as mandatory; one supported method satisfies setup when offered.
- Keep hostnames/tokens out of visible browser chrome and notes. Source references and exact source SHA belong in trainer preparation notes/evidence.
- End with the actual **Sign out** action. Closing a tab is not signing out.

## Presentation and export checks

- Give each screenshot one main teaching purpose. Use a wide overview, a readable detail crop, a before/after pair or a short three-stage sequence as appropriate; do not simply decorate repeated text cards with tiny screenshots.
- Keep the real app navigation/context in at least the opening capture for each role. Detail crops should retain enough heading or caption to identify the page.
- Place callout numbers beside the actual control and match them to a short annotation. Do not cover the click target, status, club name or year with a callout. Distinguish instructional annotations from app UI.
- Carry explanations and exceptions in presenter notes. A person looking at the screen should be able to answer “Where am I?”, “What do I do?” and “How do I know it worked?”
- Inspect the final full-size PDF and PowerPoint slide images for readable screenshot text, clipped edges, misaligned callouts and image quality. Confirm screenshot paths are embedded in the PowerPoint rather than required external links.
- Add meaningful image alt text or an equivalent plain-language walkthrough in the notes; retain searchable slide text and tagged PDF structure where supported.
- Verify every screenshot against a capture manifest containing route/screen, role, fictional state, capture dimensions and source commit. Verify the final docs-only diff contains no application code, credentials or runtime database files.

## Review outcome to record after rendering

Record the reviewed artifact paths, screenshot count, slide count, final source SHA, fixture snapshot date and any known exceptions. This document is a preparation checklist and does not itself certify unseen final slides.
