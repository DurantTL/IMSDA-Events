import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatPersonName } from "@/lib/person-name";

/**
 * Names look the same everywhere (#1454, behavior-audit rule 13, break 8).
 * "First Last" on screen; "Last, First" only in sorted lists and exports, written through
 * `formatPersonName(person, "sorted")`. Synthetic names only.
 */
describe("formatPersonName", () => {
  it("writes First Last by default", () => {
    expect(formatPersonName({ firstName: "Ada", lastName: "Lovelace" })).toBe("Ada Lovelace");
    expect(formatPersonName({ firstName: "Ada", lastName: "Lovelace" }, "display")).toBe("Ada Lovelace");
  });

  it("writes Last, First for the sorted form", () => {
    expect(formatPersonName({ firstName: "Ada", lastName: "Lovelace" }, "sorted")).toBe("Lovelace, Ada");
  });

  it("collapses to whichever part exists, with no stray space or comma", () => {
    for (const form of ["display", "sorted"] as const) {
      expect(formatPersonName({ firstName: "Ada", lastName: "" }, form)).toBe("Ada");
      expect(formatPersonName({ firstName: "", lastName: "Lovelace" }, form)).toBe("Lovelace");
      expect(formatPersonName({ firstName: "Ada", lastName: null }, form)).toBe("Ada");
      expect(formatPersonName({ firstName: undefined, lastName: "Lovelace" }, form)).toBe("Lovelace");
      expect(formatPersonName({ firstName: null, lastName: null }, form)).toBe("");
      expect(formatPersonName({}, form)).toBe("");
    }
  });

  it("trims each part", () => {
    expect(formatPersonName({ firstName: "  Ada ", lastName: " Lovelace  " })).toBe("Ada Lovelace");
    expect(formatPersonName({ firstName: "  Ada ", lastName: " Lovelace  " }, "sorted")).toBe("Lovelace, Ada");
    expect(formatPersonName({ firstName: "   ", lastName: "Lovelace" }, "sorted")).toBe("Lovelace");
    expect(formatPersonName({ firstName: "   ", lastName: "  " })).toBe("");
  });

  it("keeps spaces inside a part", () => {
    expect(formatPersonName({ firstName: "Mary Ann", lastName: "de la Cruz" })).toBe("Mary Ann de la Cruz");
  });
});

const FIRST = String.raw`[^{}\x60]*[Ff]irst_?[Nn]ame[^{}\x60]*|first`;
const LAST = String.raw`[^{}\x60]*[Ll]ast_?[Nn]ame[^{}\x60]*|last`;
const FIRST_ID = String.raw`[\w$.?!]*[Ff]irst_?[Nn]ame\w*`;
const LAST_ID = String.raw`[\w$.?!]*[Ll]ast_?[Nn]ame\w*`;

const assemblyPatterns: { label: string; pattern: RegExp }[] = [
  { label: "template literal First Last", pattern: new RegExp(String.raw`\$\{(?:${FIRST})\} \$\{(?:${LAST})\}`, "g") },
  { label: "template literal Last, First", pattern: new RegExp(String.raw`\$\{(?:${LAST})\}, \$\{(?:${FIRST})\}`, "g") },
  { label: "JSX First Last", pattern: new RegExp(String.raw`\{(?:${FIRST_ID})\} \{(?:${LAST_ID})\}`, "g") },
  { label: "JSX Last, First", pattern: new RegExp(String.raw`\{(?:${LAST_ID})\}, \{(?:${FIRST_ID})\}`, "g") },
  {
    label: "array join",
    pattern: new RegExp(String.raw`\[\s*(?:${FIRST_ID})\s*,\s*(?:${LAST_ID})\s*\]\s*(?:\.filter\(Boolean\)\s*)?\.join\(\s*["'] ?,? ?["']\s*\)`, "g"),
  },
  {
    label: "string concatenation",
    pattern: new RegExp(String.raw`(?:${FIRST_ID})\s*\+\s*["'],? ?["']\s*\+\s*(?:${LAST_ID})|(?:${LAST_ID})\s*\+\s*["'],? ?["']\s*\+\s*(?:${FIRST_ID})`, "g"),
  },
];

/**
 * Files that may still assemble a name inline, with how many places. Keep this small.
 * Anything on screen or in an export uses `formatPersonName` instead.
 */
