# Screenshot demo provenance

Captured October 21, 2026 from the actual application at source commit `7f77c1dfeadd004deb51f91e2bae1b6c4754638b` in an isolated local development worktree. The application worktree was clean after capture; no application source was changed. The training database is a new local PostgreSQL database, not a copy of production. Its migrations and the repository’s synthetic seed were applied locally. Demo-only fixture/capture helpers and local session files remain outside the documented application tree and are excluded from the training package.

## Fictional people, clubs and events

All names, clubs, contact details, records, dates and registrations are fabricated training examples. Addresses use `example.test`; telephone numbers use the reserved 555-01xx range. The real IMSDA branding and current UI labels are retained. Fixture identifiers use the `training_` prefix.

- Director: Jordan Ellis; Riverton Pathfinders; Riverton Community Church. Club year 2026–27.
- Area Coordinator: Alex Morgan. The current coordinator interface can view all active clubs; these captures do not imply an enforced assigned-area filter.
- Other fictional clubs: Pine Grove Pathfinders, Lakeview Pathfinders and Cedar Hill Pathfinders.
- Fictional member added through the actual Add to roster dialog: Morgan Reed. The Riverton roster changes from 9 active people to 10, including 9 youth and director Jordan.
- Honors: Camping Skills I, First Aid, Basic, Community Service and Stars; 8 sample honor records, split 4 completed / 4 in progress.
- Club forms: a valid submitted Transportation Passenger List with 3 fictional passengers, saved through the application’s form service; a saved Off-Premises Permission Slip draft for Morgan. Medical answers are not displayed. No real consent or health record was used.
- Meeting notes: October 3, 10 and 17; fictional attendance headcounts, CampingSkills I and activity notes.
- September reports: Riverton submitted onOct 8, 410 points; Pine Grove Draft; Lakeview Missing; Cedar Hill submitted late onOct 14, 385 points. September was due Oct 10, so the captured director cannot submit or change it on Oct 21.
- October report: shown first as Draft, then submitted through the actual UI for a demonstrative before/after. The real UI allows this and displays due Nov 10. This is a completed fictional report used to demonstrate the final Submit action; it does not instruct clubs to submit incomplete real months. After this action Riverton shows 2 submitted reports, 820 report points, 1,500 yearly registration points and 2,320 year points.
- Fall Camporee: November 6–8 at Example Ridge Campground; registration closes Oct 30. The director selects 6 fictional people, continues through the real Contact / Roster / Review form and submits locally. The actual API returns 201. A fresh page shows Registered, 6 going, Print club packet and Download registration PDF. No external confirmation email was sent.
- The coordinator’s event comparison shows Riverton Registered 6, Pine Grove Draft, Lakeview Waitlisted 4, Cedar Hill Cancelled 3. Only the registered club contributes 6 to the event’s registered attendance total.

## Capture method and exclusions

Chromium/Playwright captured the actual app at 1280 × 900 CSS pixels with device scale 2. Data tables were captured as full pages where helpful; open dialogs were captured in the viewport and scrolled to show their real action buttons. Separate captures show the top fields and footer actions of the roster dialog. Cropping and slide annotations are presentation treatment, not application redesign.

The Next.js developer overlay was hidden in captures. The development-only email-code panel was also hidden in the email-verification screenshot; the actual six-digit-code input is empty. No usable authenticator setup key, recovery code, sign-in password or session cookie is in a screenshot or artifact. The sign-up UI is reached by an actual local request with the fictional `jordan.ellis@example.test` address; the same component response deliberately does not reveal whether that account already exists. The invitation screenshot represents an earlier role-invitation stage using a separate local account fixture; crop the invitation card to avoid presenting its staging-only email alias as a second sign-in instruction.

Local sessions were minted only against the synthetic local database using the repository’s existing development-session pattern, with second-factor verification set for the director/coordinator captures. A separate unverified local session captures the real two-step challenge. This capture convenience does not change the application’s authentication or permission rules, and is not a user sign-in instruction.

The screenshot registers record source commit, route, state, pixel dimensions and image SHA-256. They do not contain credentials. Screenshots demonstrate implemented current behavior; proposed future features remain in the separate research/reference documents.
