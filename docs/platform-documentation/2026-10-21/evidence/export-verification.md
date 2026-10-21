# Export verification — October 21, 2026

The pack contains five reference documents, a 31-slide user orientation, spoken presenter notes and a three-page quick-start handout. Markdown is the editable text source; Word and PowerPoint provide editable Office copies; PDF companions support sharing. The five reference reports retain their original content and exports.

## Content checks

The original independent review checked all five reference documents and the earlier briefing. It verified 324 Markdown HTTPS references against the pinned repository paths, nine runtime help-template tokens against the current allowlist, and valid JSON evidence. Those unchanged reports retain their review evidence. The revised user orientation has a separate source/content record in `orientation-verification.md` and `orientation-checks.json`.

Deck copy spacing and directory-link refinements identified by that review were corrected before final exports. Current/gated/future claims and source references were rechecked while producing the slide deck.

## Export checks

- All eight PDF files opened successfully and contain extractable text and a tagged structure. Document/notes PDFs have heading outlines; the revised presentation has slide-title bookmarks. Tagging alone does not certify accessible reading order or PDF/UA.
- The presentation has 31 slides, spoken notes on every slide, valid Office package structure and shapes within slide bounds.
- All seven Word packages passed ZIP integrity checks; the documents retain headings, tables and hyperlinks.
- The revised HTML presentation was checked after font loading: zero overflowing text boxes. The revised notes and quick-start HTML fit the tested 1280px viewport without horizontal document overflow; the five unchanged reference documents retain the original checks.
- Page contact sheets were generated for every PDF. The deck, feature/camp/technical contact sheets and full-size usability, help and deck detail pages were visually inspected for obvious clipping, overlap, broken glyphs and layout problems. Table widths were adjusted before final export.
- These checks validate the generated documentation assets. They are separate from the actual application CI evidence in the technical report and do not constitute a live production, assistive-technology or physical printer audit.

Machine-readable records: `render-checks.json`, `pdf-manifest.json` and `office-pdf-structure-checks.json`. The technical report records actual GitHub Actions evidence by revision/run rather than treating configured checks as passed.
