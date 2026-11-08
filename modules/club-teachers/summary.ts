import "server-only";

import { getPrisma } from "@/lib/prisma";
import { formatPersonName } from "@/lib/person-name";
import { getTeacherRule, rosterAgeOn } from "@/modules/club-teachers/repository";
import { calendarDateInEventTimeZone } from "@/modules/events/lifecycle";
import { teacherEligibility, teacherEligibilityLabel, teacherStatus, type TeacherRule, type TeacherStatus } from "@/modules/club-teachers/domain";

/**
 * The staff and Area Coordinator view of Club teachers (#1681): teachers per weekend or site and per club. Adult names
 * and the optional honor and site only. It reads whatever clubs entered, even while the tool is switched off.
 */

export type TeacherSiteRow = { locationId: string | null; name: string; teachers: number; clubs: number };

export type TeacherClubRow = {
  organizationId: string;
  name: string;
  registered: boolean;
  headcount: number;
  status: TeacherStatus;
  teachers: Array<{ name: string; honorName: string; siteId: string | null; siteName: string; flag: string | null }>;
};

export type TeacherSummary = {
  rule: TeacherRule | null;
  sites: TeacherSiteRow[];
  clubs: TeacherClubRow[];
  totalTeachers: number;
  clubsBelow: number;
};

const noSite = "No site chosen";

export async function loadTeacherSummary(eventId: string): Promise<TeacherSummary> {
  const prisma = getPrisma();
  const [event, rule, locations, teachers, registrations] = await Promise.all([
    prisma.event.findUnique({ where: { id: eventId }, select: { startsAt: true, timezone: true } }),
    getTeacherRule(eventId),
    prisma.eventLocation.findMany({ where: { eventId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    prisma.clubEventTeacher.findMany({
      where: { eventId },
      select: { organizationId: true, honorName: true, locationId: true, organization: { select: { name: true } }, rosterMember: { select: { sealedBirthDate: true, reportedAge: true, person: { select: { firstName: true, lastName: true } } } } },
    }),
    prisma.clubEventRegistration.findMany({
      where: { eventId, registration: { status: { in: ["SUBMITTED", "CONFIRMED"] } } },
      select: { organizationId: true, organization: { select: { name: true } }, registration: { select: { locationId: true, _count: { select: { attendees: true } } } } },
    }),
  ]);
  const siteName = new Map(locations.map((location) => [location.id, location.name]));
  const clubs = new Map<string, { name: string; registered: boolean; headcount: number; locationId: string | null }>();
  for (const row of registrations) {
    const existing = clubs.get(row.organizationId);
    clubs.set(row.organizationId, {
      name: row.organization.name,
      registered: true,
      headcount: (existing?.headcount ?? 0) + row.registration._count.attendees,
      locationId: existing?.locationId ?? row.registration.locationId,
    });
  }
  for (const row of teachers) {
    if (!clubs.has(row.organizationId)) clubs.set(row.organizationId, { name: row.organization.name, registered: false, headcount: 0, locationId: null });
  }
  // Ages are worked out on the event's first day; someone who cannot teach is listed with a flag and not counted.
  const ageDate = event ? calendarDateInEventTimeZone(event.startsAt, event.timezone) : null;
  const eligibilityOf = (teacher: (typeof teachers)[number]) => (ageDate ? teacherEligibility(rosterAgeOn(teacher.rosterMember, ageDate)) : "age-unknown" as const);
  const byClub = Map.groupBy(teachers, (teacher) => teacher.organizationId);
  const clubRows: TeacherClubRow[] = [...clubs].map(([organizationId, club]) => {
    const named = byClub.get(organizationId) ?? [];
    return {
      organizationId,
      name: club.name,
      registered: club.registered,
      headcount: club.headcount,
      // With no rule saved there is nothing to be short of.
      status: teacherStatus(rule ?? { baseTeachers: 0, largerClubOver: null, largerClubTeachers: 0, requireTeachers: false }, club.headcount, named.filter((teacher) => eligibilityOf(teacher) === "ok").length),
      teachers: named
        .map((teacher) => ({
          name: formatPersonName(teacher.rosterMember.person ?? {}, "sorted") || "Unnamed person",
          honorName: teacher.honorName ?? "",
          // A teacher's own preference wins; otherwise the weekend the club registered for.
          siteId: siteName.has(teacher.locationId ?? "") ? teacher.locationId : siteName.has(club.locationId ?? "") ? club.locationId : null,
          siteName: siteName.get(teacher.locationId ?? "") ?? siteName.get(club.locationId ?? "") ?? noSite,
          flag: teacherEligibilityLabel(eligibilityOf(teacher)),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const perSite = new Map<string | null, { name: string; teachers: number; clubs: Set<string> }>(
    locations.map((location) => [location.id, { name: location.name, teachers: 0, clubs: new Set<string>() }]),
  );
  for (const club of clubRows) {
    for (const teacher of club.teachers) {
      if (teacher.flag) continue;
      const site = perSite.get(teacher.siteId) ?? perSite.set(teacher.siteId, { name: noSite, teachers: 0, clubs: new Set<string>() }).get(teacher.siteId)!;
      site.teachers += 1;
      site.clubs.add(club.organizationId);
    }
  }
  const sites: TeacherSiteRow[] = [...perSite].map(([locationId, site]) => ({ locationId, name: site.name, teachers: site.teachers, clubs: site.clubs.size }));
  return {
    rule,
    sites,
    clubs: clubRows,
    totalTeachers: teachers.filter((teacher) => eligibilityOf(teacher) === "ok").length,
    clubsBelow: rule ? clubRows.filter((club) => club.registered && !club.status.met).length : 0,
  };
}