const PENDING = "pending #1445/#1435 merge; follow-up";
const ALLOWLIST: Record<string, { count: number; reason: string }> = {
  "app/(public)/account/(portal)/area-clubs/health/[eventId]/[organizationId]/[memberId]/page.tsx": { count: 1, reason: PENDING },
  "app/(public)/account/(portal)/clubs/[organizationId]/events/[eventId]/page.tsx": { count: 2, reason: PENDING },
  "app/(public)/account/(portal)/clubs/[organizationId]/events/[eventId]/schedule/page.tsx": { count: 1, reason: PENDING },
  "app/(public)/account/(portal)/clubs/[organizationId]/roster/[memberId]/health/page.tsx": { count: 2, reason: PENDING },
  "app/(workspace)/check-in/passes/page.tsx": { count: 2, reason: PENDING },
  "app/(workspace)/more/health-records/[organizationId]/[memberId]/page.tsx": { count: 1, reason: PENDING },
  "app/(workspace)/more/honors/rosters/page.tsx": { count: 5, reason: PENDING },
  "app/(workspace)/more/reports/page.tsx": { count: 3, reason: PENDING },
  "app/(workspace)/overview/page.tsx": { count: 1, reason: PENDING },
  "components/background-check-flags.tsx": { count: 1, reason: PENDING },
  "components/check-in-station.tsx": { count: 2, reason: PENDING },
  "components/check-in-workspace.tsx": { count: 6, reason: PENDING },
  "components/club-class-picker.tsx": { count: 1, reason: PENDING },
  "components/club-earned-awards-workspace.tsx": { count: 11, reason: PENDING },
  "components/club-form-roster-add.tsx": { count: 1, reason: PENDING },
  "components/club-guardians-panel.tsx": { count: 1, reason: PENDING },
  "components/club-honors-workspace.tsx": { count: 7, reason: PENDING },
  "components/club-import-workspace.tsx": { count: 2, reason: PENDING },
  "components/club-meeting-notes.tsx": { count: 1, reason: PENDING },
  "components/club-member-honors-dialog.tsx": { count: 1, reason: PENDING },
  "components/club-order-workspace.tsx": { count: 2, reason: PENDING },
  "components/club-packet-sheet.tsx": { count: 1, reason: PENDING },
  "components/club-registration-editor.tsx": { count: 6, reason: PENDING },
  "components/club-registration-workspace.tsx": { count: 5, reason: PENDING },
  "components/club-roster-carry-forward.tsx": { count: 1, reason: PENDING },
  "components/club-roster-workspace.tsx": { count: 9, reason: PENDING },
  "components/club-transfer-queue.tsx": { count: 1, reason: PENDING },
  "components/club-uniform-section.tsx": { count: 3, reason: PENDING },
  "components/director-sterling-followup.tsx": { count: 1, reason: PENDING },
  "components/duplicate-match-review-workspace.tsx": { count: 1, reason: PENDING },
  "components/finance-workspace.tsx": { count: 6, reason: PENDING },
  "components/group-registration-editor.tsx": { count: 3, reason: PENDING },
  "components/import-workspace.tsx": { count: 1, reason: PENDING },
  "components/member-class-history.tsx": { count: 3, reason: PENDING },
  "components/pending-teams-review.tsx": { count: 1, reason: PENDING },
  "components/people-workspace.tsx": { count: 12, reason: PENDING },
  "components/public-registration-form.tsx": { count: 1, reason: PENDING },
  "components/registration-amendment-editor.tsx": { count: 3, reason: PENDING },
  "components/registration-builder/builder-preview.tsx": { count: 1, reason: PENDING },
};

const SCAN_DIRS = ["app", "components", "modules", "lib"];
const ROOT = process.cwd();

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== ".next") found.push(...sourceFiles(relative));
    } else if (/\.tsx?$/.test(entry.name)) {
      found.push(relative);
    }
  }
  return found;
}

function assemblyCount(source: string) {
  return assemblyPatterns.reduce((total, { pattern }) => total + (source.match(pattern)?.length ?? 0), 0);
}

describe("person names are assembled in one place (#1454)", () => {
  const files = SCAN_DIRS.flatMap(sourceFiles).filter((file) => file !== "lib/person-name.ts");

  it("scans the source tree", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it("finds the inline shapes it is meant to ban", () => {
    const sample = [
      "`${p.firstName} ${p.lastName}`",
      "`${p.lastName}, ${p.firstName}`",
      "<b>{p.firstName} {p.lastName}</b>",
      "<b>{p.lastName}, {p.firstName}</b>",
      '[p.firstName, p.lastName].filter(Boolean).join(" ")',
      'p.firstName + " " + p.lastName',
    ];
    for (const line of sample) expect(assemblyCount(line), line).toBeGreaterThan(0);
    expect(assemblyCount("`${firstNight} ${lastNight}`")).toBe(0);
    expect(assemblyCount("formatPersonName(p)")).toBe(0);
  });

  it("has no inline First Last or Last, First outside the allowlist", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const count = assemblyCount(readFileSync(path.join(ROOT, file), "utf8"));
      const allowed = ALLOWLIST[file]?.count ?? 0;
      if (count !== allowed) offenders.push(`${file}: found ${count}, allowed ${allowed}`);
    }
    expect(offenders).toEqual([]);
  });

  it("keeps every allowlist entry real and explained", () => {
    for (const [file, entry] of Object.entries(ALLOWLIST)) {
      expect(files, file).toContain(file);
      expect(entry.reason.length, file).toBeGreaterThan(10);
      expect(entry.count, file).toBeGreaterThan(0);
    }
    expect(Object.keys(ALLOWLIST).length).toBeLessThanOrEqual(80);
  });
});
