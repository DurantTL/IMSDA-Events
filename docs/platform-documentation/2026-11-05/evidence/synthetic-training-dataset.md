# Fictional training data

Screenshots retaken November 6, 2026 from main `9c676ff` on a local development server with a freshly migrated and seeded local PostgreSQL database. It is not a copy of production. The seed's own clubs were hidden so the coordinator screens show only the training clubs. Every training row uses the `training_` id prefix. Emails use `example.test`; phone numbers use the (515) 555-01xx range.

## People, clubs and events

- **Director:** Jordan Ellis, Riverton Pathfinders, Riverton Community Church. Club year 2026–27. Two-step sign-in is on (a placeholder enrolment; the capture session is minted already verified).
- **Area Coordinator:** Alex Morgan.
- **Other clubs and directors:** Pine Grove Pathfinders (Casey Nguyen), Lakeview Pathfinders (Sam Okafor), Cedar Hill Pathfinders (Robin Alvarez). Their rosters have 7, 5 and 8 youth.
- **Riverton roster:** 8 youth (Avery Chen, Drew Patel, Harper Lewis, Jesse Kim, Logan Rivera, Mia Santos, Noah Brooks, Zoe Turner) plus Jordan as staff. **Morgan Reed** is added through the real Add to roster dialog, making 10.
- **Monthly Records:** Riverton September submitted October 8; October starts as a draft and is submitted through the real form (385 points each, 770 for the year). Cedar Hill September submitted late October 14 and October submitted November 3. Pine Grove has a September draft. Lakeview has none.
- **Meeting notes:** Riverton, October 4, 11, 18 and 25.
- **Honors:** Camping Skills I, First Aid Basic, Community Service, Stars and Knot Tying. Eight records: 4 completed, 4 in progress.
- **Class tracking:** Avery Chen completed Friend on October 18. The Friend insignia set (name strip, chevron, pin, ribbon bar) is in the catalog, so the page suggests it.
- **Orders:** Pathfinder Scarf stock 2. Good Conduct Bar stock 3 with Drew Patel's received need. The real **Mark handed out** action lowers the stock to 2.
- **Year-End Report:** Pathfinder year 2026–27 (May 1, 2026 to April 30, 2027, due April 1, 2027). Opened and saved as a draft through the real page. Not submitted.
- **New club application:** Prairie View Adventurers, pending, public source.
- **Winter Camporee:** club event, December 4–6, 2026, registration open October 15 to November 25, church-billed. Jordan selects everyone (10 people) and submits through the real registration pages. No email is sent: the local app has no mail provider configured and saves a local preview only.

## Method

Chromium (Playwright) at 1280 × 900 CSS pixels, device scale 2. Passkey sign-in is switched on for the local site, so the sign-in page shows its passkey button. Class tracking is captured before the Good Conduct Bar hand-out; the insignia suggestions after it. The Next.js development overlay is hidden. Pink numbered outlines are drawn in the page just before the screenshot and removed after; they are training annotations, not app controls. Each screenshot's route, state and SHA-256 are in `screenshot-capture.json`.

The first capture was taken November 5 from main `ad9237d`. For the November 6 refresh the fixture and capture scripts were recreated from this description, the database was migrated and seeded fresh, and all 44 screenshots were retaken with the same names, framing and markers. The scripts were run locally and are not part of the repository, the same as for the October pack. No real person, club, password, authenticator secret, recovery code, private link or production record was used or appears in any screenshot.
