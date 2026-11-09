import "server-only";

import { getPrisma } from "@/lib/prisma";
import { clubRosterComplianceStatuses } from "@/modules/background-checks/repository";
import {
  PHOTO_RELEASE_TEMPLATE_KEY,
  ROSTER_EDIT_AUDIT_ACTIONS,
  canSeeRosterHealth,
  isClubRosterEdit,
  lastMeaningfulUpdate,
  rosterHealthCounts,
  rosterHealthFlags,
  sterlingApplies,
  type RosterHealthCounts,
  type RosterHealthFlag,
} from "@/modules/club-features/domain";
import { isClubFeatureEnabled } from "@/modules/club-features/repository";
import { clubRosterAttendeeTypeLabels, clubYearFor } from "@/modules/club-rosters/domain";
import { guardianIsBlank } from "@/modules/club-rosters/guardians-domain";
import { healthRecordFlagsForRoster } from "@/modules/health-records/repository";
import { healthRecordsEnabled } from "@/modules/health-records/flag";
import type { ClubCapabilities } from "@/modules/organizations/director-grants-domain";

/**
 * The roster health list (#1709): who on a club's active roster is missing something or has an old record. Computed on
 * read from data the club already has, never stored, and never carrying what is in a record: a flag says only that
 * something is missing or old. Only an open club access with the director or deputy's capabilities gets a list, and only
 * while the club has the feature switched on; everyone else gets `null`, which a page turns into "not found".
 */

export type RosterHealthRow = {
  id: string;
  firstName: string;
  lastName: string;
  attendeeType: string;
  typeLabel: string;
  /** ISO time of the last meaningful update (see `lastMeaningfulUpdate`), or null when unknown. */
  lastUpdated: string | null;
  flags: RosterHealthFlag[];
};

export type RosterHealthList = {
  clubYear: string;
  counts: RosterHealthCounts;
  /** Flagged people only, in roster order (last name, first name). */
  rows: RosterHealthRow[];
  /** Checks that could not be made, so their absence from the list is not read as "all fine". */
  notChecked: Array<{ flag: RosterHealthFlag; reason: string }>;
};

export const HEALTH_RECORD_NOT_CHECKED = "Health records are not checked because the Health Record feature is turned off.";
export const PHOTO_RELEASE_NOT_CHECKED = "Photo releases are not checked because the Photo and Video Release form is turned off.";

/**
 * Whether this viewer and club may open the roster health list: the one check `loadRosterHealth` and the roster page's link
 * to it share, so the link is shown exactly when the page would open (#1731).
 */
export async function rosterHealthAvailable(
  organizationId: string,
  capabilities: Pick<ClubCapabilities, "editProfile" | "guardians" | "seeBirthDates">,
): Promise<boolean> {
  if (!canSeeRosterHealth(capabilities)) return false;
  return isClubFeatureEnabled(organizationId, "roster-health-flags");
}

/** The list for the club's active roster this club year, or null when this viewer or club may not have one. */
export async function loadRosterHealth(
  organizationId: string,
  capabilities: Pick<ClubCapabilities, "editProfile" | "guardians" | "seeBirthDates">,
  now = new Date(),
): Promise<RosterHealthList | null> {
  if (!(await rosterHealthAvailable(organizationId, capabilities))) return null;
  return computeRosterHealth(organizationId, now);
}

/** Counts only, for the club Home. Same gates as the list. */
export async function loadRosterHealthCounts(
  organizationId: string,
  capabilities: Pick<ClubCapabilities, "editProfile" | "guardians" | "seeBirthDates">,
  now = new Date(),
): Promise<{ counts: RosterHealthCounts; notChecked: RosterHealthList["notChecked"] } | null> {
  const list = await loadRosterHealth(organizationId, capabilities, now);
  return list ? { counts: list.counts, notChecked: list.notChecked } : null;
}

