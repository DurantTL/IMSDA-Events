import { rosterRowMissingFields } from "@/modules/club-rosters/domain";
import { formatPersonName } from "@/lib/person-name";

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
  const haystack = normalizeRosterSearch(formatPersonName(member));
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
 * with "Show gender"; the birth date appears only after its separate authorized reveal; screening only where
 * the role gets it today; the actions column only where the row has something to do.
 */
export function rosterColumns(options: { birthDatesShown: boolean; showGender: boolean; hasScreening: boolean; hasRowActions: boolean }): RosterColumnId[] {
  return [
    "name",
    "age",
    ...(options.birthDatesShown ? (["birthDate"] as const) : []),
    "type",
    "class",
    "details",
    ...(options.showGender ? (["gender"] as const) : []),
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

/**
 * The name each person's controls are announced with, one per person id. A name nobody else shares is just the name.
 * Two people with one name get the fewest details that tell them apart (age, then current class, role, type), and if
 * every detail is the same, an ordinal ("2 of 3"), so no two buttons on the page ever share an accessible name.
 */
export function rosterPersonLabels<T extends NamedMember & { id: string; age?: number | null; reportedAge?: number | null; role?: string | null }>(
  members: readonly T[],
  describe: { typeLabel: (member: T) => string; classLabel: (member: T) => string | null },
): Map<string, string> {
  const groups = new Map<string, T[]>();
  for (const member of members) {
    const key = normalizeRosterSearch(formatPersonName(member));
    groups.set(key, [...(groups.get(key) ?? []), member]);
  }
  const labels = new Map<string, string>();
  for (const group of groups.values()) {
    const first = group[0]!;
    if (group.length === 1) {
      labels.set(first.id, formatPersonName(first));
      continue;
    }
    const parts = group.map((member) => {
      const age = member.age ?? member.reportedAge ?? null;
      return [age !== null ? `age ${age}` : null, describe.classLabel(member), member.role || null, describe.typeLabel(member)].filter((part): part is string => Boolean(part));
    });
    const longest = Math.max(...parts.map((list) => list.length));
    let chosen = longest;
    for (let size = 1; size <= longest; size += 1) {
      if (new Set(parts.map((list) => list.slice(0, size).join(", "))).size === group.length) {
        chosen = size;
        break;
      }
    }
    const resolved = parts.map((list) => list.slice(0, chosen).join(", "));
    const unique = new Set(resolved).size === group.length;
    group.forEach((member, index) => {
      const detail = resolved[index]!;
      const own = formatPersonName(member);
      labels.set(member.id, unique ? `${own}, ${detail}` : `${own}, ${detail ? `${detail}, ` : ""}${index + 1} of ${group.length}`);
    });
  }
  return labels;
}

/** What a disambiguated label adds to the plain name, as " (age 12)", or nothing for a name nobody shares. */
export function rosterLabelDetail(label: string, member: NamedMember): string {
  const name = formatPersonName(member);
  return label.length > name.length ? ` (${label.slice(name.length + 2)})` : "";
}

/** The population after the compliance filter, then the search and Details needed. The badge counts the former so it matches the rows. */
export function applyRosterFilters<T extends NamedMember & Parameters<typeof rosterRowMissingFields>[0]>(
  population: readonly T[],
  options: { query: string; detailsOnly: boolean; keepForCompliance: ((member: T) => boolean) | null },
): { afterCompliance: T[]; visible: T[]; needDetailsCount: number } {
  const afterCompliance = options.keepForCompliance ? population.filter(options.keepForCompliance) : [...population];
  return {
    afterCompliance,
    needDetailsCount: afterCompliance.filter((member) => rosterDetailsNeeded(member)).length,
    visible: afterCompliance.filter((member) => matchesRosterSearch(member, options.query) && (!options.detailsOnly || rosterDetailsNeeded(member))),
  };
}

/** What "Clear filters" resets: the search, Details needed and the `?compliance=` filter, together. */
export function clearedRosterFilters() {
  return { query: "", detailsOnly: false, complianceFilter: null } as const;
}

/**
 * Whether the roster's Staff and Members sections start closed for a club role (#1305): the director and registrar
 * open the page to work from the filters, so the long lists stay out of the way until asked for. Every other role,
 * and the conference staff view that has no club role, sees them open. A remembered choice always wins over this.
 */
export function rosterSectionsStartClosed(role: string | null | undefined): boolean {
  return role === "DIRECTOR" || role === "REGISTRAR";
}

/** The browser-storage key for one section's remembered open/closed choice, scoped to the club. */
export function rosterSectionStorageKey(organizationId: string, section: "STAFF" | "MEMBERS"): string {
  return `imsda:roster-section:${organizationId}:${section}`;
}

/**
 * Whether one roster section (Staff or Members) is open (#1305). In order: a search or filter that matches people in
 * the section opens it (unless the person closed it since the filters last changed, `filterChoice`); a link to one of its
 * rows opens it; otherwise the choice remembered in this browser; otherwise the role default. `remembered` is undefined
 * when nothing is stored or storage is unavailable.
 */
export function rosterSectionOpen(options: {
  filtersActive: boolean;
  matchCount: number;
  filterChoice?: boolean;
  hashTarget: boolean;
  remembered?: boolean;
  startClosed: boolean;
}): boolean {
  if (options.filtersActive && options.matchCount > 0) return options.filterChoice ?? true;
  if (options.hashTarget) return true;
  return options.remembered ?? !options.startClosed;
}
