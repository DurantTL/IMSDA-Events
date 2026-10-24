import { rosterRowMissingFields } from "@/modules/club-rosters/domain";

/**
 * The roster page's search, "Details needed" filter, columns and row actions (#1167). All pure: the workspace
 * renders from these, so the rules (who sees which column, which row tools exist, what "needs details" means)
 * are tested without a browser. Nothing here widens access: every input is something the page already decided
 * for the signed-in role, and the server still authorizes every read and write.
 */

type NamedMember = { firstName: string; lastName: string };

/** Lower case, accents and punctuation removed, spaces collapsed: "Zoë  O'Neil," matches "zoe oneil". */
export function normalizeRosterSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[-\u2010-\u2015]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A name search: every word typed must appear in the person's first or last name, in either order
 * ("rivers sam", "sam rivers" and "Rivers, Sam" all find Sam Rivers). A blank search matches everyone.
 */
export function matchesRosterSearch(member: NamedMember, query: string): boolean {
  const words = normalizeRosterSearch(query).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalizeRosterSearch(`${member.firstName} ${member.lastName}`);
  return words.every((word) => haystack.includes(word));
}

type DetailsMember = Parameters<typeof rosterRowMissingFields>[0];

/** The `?filter=` value that opens the roster on the Details needed list. */
export const ROSTER_DETAILS_NEEDED_FILTER = "details-needed";

/**
 * What a person still needs: the roster's own missing-detail flags (`rosterRowMissingFields`). An active person's missing
 * birth date is left out, as on the row, because the birth-date banner says it once (#1004). One rule for the row, the
 * "Details needed" count and the filter, so a Home count and the filtered roster always agree.
 */
export function rosterDetailsNeededItems(member: DetailsMember): string[] {
  return rosterRowMissingFields(member);
}

/** Whether a person belongs in the "Details needed" list. */
export function rosterDetailsNeeded(member: DetailsMember): boolean {
  return rosterDetailsNeededItems(member).length > 0;
}

/** What the row says it needs, in one short phrase: "Needs gender, current class". Empty when nothing is missing. */
export function rosterDetailsSummary(items: readonly string[]): string {
  return items.length === 0 ? "" : `Needs ${items.map((item) => item.toLowerCase()).join(", ")}`;
}

export type RosterColumnId = "name" | "age" | "birthDate" | "type" | "class" | "details" | "gender" | "screening" | "actions";

/**
 * The columns a viewer's table has, in order. Name, Age, Type, Current class and Details lead; Gender joins
 * with "More columns"; the birth date appears only after its separate authorized reveal; screening only where
 * the role gets it today; the actions column only where the row has something to do.
 */
export function rosterColumns(options: { birthDatesShown: boolean; moreColumns: boolean; hasScreening: boolean; hasRowActions: boolean }): RosterColumnId[] {
  return [
    "name",
    "age",
    ...(options.birthDatesShown ? (["birthDate"] as const) : []),
    "type",
    "class",
    "details",
    ...(options.moreColumns ? (["gender"] as const) : []),
    ...(options.hasScreening ? (["screening"] as const) : []),
    ...(options.hasRowActions ? (["actions"] as const) : []),
  ];
}

export type RosterMenuItem = "honors" | "health" | "healthOnFile" | "remove";

export type RosterRowTools = {
  /** The one visible, labelled task: Edit, or Emergency contacts on a read-only next-year row, or none. */
  primary: "edit" | "contacts" | null;
  /** A plain Honors button beside the primary task on a row that cannot be edited, so it never looks like an edit menu. */
  honorsButton: boolean;
  /** The labelled Actions menu's items, in order. Empty means no menu. */
  menu: RosterMenuItem[];
};

/**
 * Which tools a row offers. `readOnly` rows (staff views, a previous year, next year) never get Edit, Remove or Health;
 * a director on next year's roster still edits emergency contacts. Health follows the existing capability flags.
 */
export function rosterRowTools(options: {
  readOnly: boolean;
  canEditContacts: boolean;
  hasHonors: boolean;
  hasHealthLink: boolean;
  hasHealthOnFileNote: boolean;
}): RosterRowTools {
  if (options.readOnly) {
    return { primary: options.canEditContacts ? "contacts" : null, honorsButton: options.hasHonors, menu: [] };
  }
  const menu: RosterMenuItem[] = [];
  if (options.hasHonors) menu.push("honors");
  if (options.hasHealthLink) menu.push("health");
  if (options.hasHealthOnFileNote) menu.push("healthOnFile");
  menu.push("remove");
  return { primary: "edit", honorsButton: false, menu };
}

/** The first-and-last-name keys that more than one person on the list shares. */
export function duplicateRosterNameKeys(members: readonly NamedMember[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const member of members) {
    const key = normalizeRosterSearch(`${member.firstName} ${member.lastName}`);
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return duplicates;
}

/**
 * The name a row's controls are announced with. Two people with the same name get their age (or, with no age,
 * their type) added, so "Edit Sam Rivers, age 12" and "Edit Sam Rivers, age 13" are never the same button.
 */
export function rosterPersonLabel(
  member: NamedMember & { age?: number | null; reportedAge?: number | null; typeLabel: string },
  duplicates: ReadonlySet<string>,
): string {
  const name = `${member.firstName} ${member.lastName}`;
  if (!duplicates.has(normalizeRosterSearch(name))) return name;
  const age = member.age ?? member.reportedAge ?? null;
  return `${name}, ${age !== null ? `age ${age}` : member.typeLabel}`;
}
