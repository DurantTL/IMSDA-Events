# Export verification — November 5, 2026 (screenshots refreshed November 6)

## What was checked

- **Deck:** 31 slides, 77 embedded pictures (screenshots and the IMAdventist symbol), every picture has alternative text, every slide has speaker notes. Titles, bullets and captions are editable text; screenshots are embedded images. The PowerPoint and its PDF open without errors.
- **PDFs:** all eight open, contain selectable text and are tagged. Page counts: deck 31, presenter notes 22, quick-start 5, reports 01–05 between 10 and 13. Tags alone do not prove PDF/UA or WCAG conformance.
- **Word files:** all seven pass a ZIP integrity check.
- **Web pages:** all eight HTML files were opened at 390 px and 1280 px wide. None scrolls sideways. Every image loads (the gallery loads its pictures as you scroll).
- **Links:** every local link in the README and content files points to a file that exists. The `{{portal_url}}` entries in the help kit are runtime template tokens, not links.
- **Product name:** "IMSDA Events" does not appear in the deck, notes, handout or reports.
- **No earlier training assumed:** revised the same day so the deck, presenter notes, handout and report notes are written for first-time users. No slide or page refers to an October training, a renamed product or features that "moved".
- **Screenshots:** 44, each recorded in `screenshot-capture.json` with route, state, pixel size, SHA-256 and the slides that use it. The full contact sheet and each deck page were looked at by eye.
- **Fact check:** an independent read-only review compared the deck text and the quick-start handout with the current application source. Its findings were fixed before publishing; see the pull request for the list.

- **Print edition (added November 6):** 16 US Letter portrait pages with two slides each (slide 31 alone), built from the screen deck's text and speaker notes and the original screenshots by `print/build-print-edition.py`. Every page was looked at by eye. Each crop keeps the pink numbered marker its caption names. Both slides on a page share one screenshot scale where the layout allows.
- **TV edition (added November 6):** 47 16:9 slides covering the 31 deck slides, built by `print/build-tv-edition.py` from the same text, speaker notes and screenshots. Body text is 22 point, captions 18 point, titles 34 point. Every slide was looked at by eye. Each crop keeps the pink numbered marker its caption names. Not tried on a physical 32-inch TV.

- **Screenshot refresh (November 6):** all 44 screenshots retaken from main `9c676ff` at 2560 × 1800 pixels with the same names; each SHA-256 in `screenshot-capture.json` matches its file. Every screenshot was compared side by side with its November 5 version: same part of the page, same story state, and each pink marker on the same control. In the screen deck each picture was replaced in place (matched by the old SHA-256), so positions, sizes and crops are unchanged; all 43 pictures the deck uses now match the new files and none of the old ones remain. The print and TV editions were rebuilt from it, with crop boxes moved where the layout shifted; every crop that has a marker still contains it. All 31 screen slides, 16 print pages and 47 TV slides were rendered and looked at. The presenter-notes PDF was reprinted from its web page (22 pages, tagged) after the wording fixes.

## What was not checked

- No new application test run. Reports 02–05 keep their October 21 evidence and were not re-audited.
- No production check. The screenshots show the app at main `9c676ff` with fictional data on a local server, not the live site's settings.
- No assistive-technology test. The print edition was checked as a rendered PDF on screen, not on a physical printer.
