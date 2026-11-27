import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HonorCategoryLabel, honorCategoryTones } from "@/components/honor-category-label";
import { HonorRequirementPanels, RequirementList } from "@/components/honor-requirements";
import { honorCategoryLabels } from "@/modules/honors/domain";
import { countTopLevelRequirements, formatRetrievedOn, groupRequirements, type RequirementLine } from "@/modules/requirements/domain";
import {
  parseRequirementCsv,
  planRequirementImport,
  REQUIREMENT_CSV_HEADERS,
  RequirementCsvError,
  requirementCsvTemplate,
} from "@/modules/requirements/requirements-csv";
import { PATHFINDER_WIKI, requirementSourceForUrl } from "@/modules/requirements/sources";
import { decodeEntities, parseWikiRequirementsHtml, wikiPageUrl, wikiParseApiUrl, wikiRequirementsTitle } from "@/modules/requirements/wiki-parser";
import { readHonorList } from "@/scripts/fetch-honor-requirements";
import { toCsv } from "@/modules/reporting/csv";

// #2054: requirement text for the honor catalog. Synthetic honors and text only.

const WIKI = "https://wiki.pathfindersonline.org/w/AY_Honors/Sample_Knots/Requirements";
const header = [...REQUIREMENT_CSV_HEADERS];
const row = (over: Partial<Record<(typeof REQUIREMENT_CSV_HEADERS)[number], string>> = {}) => {
  const values: Record<string, string> = {
    Code: "SAMPLE-KNOTS", Honor: "Sample Knots", Language: "en", "Retrieved On": "2026-11-27", "Source URL": WIKI,
    License: "CC BY-SA 3.0", Section: "", Number: "1", Item: "", Text: "Tie three sample knots.", ...over,
  };
  return header.map((column) => values[column] ?? "");
};
const file = (...rows: string[][]) => toCsv([header, ...rows]);
const honors = [
  { id: "h-knots", code: "SAMPLE-KNOTS", name: "Sample Knots" },
  { id: "h-stars", code: "SAMPLE-STARS", name: "Sample Stars" },
];
const lines = (...entries: Array<[number, string, string]>): RequirementLine[] => entries.map(([number, label, text]) => ({ section: "", number, label, text }));

describe("recorded requirement sources (#2054)", () => {
  it("accepts only https pages on the Pathfinder Wiki's hosts", () => {
    expect(requirementSourceForUrl(WIKI)).toBe(PATHFINDER_WIKI);
    expect(requirementSourceForUrl("https://www.wiki.pathfindersonline.org/w/AY_Honors/Sample/Requirements")).toBe(PATHFINDER_WIKI);
    expect(requirementSourceForUrl("http://wiki.pathfindersonline.org/w/AY_Honors/Sample")).toBeNull();
    expect(requirementSourceForUrl("https://wiki.pathfindersonline.org.example.com/w/Sample")).toBeNull();
    expect(requirementSourceForUrl("https://user@wiki.pathfindersonline.org/w/Sample")).toBeNull();
    expect(requirementSourceForUrl("https://guiasmayores.example/sample")).toBeNull();
    expect(requirementSourceForUrl("not an address")).toBeNull();
  });

  it("records the license and its link, for the text only", () => {
    expect(PATHFINDER_WIKI.license).toBe("CC BY-SA 3.0");
    expect(PATHFINDER_WIKI.licenseUrl).toBe("https://creativecommons.org/licenses/by-sa/3.0/");
    expect(PATHFINDER_WIKI.languages).toEqual(["en"]);
  });
});

