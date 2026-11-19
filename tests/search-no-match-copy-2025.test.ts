import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NO_MATCH_LINE } from "../scripts/support/site-rule-checks";
import { clubHonorsEmptyCopy } from "../modules/honors/member-honor-domain";

/**
 * S4 (#2025): typing text that matches nothing must say so in words the browser check recognises. These staff pages
 * said "No club matches that search" and "No one matches these filters", which the check does not read as a no-match line.
 */
const root = path.resolve(__dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("no-match lines on the club staff searches (S4, #2025)", () => {
  it("the Year-End search says no clubs match", () => {
    const line = /No clubs? match[^<"`]*/.exec(read("components/club-year-end-conference.tsx"))?.[0] ?? "";
    expect(line).not.toBe("");
    expect(NO_MATCH_LINE.test(line)).toBe(true);
  });

  it("the honors search says no people match", () => {
    expect(NO_MATCH_LINE.test(clubHonorsEmptyCopy.NO_MATCH)).toBe(true);
  });

  it("the roster search says no people match", () => {
    const line = /"(No people match these filters)"/.exec(read("components/club-roster-workspace.tsx"))?.[1] ?? "";
    expect(NO_MATCH_LINE.test(line)).toBe(true);
  });

  it("the wording the check rejects is gone", () => {
    expect(NO_MATCH_LINE.test("No club matches that search in this tab.")).toBe(false);
    expect(NO_MATCH_LINE.test("No one matches these filters")).toBe(false);
    expect(read("components/club-year-end-conference.tsx")).not.toContain("No club matches that search");
  });
});

describe("no-match line on the staff search (S4, #2025)", () => {
  it("says no staff match that search, in words the check recognises", () => {
    expect(NO_MATCH_LINE.test("No staff match that search.")).toBe(true);
    expect(read("components/staff-workspace.tsx")).toContain('searchTitle="No staff match that search."');
  });

  it("narrows while typing, with no Enter, and never gates on Enter", () => {
    const source = read("components/staff-workspace.tsx");
    expect(source).toContain("useClientSearch()");
    expect(source).toContain("search.inputProps");
    expect(source).not.toMatch(/<form[^>]*onSubmit=\{[^}]*search/);
  });

  it("does not widen the check to near misses", () => {
    for (const line of ["Nothing to show", "No staffing", "Staff match that search", "No staff here"]) expect(NO_MATCH_LINE.test(line), line).toBe(false);
  });
});
