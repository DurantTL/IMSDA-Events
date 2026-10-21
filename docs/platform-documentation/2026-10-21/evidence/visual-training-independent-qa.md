# Independent visual-training review

Reviewed October 21, 2026. This review covers the first and replacement renders of the 25-slide visual orientation and its spoken notes. It records observed findings separately from the final export checks. It is not a production or assistive-technology audit.

## Material inspected

- `exports/IMSDA-Events-platform-briefing.pdf`: all 25 slides through the contact sheet; slides 2, 9, 11, 14, 19, 21, 22 and 23 rendered individually at 1.5× for closer inspection.
- `content/06-presenter-notes.md`: all 25 slide explanations, demonstrations, questions and screenshot descriptions.
- `evidence/screenshot-capture.json` and `evidence/deck-source.json`: source/role/state register and slide-to-image/crop mapping. The final **34** registered image files existed and matched their recorded SHA-256 hashes on the replacement-render pass.
- Full raw authentication captures: `sign-in.png`, `email-verification.png` and `two-step.png`. Earlier individual review also inspected director Home and the coordinator club view.
- Source semantics previously checked in `modules/club-reports/area-summary-domain.ts`, `modules/club-rosters/portal-nav.ts` and `components/area-clubs-subnav.tsx` at the documented application revision `7f77c1dfeadd004deb51f91e2bae1b6c4754638b`.

## Content findings

The fictional story has a clear progression: Jordan's club begins with nine active people and one filed report; adding Morgan produces ten people; October's local report submission produces two filed reports and 2,320 points; Fall Camporee registration contains six people. Coordinator capture descriptions and visible results use the post-director state. Slide 23 explicitly labels its earlier draft and later submission, so revisiting the before state is understandable rather than a contradictory record.

The report example handles the October 21 date correctly. September's comparison rows show Late, Missing, Draft and submitted points. October remains Due for unfinished clubs and shows submitted points for Riverton. The notes explain the October report is a complete fictional training exercise due November 10, without telling real clubs to submit an incomplete month early. They also avoid promising an overdue September month can simply be reopened or submitted by the coordinator.

Role authority and current controls remain accurate in the reviewed material. Directors maintain their own club, and the coordinator's club screen visibly says View only. Slide 22 states that a system administrator decides new-club applications; Team approvals is described separately in the notes as a narrow eligible-request exception. The deck does not add a role picker, area dropdown, automatic reminder, administrator dashboard or new menu design. The distinction between roster membership and event registration is repeated in useful task context.

The notes correctly distinguish Save draft from Submit report, event draft from a registered place, and Deactivate from irreversible Remove. They preserve current form state labels, explicit report refresh, church invoicing, the scope of points CSV downloads and the limits of Orders/Class tracking. Detailed exceptions are in notes rather than long visible feature lists.

## Authentication and private-data check

The three raw authentication images show fictional `example.test` email addresses, blank password/code inputs and the app's grey `123456` placeholder. The spoken notes explicitly identify the placeholder as something not to copy. No usable email verification value, password, authenticator key, QR secret, recovery code or private invitation/manage link was visible in those inspected images. The development-only email code panel is excluded from the delivered verification capture and documented in the register. The invitation crop shows the club, role and Accept action without a token.

The reviewed application and PDF images show invented records rather than production information. This review does not infer production configuration from the localhost screenshots. The register correctly makes that distinction. Full-size screenshots and every exported image still require the author's final package pass after the crop changes.

## First-render visual issues sent to the author

The author had already identified overflow on the cover and slides 15, 20 and 24, the unreadably tall Review image on slide 15, and overly wide/narrow result crops on slides 13, 23 and 25. Independent review found four additional items:

1. **Slide 11:** the Forms crop stops before Filled forms. As rendered, it does not show the Draft/Open and submitted/View and print states discussed by the callouts, takeaway and notes. Show those saved rows, using a second crop if necessary.
2. **Slide 21:** the crop stops after Pine Grove's Draft row, omitting Riverton's Registered/six-person row. Expand or reposition it so the registered example supports the headcount teaching point.
3. **Slide 2:** full-page images make Morgan's row and event selections too small to read. Use relevant roster and attendee crops while retaining their descriptive headings.
4. **Slide 9:** the details crop does not include the actual Add to roster action mentioned in its caption. Include a small action inset or adjust the crop/caption so the screenshot teaches the save control as well as the new saved row.

These are presentation crop/layout findings, not requests for application behavior changes. The source screenshots contain the needed information.

## Replacement-render review

Re-inspected slides **2, 9, 11, 13, 14, 15, 21, 23 and 25** individually after replacement rendering. Slide 2 now enlarges Morgan's roster row and selected event row. Slide 9 includes the real Add to roster button. Slide 11 shows both an available form and the Draft/Open versus Submitted/View and print controls. Slides 13 and 23 make the submission result readable; slide 15 shows the actual Submit registration action and Registered result; slide 25 shows the actual Sign out control. Slide 21 now includes all four fictional clubs, including Riverton's registered row. These changes resolve the four original crop findings.

The final machine-readable checks report **25 slides, 42 embedded picture shapes, 34 unique captured states, no HTML text overflow, no failed image loads, valid Office packages and shape bounds**, with 25 presentation PDF bookmarks and the three-page quick-start retained. These results were read from `orientation-checks.json` and `render-checks.json`; the independent visual pass complements them rather than rerunning the renderer.

The final slide 21 was inspected again after its gold 1/2/3 markers moved outside the left edge of the relevant rows. Riverton's Registered/six-person count, Pine Grove's Draft state and Lakeview's Waitlisted/four-person count are now unobscured and agree with the captions. The final capture register was rehashed after changing the shared event confirmation crop to `event-saved-confirmation.png`: all **34** file hashes match. The original local event check-in QR is excluded from that shared confirmation image; the source hash and pixel crop coordinates are retained in the register.

**Final outcome:** the identified visual findings are resolved. No further essential source, state, permission, sensitive-code or spoken-note correction was identified in the inspected final material. This is a visual/content review of local synthetic training assets; its scope and the production/accessibility limits above still apply.