describe("requirements CSV (#2054)", () => {
  it("offers a template with the columns the import reads", () => {
    expect(requirementCsvTemplate().trim()).toBe(header.map((column) => `"${column}"`).join(","));
  });

  it("reads rows and keeps lettered parts with their requirement", () => {
    const rows = parseRequirementCsv(file(row(), row({ Number: "2", Text: "Do the following:" }), row({ Number: "2", Item: "a.", Text: "Part one" }), row({ Number: "2", Item: "A.II", Text: "Deeper part" })));
    expect(rows.map((entry) => [entry.number, entry.label, entry.text, entry.problems])).toEqual([
      [1, "", "Tie three sample knots.", []],
      [2, "", "Do the following:", []],
      [2, "a", "Part one", []],
      [2, "a.ii", "Deeper part", []],
    ]);
  });

  it("round-trips text the CSV writer guarded against spreadsheet formulas", () => {
    const [parsed] = parseRequirementCsv(file(row({ Text: "-Know the parts of a rope." })));
    expect(parsed!.text).toBe("-Know the parts of a rope.");
  });

  it("keeps the licensed text as written: fractions, superscripts and symbols are not rewritten", () => {
    const [parsed] = parseRequirementCsv(file(row({ Text: "Swim ½ mile and mark an area of 10 m² ™" })));
    expect(parsed!.text).toBe("Swim ½ mile and mark an area of 10 m² ™");
  });

  it("refuses requirement numbers that skip, so a number read out of the text is caught", () => {
    const step = planRequirementImport(parseRequirementCsv(file(row(), row({ Number: "10", Text: "5 metres without stopping." }))), honors, [])[0]!;
    expect(step).toMatchObject({ action: "SKIP", message: "Line 3: requirement 10 should be requirement 2. Numbers run 1, 2, 3 in order; check the file against the source page." });
    expect(planRequirementImport(parseRequirementCsv(file(row({ Number: "2" }))), honors, [])[0]!.action).toBe("SKIP");
    // Each section numbers from 1 again.
    expect(planRequirementImport(parseRequirementCsv(file(row(), row({ Section: "Advanced", Text: "Teach it." }))), honors, [])[0]!.action).toBe("ADD");
  });

  it("names each problem on its row", () => {
    const [parsed] = parseRequirementCsv(file(row({ Code: "", Language: "english", "Retrieved On": "2026-02-30", Number: "0", Item: "7!", Text: "" })));
    expect(parsed!.problems).toEqual([
      "Every row needs an honor code.",
      'Language "english" should be a two-letter code such as en.',
      'Retrieved On "2026-02-30" should be a date like 2026-11-27.',
      'Number "0" should be a whole number from 1.',
      'Item "7!" should be a letter (a, b) or a letter and a part (a.ii).',
      "Every row needs the requirement text.",
    ]);
  });

  it("refuses a file without the template's columns, or an empty one", () => {
    expect(() => parseRequirementCsv("")).toThrow(RequirementCsvError);
    expect(() => parseRequirementCsv("Code,Text\n\"open,Tie\n")).toThrow(RequirementCsvError);
    expect(() => parseRequirementCsv("Code,Text\nSAMPLE-KNOTS,Tie a knot\n")).toThrow(/column names from the template/);
  });

  it("adds an honor's requirements, one step per honor, counting top-level requirements", () => {
    const rows = parseRequirementCsv(file(row(), row({ Number: "2", Text: "Explain:" }), row({ Number: "2", Item: "a", Text: "Why" })));
    const [step] = planRequirementImport(rows, honors, []);
    expect(step).toMatchObject({ action: "ADD", honorId: "h-knots", requirementCount: 2, source: PATHFINDER_WIKI, message: "Will add 2 requirements." });
    expect(step!.lines).toEqual(lines([1, "", "Tie three sample knots."], [2, "", "Explain:"], [2, "a", "Why"]));
  });

  it("skips unchanged text and replaces changed text, keeping the old version", () => {
    const rows = parseRequirementCsv(file(row()));
    const current = [{ id: "set-1", honorId: "h-knots", language: "en", sourceUrl: WIKI, lines: lines([1, "", "Tie three sample knots."]) }];
    expect(planRequirementImport(rows, honors, current)[0]).toMatchObject({ action: "SKIP", message: "Already up to date; nothing to change." });
    // A later retrieval date alone is no change.
    expect(planRequirementImport(parseRequirementCsv(file(row({ "Retrieved On": "2027-01-05" }))), honors, current)[0]!.action).toBe("SKIP");
    const changed = planRequirementImport(parseRequirementCsv(file(row({ Text: "Tie four sample knots." }))), honors, current)[0]!;
    expect(changed).toMatchObject({ action: "REPLACE", replacesSetId: "set-1", message: "Will replace the current text with 1 requirement. The old version is kept." });
  });

  it("refuses text from a source whose license isn't recorded, or under another license", () => {
    const other = planRequirementImport(parseRequirementCsv(file(row({ "Source URL": "https://guiasmayores.example/nudos" }))), honors, [])[0]!;
    expect(other.action).toBe("SKIP");
    expect(other.message).toMatch(/source whose license is recorded/);
    const license = planRequirementImport(parseRequirementCsv(file(row({ License: "All rights reserved" }))), honors, [])[0]!;
    expect(license).toMatchObject({ action: "SKIP", message: "The License should be CC BY-SA 3.0, the license recorded for the Pathfinder Wiki." });
  });

  it("imports English only for now", () => {
    const step = planRequirementImport(parseRequirementCsv(file(row({ Language: "es" }))), honors, [])[0]!;
    expect(step).toMatchObject({ action: "SKIP", message: "Only en text can be imported for now." });
  });

  it("refuses an honor that isn't in the catalog, mixed sources, duplicates and parts before their requirement", () => {
    const plan = (...rows: string[][]) => planRequirementImport(parseRequirementCsv(file(...rows)), honors, [])[0]!;
    expect(plan(row({ Code: "NOT-HERE" })).message).toBe("No honor in the catalog has the code NOT-HERE. Add the honor first.");
    expect(plan(row(), row({ Number: "2", "Source URL": `${WIKI}2` })).message).toBe("Every row for an honor needs the same Source URL.");
    expect(plan(row(), row()).message).toBe("Line 3: requirement 1 is in the file twice.");
    expect(plan(row({ Number: "3", Item: "a", Text: "Orphan part" })).message).toBe("Line 2: part a comes before requirement 3 itself.");
    expect(plan(row({ Number: "x" })).message).toBe('Line 2: Number "x" should be a whole number from 1.');
  });

  it("plans each honor and language separately, in file order", () => {
    const rows = parseRequirementCsv(file(row({ Code: "SAMPLE-STARS", Honor: "Sample Stars" }), row()));
    expect(planRequirementImport(rows, honors, []).map((step) => [step.code, step.action])).toEqual([["SAMPLE-STARS", "ADD"], ["SAMPLE-KNOTS", "ADD"]]);
  });
});