async function computeRosterHealth(organizationId: string, now: Date): Promise<RosterHealthList> {
  const prisma = getPrisma();
  const clubYear = clubYearFor(now);
  const members = await prisma.clubRosterMember.findMany({
    where: { organizationId, clubYear, status: "ACTIVE" },
    select: {
      id: true,
      personId: true,
      createdAt: true,
      attendeeType: true,
      person: { select: { firstName: true, lastName: true } },
      guardians: { select: { name: true, relationship: true, email: true, phone: true } },
    },
  });
  const ids = members.map((member) => member.id);
  const personIds = members.flatMap((member) => (member.personId ? [member.personId] : []));

  const healthOn = healthRecordsEnabled();
  const [history, healthFlags, sterling, template, releases] = await Promise.all([
    // Every year of this club's rows for these people: creation dates for the fallback, and ids to find the club's saves.
    personIds.length > 0
      ? prisma.clubRosterMember.findMany({
        where: { organizationId, personId: { in: personIds }, status: { not: "REMOVED" } },
        select: { id: true, personId: true, createdAt: true },
      })
      : Promise.resolve([]),
    healthOn ? healthRecordFlagsForRoster(organizationId, ids) : Promise.resolve({} as Record<string, boolean>),
    clubRosterComplianceStatuses(organizationId, clubYear, { includeNotes: false }),
    prisma.clubFormTemplate.findUnique({ where: { key: PHOTO_RELEASE_TEMPLATE_KEY }, select: { enabled: true } }),
    prisma.clubFormSubmission.findMany({
      where: { organizationId, status: "SUBMITTED", template: { key: PHOTO_RELEASE_TEMPLATE_KEY }, rosterMemberId: { in: ids } },
      select: { rosterMemberId: true },
    }),
  ]);
  // A row with no person record is dated on its own: its creation and its own audit entries (keyed by the row id).
  const rows = [
    ...history,
    ...members.filter((member) => !member.personId).map((member) => ({ id: member.id, personId: null, createdAt: member.createdAt })),
  ];
  const datingKey = (row: { id: string; personId: string | null }) => row.personId ?? `row:${row.id}`;
  // The club's own saves (added or edited a person), from the roster's audit entries, never from row timestamps.
  const rowIds = rows.map((row) => row.id);
  const audits = rowIds.length > 0
    ? await prisma.auditLog.findMany({
      where: { entityType: "ClubRosterMember", entityId: { in: rowIds }, action: { in: [...ROSTER_EDIT_AUDIT_ACTIONS] } },
      select: { entityId: true, action: true, metadata: true, createdAt: true },
    })
    : [];
  const personByRow = new Map(rows.map((row) => [row.id, datingKey(row)]));
  const editsByPerson = new Map<string, Date[]>();
  for (const entry of audits) {
    const person = entry.entityId ? personByRow.get(entry.entityId) : undefined;
    if (person && isClubRosterEdit(entry)) editsByPerson.set(person, [...(editsByPerson.get(person) ?? []), entry.createdAt]);
  }
  const photoOn = template?.enabled === true;
  const released = new Set(releases.flatMap((row) => (row.rosterMemberId ? [row.rosterMemberId] : [])));
  const createdByPerson = new Map<string, Date[]>();
  for (const row of rows) {
    const key = datingKey(row);
    createdByPerson.set(key, [...(createdByPerson.get(key) ?? []), row.createdAt]);
  }

  const people = members
    .map((member) => {
      const key = datingKey(member);
      const lastUpdated = lastMeaningfulUpdate(createdByPerson.get(key) ?? [], editsByPerson.get(key) ?? []);
      const flags = rosterHealthFlags({
        attendeeType: member.attendeeType,
        lastUpdated,
        hasEmergencyContact: member.guardians.some((guardian) => !guardianIsBlank(guardian)),
        hasHealthRecord: healthOn ? healthFlags[member.id] === true : null,
        hasPhotoRelease: photoOn ? released.has(member.id) : null,
        noSterlingCheck: sterlingApplies(member.attendeeType) ? sterling.statuses[member.id]?.state === "NO_RECORD" : null,
      }, now);
      return {
        id: member.id,
        firstName: member.person?.firstName ?? "",
        lastName: member.person?.lastName ?? "",
        attendeeType: member.attendeeType,
        typeLabel: clubRosterAttendeeTypeLabels[member.attendeeType],
        lastUpdated: lastUpdated?.toISOString() ?? null,
        flags,
      };
    })
    .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName) || a.id.localeCompare(b.id));

  const notChecked: RosterHealthList["notChecked"] = [
    ...(healthOn ? [] : [{ flag: "NO_HEALTH_RECORD" as const, reason: HEALTH_RECORD_NOT_CHECKED }]),
    ...(photoOn ? [] : [{ flag: "NO_PHOTO_RELEASE" as const, reason: PHOTO_RELEASE_NOT_CHECKED }]),
  ];
  return {
    clubYear,
    counts: rosterHealthCounts(people),
    rows: people.filter((person) => person.flags.length > 0),
    notChecked,
  };
}
