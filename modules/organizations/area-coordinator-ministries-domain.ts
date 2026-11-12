import type { Prisma } from "@prisma/client";
import { CLUB_KINDS, type ClubKindValue } from "@/modules/organizations/club-kind";

/**
 * Area Coordinator ministries (#843). Pure helpers: which ministries a coordinator grant names, in a fixed order.
 * A grant without a usable list reads as a Pathfinder coordinator, the state every grant had before ministries existed.
 */
export const DEFAULT_COORDINATOR_MINISTRIES: readonly ClubKindValue[] = ["PATHFINDER"];

/** The kinds in `CLUB_KINDS` order, without repeats and without anything unknown. */
export function normalizeMinistries(values: readonly string[] | null | undefined): ClubKindValue[] {
  const given = new Set(values ?? []);
  return CLUB_KINDS.filter((kind) => given.has(kind));
}

/** A grant's stored list, falling back to Pathfinder when it is empty or missing. */
export function grantMinistries(values: readonly string[] | null | undefined): ClubKindValue[] {
  const kinds = normalizeMinistries(values);
  return kinds.length > 0 ? kinds : [...DEFAULT_COORDINATOR_MINISTRIES];
}

/** An admin's chosen list: only known, distinct kinds, and at least one. Returns null when it is not valid. */
export function parseMinistriesInput(values: unknown): ClubKindValue[] | null {
  if (!Array.isArray(values) || values.length === 0) return null;
  if (values.some((value) => typeof value !== "string" || !(CLUB_KINDS as readonly string[]).includes(value))) return null;
  if (new Set(values).size !== values.length) return null;
  return normalizeMinistries(values as string[]);
}

/** "Pathfinder", "Adventurer" or "Pathfinder and Adventurer". */
export function ministriesLabel(values: readonly string[] | null | undefined): string {
  return grantMinistries(values).map((kind) => (kind === "ADVENTURER" ? "Adventurer" : "Pathfinder")).join(" and ");
}

/** Every ministry: what the staff "act as" viewer and the staff pages that list clubs for coordination see. */
export const ALL_CLUB_KINDS: readonly ClubKindValue[] = CLUB_KINDS;

/** The Prisma filter for "an active club of these ministries": what a coordinator may list, search, export or open. */
export function areaClubWhere(kinds: readonly ClubKindValue[]): Prisma.OrganizationWhereInput {
  return { type: "CLUB", isActive: true, guestEventId: null, clubKind: { in: [...kinds] } };
}

/** Whether a club kind is one of the ministries (a missing kind is not). */
export function ministriesIncludeKind(ministries: readonly string[], kind: string | null | undefined): boolean {
  return typeof kind === "string" && ministries.includes(kind);
}