describe("requirement display (#2054)", () => {
  const credit = { sourceName: "Pathfinder Wiki, North American Division Youth Ministries", sourceUrl: WIKI, license: "CC BY-SA 3.0", licenseUrl: PATHFINDER_WIKI.licenseUrl, retrievedOn: "2026-11-27" };

  it("groups lines into numbered requirements with their parts", () => {
    const sections = groupRequirements([
      ...lines([1, "", "One"], [2, "", "Two:"], [2, "a", "Part a"], [2, "a.i", "Part a.i"]),
      { section: "Advanced", number: 1, label: "", text: "Advanced one" },
    ]);
    expect(sections).toEqual([
      { title: "", items: [{ number: 1, text: "One", parts: [] }, { number: 2, text: "Two:", parts: [{ label: "a", depth: 1, text: "Part a" }, { label: "a.i", depth: 2, text: "Part a.i" }] }] },
      { title: "Advanced", items: [{ number: 1, text: "Advanced one", parts: [] }] },
    ]);
    expect(countTopLevelRequirements(lines([1, "", "One"], [2, "", "Two"], [2, "a", "Part"]))).toBe(2);
    expect(formatRetrievedOn("2026-11-27")).toBe("November 27, 2026");
  });

  it("always shows the credit line, linking the source page and the license", () => {
    const html = renderToStaticMarkup(createElement(RequirementList, { credit, sections: groupRequirements(lines([1, "", "One"], [2, "", "Two:"], [2, "b", "Part b"])) }));
    expect(html).toContain('<li value="1"><p');
    expect(html).toContain(">b.</span>");
    expect(html).toContain(`href="${WIKI}"`);
    expect(html).toContain('rel="license noopener noreferrer"');
    expect(html).toContain("Pathfinder Wiki, North American Division Youth Ministries</a>");
    expect(html).toContain(">CC BY-SA 3.0</a>");
    expect(html).toContain("Retrieved November 27, 2026.");
  });

  it("shows an honor's category as a colored label, and an empty state with the next step when there is no text", () => {
    const html = renderToStaticMarkup(createElement(HonorRequirementPanels, {
      emptyHint: "Import them on the Honor catalog.",
      honor: { code: "SAMPLE-KNOTS", category: "RECREATION", isActive: true },
      requirements: null,
    }));
    expect(html).toContain('class="status-chip green" data-honor-category="RECREATION">Recreation</span>');
    expect(html).toContain("No requirements yet");
    expect(html).toContain("Import them on the Honor catalog.");
    expect(html).not.toContain("data-requirement-credit");
  });

  it("gives every category a shared chip tone and names it in words", () => {
    expect(Object.keys(honorCategoryTones).sort()).toEqual(Object.keys(honorCategoryLabels).sort());
    for (const tone of Object.values(honorCategoryTones)) expect(["green", "purple", "coral", "gold", "neutral"]).toContain(tone);
    expect(renderToStaticMarkup(createElement(HonorCategoryLabel, { category: null }))).toBe("");
    expect(renderToStaticMarkup(createElement(HonorCategoryLabel, { category: "MASTER_AWARDS" }))).toContain(">Master Awards</span>");
  });
});

