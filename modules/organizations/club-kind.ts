/**
 * Club kind wording (#1517). Pure helpers: which kind of club a CLUB organization
 * is, and the member words the portal uses for it. Pathfinder clubs read exactly
 * as they always have.
 */
export const CLUB_KINDS = ["PATHFINDER", "ADVENTURER"] as const;
export type ClubKindValue = (typeof CLUB_KINDS)[number];

export const clubKindLabels: Record<ClubKindValue, string> = {
  PATHFINDER: "Pathfinder club",
  ADVENTURER: "Adventurer club",
};

const memberNouns: Record<ClubKindValue, { singular: string; plural: string }> = {
  PATHFINDER: { singular: "Pathfinder", plural: "Pathfinders" },
  ADVENTURER: { singular: "Adventurer", plural: "Adventurers" },
};

/** Anything that is not a known kind (a missing value from an older record) reads as a Pathfinder club. */
export function normalizeClubKind(value: string | null | undefined): ClubKindValue {
  return value === "ADVENTURER" ? "ADVENTURER" : "PATHFINDER";
}

export function clubKindLabel(kind: string | null | undefined): string {
  return clubKindLabels[normalizeClubKind(kind)];
}

/** "Pathfinder" or "Adventurer". */
export function clubMemberNoun(kind: string | null | undefined): string {
  return memberNouns[normalizeClubKind(kind)].singular;
}

/** "Pathfinders" or "Adventurers". */
export function clubMemberNounPlural(kind: string | null | undefined): string {
  return memberNouns[normalizeClubKind(kind)].plural;
}

/** The staff orders filter's `clubType` search param: a known kind, or null for All (missing, repeated or invalid). */
export function parseClubKindFilter(value: string | string[] | null | undefined): ClubKindValue | null {
  if (typeof value !== "string") return null;
  const upper = value.trim().toUpperCase();
  return (CLUB_KINDS as readonly string[]).includes(upper) ? (upper as ClubKindValue) : null;
}
