/**
 * Club event report filters (#1762): which clubs, which roles and which location a report is narrowed to. Pure, so the
 * builder, both routes and the saved layouts agree on what a filter means. The server applies them to the preview, the
 * print data and the CSV alike; the builder only chooses them.
 *
 * No filter means everything. Role values are the ones the report's Role column shows (`attendeeRoleLabel`). A saved
 * layout keeps roles and club ids only (never a location, which belongs to one event, and never any data).
 */
import { CLUB_ROSTER_ROLES, YOUTH_GUEST_ROLE_LABEL, attendeeRoleLabel, type ClubEventRecord } from "@/modules/reporting/club-event-reports";

/** The role choices, in the order the builder lists them. Each equals what `attendeeRoleLabel` returns for that person. */
export const CLUB_REPORT_ROLE_OPTIONS: readonly string[] = [...CLUB_ROSTER_ROLES, YOUTH_GUEST_ROLE_LABEL];

export function isClubReportRole(value: string): boolean {
  return CLUB_REPORT_ROLE_OPTIONS.includes(value);
}

/** The club and role part of a filter. Empty or absent lists mean no narrowing. */
export type ClubReportPeopleFilters = { roles?: readonly string[]; clubIds?: readonly string[] };

/** Clubs (by organization id, so every team of a club) and roles kept; a club with nobody left drops out of the rows. */
export function applyClubReportFilters(clubs: readonly ClubEventRecord[], filters: ClubReportPeopleFilters): ClubEventRecord[] {
  const clubIds = filters.clubIds?.length ? new Set(filters.clubIds) : null;
  const roles = filters.roles?.length ? new Set(filters.roles) : null;
  return clubs
    .filter((club) => !clubIds || clubIds.has(club.organizationId))
    .map((club) => (roles ? { ...club, attendees: club.attendees.filter((attendee) => roles.has(attendeeRoleLabel(attendee))) } : club))
    .filter((club) => club.attendees.length > 0);
}

/** What a saved layout holds: known roles and club ids only, as plain lists. Anything else is dropped. */
export type SavedClubReportFilters = { roles?: string[]; clubIds?: string[] };

/**
 * A stored `filters` value read back for loading. Unknown roles are dropped; club ids not registered to this event
 * (`registeredClubIds`) are ignored, because a layout may be shared across events made from one template. Returns
 * undefined when nothing is left (including the null of every layout saved before filters existed).
 */
export function readSavedClubReportFilters(stored: unknown, registeredClubIds: ReadonlySet<string>): SavedClubReportFilters | undefined {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return undefined;
  const record = stored as Record<string, unknown>;
  const roles = Array.isArray(record.roles) ? [...new Set(record.roles.filter((role): role is string => typeof role === "string" && isClubReportRole(role)))] : [];
  const clubIds = Array.isArray(record.clubIds) ? [...new Set(record.clubIds.filter((id): id is string => typeof id === "string" && registeredClubIds.has(id)))] : [];
  if (roles.length === 0 && clubIds.length === 0) return undefined;
  return { ...(roles.length ? { roles } : {}), ...(clubIds.length ? { clubIds } : {}) };
}
