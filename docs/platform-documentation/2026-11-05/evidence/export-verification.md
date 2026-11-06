# Export verification — November 5, 2026

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

- **Print edition (added November 6):** 31 US Letter portrait pages, one per slide, built from the screen deck's text and speaker notes and the original screenshots by `print/build-print-edition.py`. Every page was looked at by eye. Each crop keeps the pink numbered marker its caption names. Screenshot text prints about twice as large as the screen deck printed on landscape Letter.

## What was not checked

- No new application test run. Reports 02–05 keep their October 21 evidence and were not re-audited.
- No production check. The screenshots show the app at main `ad9237d` with fictional data on a local server, not the live site's settings.
- No assistive-technology test. The print edition was checked as a rendered PDF on screen, not on a physical printer.
