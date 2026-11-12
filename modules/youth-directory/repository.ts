import "server-only";

import { getPrisma } from "@/lib/prisma";
import { openBirthDate } from "@/modules/club-rosters/birth-dates";
import { ageOn, calendarDateOf, clubYearFor, effectiveClassLevel } from "@/modules/club-rosters/domain";
import { formatPersonName } from "@/lib/person-name";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { hasYouthFilters, type YouthDirectoryRow, type YouthQuery } from "@/modules/youth-directory/domain";

/**
 * Every active youth on an active club's roster for the current club year (#1685), with only the columns the directory
 * shows. The birth date is opened here, once, to compute an age, and is never put on a row. Adventurer clubs are not
 * in this system yet, so every active CLUB organization is a Pathfinder club.
 */
export async function listYouthDirectoryRows(now = new Date()): Promise<{ clubYear: string; rows: YouthDirectoryRow[] }> {
  const clubYear = clubYearFor(now);
  const today = calendarDateOf(now);
  const members = await getPrisma().clubRosterMember.findMany({
    where: { clubYear, status: "ACTIVE", attendeeType: "YOUTH", organization: { type: "CLUB", isActive: true } },
    select: {
      id: true,
      attendeeType: true,
      classLevel: true,
      isTlt: true,
      schoolGrade: true,
      schoolType: true,
      churchMember: true,
      reportedAge: true,
      sealedBirthDate: true,
      organization: { select: { id: true, name: true } },
      person: { select: { firstName: true, lastName: true } },
    },
  });
  const rows = members.map((member): YouthDirectoryRow => {
    const birthAge = member.sealedBirthDate ? ageOn(openBirthDate(member.sealedBirthDate), today) : null;
    return {
      id: member.id,
      name: formatPersonName({ firstName: member.person?.firstName, lastName: member.person?.lastName }, "sorted"),
      clubId: member.organization.id,
      club: member.organization.name,
      age: birthAge !== null ? { years: birthAge, reported: false } : member.reportedAge !== null ? { years: member.reportedAge, reported: true } : null,
      grade: member.schoolGrade,
      schoolType: member.schoolType,
      churchMember: member.churchMember,
      classLevel: effectiveClassLevel(member),
    };
  });
  return { clubYear, rows };
}

/**
 * Records one CSV export (#1685): who, which filters, how many rows. Never a row's contents. The filter values are the
 * fixed choices the directory offers (or a club id), so nothing a person typed reaches the entry.
 */
export async function auditYouthDirectoryExport(input: { actorUserId: string; actorRole: "SYSTEM_ADMIN" | "YOUTH_ADMINISTRATOR"; query: YouthQuery; rowCount: number; clubYear: string }) {
  const filters = Object.fromEntries(Object.entries(input.query.filters).filter(([, value]) => Boolean(value)));
  await writeAuditLog({
    actorUserId: input.actorUserId,
    action: "YOUTH_DIRECTORY_EXPORTED",
    entityType: "YouthDirectory",
    summary: "Exported the Youth directory as a CSV file.",
    metadata: {
      actorRole: input.actorRole,
      clubYear: input.clubYear,
      rowCount: input.rowCount,
      filtered: hasYouthFilters(input.query.filters),
      filters,
      sort: input.query.sort.key ?? "name",
      direction: input.query.sort.dir,
    },
  });
}