describe("requirement sets migration (#2054)", () => {
  const sql = readFileSync("prisma/migrations/20270198100000_requirement_sets/migration.sql", "utf8");

  it("is additive, ties a set to exactly one subject, and keeps one current set per subject and language", () => {
    expect(sql).not.toMatch(/\bDROP\b|ALTER TABLE "Honor"/);
    expect(sql).toMatch(/"RequirementSet_subject_check" CHECK \(\s*\("subject" = 'HONOR' AND "honorId" IS NOT NULL AND "classLevel" IS NULL\)\s*OR \("subject" = 'CLASS' AND "classLevel" IS NOT NULL AND "honorId" IS NULL\)/);
    expect(sql).toContain(`CREATE UNIQUE INDEX "RequirementSet_one_current_per_honor" ON "RequirementSet"("honorId", "language") WHERE "retiredAt" IS NULL AND "honorId" IS NOT NULL;`);
    expect(sql).toContain(`CREATE UNIQUE INDEX "RequirementSet_one_current_per_class" ON "RequirementSet"("classLevel", "language") WHERE "retiredAt" IS NULL AND "classLevel" IS NOT NULL;`);
    expect(sql).toContain(`FOREIGN KEY ("honorId") REFERENCES "Honor"("id") ON DELETE RESTRICT`);
  });
});

describe("Pathfinder Wiki reader (#2054)", () => {
  it("reads numbered paragraphs and lettered parts, and drops the info box, edit links and footnotes", () => {
    const html = `
      <table class="infobox"><tr><td>Skill Level 1</td></tr></table>
      <div id="toc" class="toc"><div><ul><li>Contents</li></ul></div></div>
      <p>This page lists the requirements.</p>
      <h2><span class="mw-headline">Requirements</span><span class="mw-editsection"><span>[</span>edit<span>]</span></span></h2>
      <p>1. Know the parts of a sample rope.<sup class="reference">[1]</sup></p>
      <p>2. Do the following:</p>
      <p>a. Tie a &quot;sample&quot; knot.</p>
      <p>b. Explain when to use it &amp; why.</p>
      <h2>References</h2>
      <p>3. Not a requirement.</p>`;
    expect(parseWikiRequirementsHtml(html)).toEqual(lines(
      [1, "", "Know the parts of a sample rope."],
      [2, "", "Do the following:"],
      [2, "a", 'Tie a "sample" knot.'],
      [2, "b", "Explain when to use it & why."],
    ));
  });

  it("numbers ordered lists by position, letters nested lists and keeps roman sub-parts under their letter", () => {
    const html = `<ol>
      <li>Be at least ten years old.</li>
      <li>Identify the following:<ol>
        <li>Sample one<ol type="i"><li>first detail</li><li>second detail</li></ol></li>
        <li>Sample two</li>
      </ol></li>
    </ol><ol start="3"><li>Visit a sample place.</li></ol>`;
    expect(parseWikiRequirementsHtml(html)).toEqual(lines(
      [1, "", "Be at least ten years old."],
      [2, "", "Identify the following:"],
      [2, "a", "Sample one"],
      [2, "a.i", "first detail"],
      [2, "a.ii", "second detail"],
      [2, "b", "Sample two"],
      [3, "", "Visit a sample place."],
    ));
  });

  it("reads a decimal at the start of a line as text, not a new requirement", () => {
    expect(parseWikiRequirementsHtml("<p>1. Swim the following:</p><p>2.5 km without stopping.</p><p>2. Float.</p>")).toEqual(lines(
      [1, "", "Swim the following: 2.5 km without stopping."],
      [2, "", "Float."],
    ));
  });

  it("joins text after a nested list to the item that holds the list, not its last part", () => {
    const html = "<ol><li>Know these knots:<ol><li>Square</li><li>Bowline</li></ol>and explain their uses.</li><li>Tie them.</li></ol>";
    expect(parseWikiRequirementsHtml(html)).toEqual(lines(
      [1, "", "Know these knots: and explain their uses."],
      [1, "a", "Square"],
      [1, "b", "Bowline"],
      [2, "", "Tie them."],
    ));
  });

  it("treats i. after h. as a letter, and joins a number with the paragraph after it", () => {
    const html = "<p>1.</p><p>Name eight samples:</p><p>h. Eighth</p><p>i. Ninth</p>";
    expect(parseWikiRequirementsHtml(html)).toEqual(lines([1, "", "Name eight samples:"], [1, "h", "Eighth"], [1, "i", "Ninth"]));
  });

  it("builds the page title, page address and parse address", () => {
    expect(wikiRequirementsTitle(" Sample Knots ")).toBe("AY Honors/Sample Knots/Requirements");
    expect(wikiPageUrl("AY Honors/Sample Knots/Requirements")).toBe("https://wiki.pathfindersonline.org/w/AY_Honors/Sample_Knots/Requirements");
    expect(requirementSourceForUrl(wikiPageUrl("AY Honors/Sample Knots/Requirements"))).toBe(PATHFINDER_WIKI);
    const api = new URL(wikiParseApiUrl("AY Honors/Sample Knots/Requirements"));
    expect(api.host).toBe("wiki.pathfindersonline.org");
    expect(Object.fromEntries(api.searchParams)).toMatchObject({ action: "parse", page: "AY Honors/Sample Knots/Requirements", prop: "text", redirects: "1" });
    expect(decodeEntities("&#8217;&#x2014;&nbsp;&bogus;")).toBe("’— &bogus;");
  });

  it("reads the honors list the script fetches, with an optional page override", () => {
    expect(readHonorList("Code,Name,Wiki Page\nSAMPLE-KNOTS,Sample Knots,\nSAMPLE-STARS,Sample Stars,AY Honors/Stars/Requirements\n,No code,\n")).toEqual([
      { code: "SAMPLE-KNOTS", name: "Sample Knots", title: "AY Honors/Sample Knots/Requirements" },
      { code: "SAMPLE-STARS", name: "Sample Stars", title: "AY Honors/Stars/Requirements" },
    ]);
  });
});
