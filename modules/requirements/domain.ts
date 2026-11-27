/**
 * Requirement text for honors, and later classes (#2054, #1689). One set is
 * the numbered requirements of one honor (or class level) in one language,
 * from one recorded source (`./sources.ts`). A top-level requirement has an
 * empty label; its lettered parts follow it with the same number.
 */

/** One stored line, in order. */
export type RequirementLine = {
  section: string;
  number: number;
  /** Empty for the requirement itself; `a`, `b`, or `a.ii` for its parts. */
  label: string;
  text: string;
};

export type RequirementPart = { label: string; depth: 1 | 2; text: string };
export type RequirementItem = { number: number; text: string; parts: RequirementPart[] };
export type RequirementSection = { title: string; items: RequirementItem[] };

/** What the credit line under requirement text needs; copied onto each set when it is imported. */
export type RequirementCredit = {
  sourceName: string;
  sourceUrl: string;
  license: string;
  licenseUrl: string;
  retrievedOn: string;
};

export const REQUIREMENT_LABEL_PATTERN = /^[a-z]{1,2}(?:\.[a-z0-9]{1,6})?$/;
export const MAX_REQUIREMENT_TEXT = 4000;
export const MAX_REQUIREMENT_SECTION = 120;

/** How deep a part sits: `a` is 1, `a.ii` is 2. */
export function requirementPartDepth(label: string): 1 | 2 {
  return label.includes(".") ? 2 : 1;
}

/**
 * Lines grouped for display: sections in order of first appearance, then
 * each top-level requirement with its parts. A part whose requirement line is
 * missing is shown under a requirement with empty text rather than dropped.
 */
export function groupRequirements(lines: readonly RequirementLine[]): RequirementSection[] {
  const sections: RequirementSection[] = [];
  const sectionByTitle = new Map<string, RequirementSection>();
  const itemByKey = new Map<string, RequirementItem>();
  for (const line of lines) {
    let section = sectionByTitle.get(line.section);
    if (!section) {
      section = { title: line.section, items: [] };
      sectionByTitle.set(line.section, section);
      sections.push(section);
    }
    const key = `${line.section}\u0000${line.number}`;
    let item = itemByKey.get(key);
    if (!item) {
      item = { number: line.number, text: "", parts: [] };
      itemByKey.set(key, item);
      section.items.push(item);
    }
    if (line.label) item.parts.push({ label: line.label, depth: requirementPartDepth(line.label), text: line.text });
    else item.text = line.text;
  }
  return sections;
}

/** How many requirements a set has: top-level ones only, the unit a leader signs off (#2053, #1689). */
export function countTopLevelRequirements(lines: readonly Pick<RequirementLine, "label">[]) {
  return lines.filter((line) => line.label === "").length;
}

/** Two sets say the same thing: same lines, in the same order. */
export function sameRequirementLines(a: readonly RequirementLine[], b: readonly RequirementLine[]) {
  return a.length === b.length && a.every((line, index) => {
    const other = b[index]!;
    return line.section === other.section && line.number === other.number && line.label === other.label && line.text === other.text;
  });
}

/** A `YYYY-MM-DD` calendar date that exists. */
export function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** "November 27, 2026" for a stored `YYYY-MM-DD` date, read as a calendar date (no time zone shift). */
export function formatRetrievedOn(value: string) {
  if (!isCalendarDate(value)) return value;
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" });
}
