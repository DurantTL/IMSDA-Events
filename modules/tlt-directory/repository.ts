import "server-only";

import { Prisma } from "@prisma/client";
import { formatPersonName } from "@/lib/person-name";
import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { calendarDateOf, clubSchoolGradeLabels, clubYearFor } from "@/modules/club-rosters/domain";
import { ageFrom } from "@/modules/club-rosters/repository";
import {
  TltDirectoryError,
  activeFilterKeys,
  filterTltRows,
  sameListName,
  sortTltRows,
  tltExportTable,
  type TltDirectoryRow,
  type TltFilters,
  type TltListAction,
  type TltProfileUpdate,
} from "@/modules/tlt-directory/domain";
import type { TltDirectorActor } from "@/modules/tlt-directory/access";
import { toCsv } from "@/modules/reporting/csv";

/**
 * The TLT directory's data (#1686). A TLT is a youth roster member flagged `isTlt`, ACTIVE, on an active club's roster
 * for the current club year. The saved record (`TltProfile`) hangs off the `Person`, not the roster row: carrying a
 * roster forward keeps the same Person, so year, position, status and tags follow the teen into the next club year.
 * Nothing here reads form answers, contact details, school type, church membership or a birth date (the sealed date is
 * opened only to compute an age and is never returned).
 */

type Db = Prisma.TransactionClient;

export async function listTltDirectoryRows(now = new Date()): Promise<TltDirectoryRow[]> {
  const prisma = getPrisma();
  const members = await prisma.clubRosterMember.findMany({
    where: {
      clubYear: clubYearFor(now),
      attendeeType: "YOUTH",
      isTlt: true,
      status: "ACTIVE",
      personId: { not: null },
      organization: { type: "CLUB", isActive: true, guestEventId: null },
    },
    select: {
      id: true,
      personId: true,
      schoolGrade: true,
      reportedAge: true,
      sealedBirthDate: true,
      updatedAt: true,
      person: { select: { firstName: true, lastName: true } },
      organization: { select: { id: true, name: true, parentOrganization: { select: { name: true } } } },
    },
  });
  const personIds = [...new Set(members.flatMap((member) => (member.personId ? [member.personId] : [])))];
  const profiles = personIds.length === 0 ? [] : await prisma.tltProfile.findMany({
    where: { personId: { in: personIds } },
    select: {
      personId: true,
      tltYear: true,
      positionTypeId: true,
      status: true,
      positionType: { select: { name: true } },
      tags: { select: { tag: { select: { id: true, name: true, sortOrder: true } } } },
    },
  });
  const profileByPerson = new Map(profiles.map((profile) => [profile.personId, profile]));
  const today = calendarDateOf(now);
  // One row per person even if two clubs briefly both list them: the most recently updated roster row wins.
  const latest = new Map<string, (typeof members)[number]>();
  for (const member of members) {
    if (!member.personId) continue;
    const seen = latest.get(member.personId);
    if (!seen || member.updatedAt > seen.updatedAt) latest.set(member.personId, member);
  }
  const rows: TltDirectoryRow[] = [];
  for (const member of latest.values()) {
    const profile = profileByPerson.get(member.personId!);
    const name = formatPersonName({ firstName: member.person?.firstName ?? "", lastName: member.person?.lastName ?? "" });
    rows.push({
      personId: member.personId!,
      rosterMemberId: member.id,
      name: name || "Unnamed person",
      clubId: member.organization.id,
      clubName: member.organization.name,
      church: member.organization.parentOrganization?.name ?? "",
      age: ageFrom(member, today),
      reportedAge: member.sealedBirthDate ? null : member.reportedAge,
      grade: member.schoolGrade ? clubSchoolGradeLabels[member.schoolGrade] : null,
      tltYear: profile?.tltYear ?? null,
      positionTypeId: profile?.positionTypeId ?? null,
      positionName: profile?.positionType?.name ?? null,
      status: profile?.status ?? null,
      tags: (profile?.tags ?? [])
        .map((link) => link.tag)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "en-US"))
        .map((tag) => ({ id: tag.id, name: tag.name })),
    });
  }
  return rows;
}

export type TltListEntry = { id: string; name: string; retired: boolean; inUse: number; seeded: boolean };

export async function listTltLists(): Promise<{ positions: TltListEntry[]; tags: TltListEntry[] }> {
  const prisma = getPrisma();
  const [positions, tags] = await Promise.all([
    prisma.tltPositionType.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, retiredAt: true, seedKey: true, _count: { select: { profiles: true } } } }),
    prisma.tltHelpTag.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, retiredAt: true, seedKey: true, _count: { select: { profileLinks: true } } } }),
  ]);
  return {
    positions: positions.map((row) => ({ id: row.id, name: row.name, retired: row.retiredAt !== null, inUse: row._count.profiles, seeded: row.seedKey !== null })),
    tags: tags.map((row) => ({ id: row.id, name: row.name, retired: row.retiredAt !== null, inUse: row._count.profileLinks, seeded: row.seedKey !== null })),
  };
}

/** The filtered, sorted directory for the page, with every club that has a TLT for the club filter. */
export async function readTltDirectory(filters: TltFilters, now = new Date()) {
  const all = await listTltDirectoryRows(now);
  const clubs = [...new Map(all.map((row) => [row.clubId, row.clubName])).entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "en-US"));
  return { total: all.length, clubs, rows: sortTltRows(filterTltRows(all, filters), filters.sort) };
}

/**
 * Saves the four fields for one TLT, who must be a current TLT. A retired position type or tag can stay where it already
 * is but cannot be newly chosen. Audit: ids and values from fixed lists only, never a name.
 */
export async function updateTltProfile(input: TltProfileUpdate, actor: TltDirectorActor, now = new Date()) {
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    const isTlt = await tx.clubRosterMember.findFirst({
      where: {
        personId: input.personId,
        clubYear: clubYearFor(now),
        attendeeType: "YOUTH",
        isTlt: true,
        status: "ACTIVE",
        organization: { type: "CLUB", isActive: true, guestEventId: null },
      },
      select: { id: true },
    });
    if (!isTlt) throw new TltDirectoryError("NOT_A_TLT", "That person isn't a TLT on a current club roster.");

    const existing = await tx.tltProfile.findUnique({
      where: { personId: input.personId },
      select: { id: true, tltYear: true, positionTypeId: true, status: true, tags: { select: { tagId: true } } },
    });
    const currentTagIds = new Set(existing?.tags.map((link) => link.tagId) ?? []);

    if (input.positionTypeId && input.positionTypeId !== existing?.positionTypeId) {
      const position = await tx.tltPositionType.findUnique({ where: { id: input.positionTypeId }, select: { retiredAt: true } });
      if (!position || position.retiredAt) throw new TltDirectoryError("POSITION_NOT_AVAILABLE", "Choose a position type from the current list.");
    }
    const newTagIds = input.tagIds.filter((id) => !currentTagIds.has(id));
    if (newTagIds.length > 0) {
      const found = await tx.tltHelpTag.findMany({ where: { id: { in: newTagIds }, retiredAt: null }, select: { id: true } });
      if (found.length !== newTagIds.length) throw new TltDirectoryError("TAG_NOT_AVAILABLE", "Choose tags from the current list.");
    }

    const profile = await tx.tltProfile.upsert({
      where: { personId: input.personId },
      create: {
        personId: input.personId,
        tltYear: input.tltYear,
        positionTypeId: input.positionTypeId,
        status: input.status,
        updatedByAccountId: actor.accountId,
      },
      update: { tltYear: input.tltYear, positionTypeId: input.positionTypeId, status: input.status, updatedByAccountId: actor.accountId },
      select: { id: true },
    });
    await tx.tltProfileTag.deleteMany({ where: { profileId: profile.id, tagId: { notIn: input.tagIds } } });
    if (newTagIds.length > 0) {
      await tx.tltProfileTag.createMany({ data: newTagIds.map((tagId) => ({ profileId: profile.id, tagId })), skipDuplicates: true });
    }

    const changed: string[] = [];
    if ((existing?.tltYear ?? null) !== input.tltYear) changed.push("tltYear");
    if ((existing?.positionTypeId ?? null) !== input.positionTypeId) changed.push("positionType");
    if ((existing?.status ?? null) !== input.status) changed.push("status");
    const sameTags = currentTagIds.size === input.tagIds.length && input.tagIds.every((id) => currentTagIds.has(id));
    if (!sameTags) changed.push("tags");
    await writeAuditLog({
      action: "TLT_DIRECTORY_PROFILE_UPDATED",
      entityType: "TltProfile",
      entityId: profile.id,
      summary: "Updated a TLT's year, position, status or tags.",
      metadata: {
        actorAttendeeAccountId: actor.accountId,
        personId: input.personId,
        changed,
        tltYear: input.tltYear,
        positionTypeId: input.positionTypeId,
        status: input.status,
        tagIds: input.tagIds,
      },
    }, tx);
  });
}

async function nameTaken(tx: Db, list: "position" | "tag", name: string, exceptId?: string) {
  const rows = list === "position"
    ? await tx.tltPositionType.findMany({ select: { id: true, name: true } })
    : await tx.tltHelpTag.findMany({ select: { id: true, name: true } });
  return rows.some((row) => row.id !== exceptId && sameListName(row.name, name));
}

/** Add, rename, retire or restore a position type or tag. Nothing is ever deleted, so an entry in use is kept. */
export async function changeTltList(input: TltListAction, actor: TltDirectorActor) {
  const prisma = getPrisma();
  try {
    return await prisma.$transaction(async (tx) => {
      let entryId: string;
      if (input.action === "add") {
        if (await nameTaken(tx, input.list, input.name)) throw new TltDirectoryError("NAME_TAKEN", "That name is already on the list (retired names count).");
        const last = input.list === "position"
          ? await tx.tltPositionType.aggregate({ _max: { sortOrder: true } })
          : await tx.tltHelpTag.aggregate({ _max: { sortOrder: true } });
        const sortOrder = (last._max.sortOrder ?? -1) + 1;
        const created = input.list === "position"
          ? await tx.tltPositionType.create({ data: { name: input.name, sortOrder }, select: { id: true } })
          : await tx.tltHelpTag.create({ data: { name: input.name, sortOrder }, select: { id: true } });
        entryId = created.id;
      } else {
        const found = input.list === "position"
          ? await tx.tltPositionType.findUnique({ where: { id: input.id }, select: { id: true } })
          : await tx.tltHelpTag.findUnique({ where: { id: input.id }, select: { id: true } });
        if (!found) throw new TltDirectoryError("ENTRY_NOT_FOUND", "That entry isn't on the list.");
        entryId = found.id;
        if (input.action === "rename") {
          if (await nameTaken(tx, input.list, input.name, entryId)) throw new TltDirectoryError("NAME_TAKEN", "That name is already on the list (retired names count).");
          if (input.list === "position") await tx.tltPositionType.update({ where: { id: entryId }, data: { name: input.name } });
          else await tx.tltHelpTag.update({ where: { id: entryId }, data: { name: input.name } });
        } else {
          const retiredAt = input.action === "retire" ? new Date() : null;
          if (input.list === "position") await tx.tltPositionType.update({ where: { id: entryId }, data: { retiredAt } });
          else await tx.tltHelpTag.update({ where: { id: entryId }, data: { retiredAt } });
        }
      }
      await writeAuditLog({
        action: "TLT_DIRECTORY_LIST_CHANGED",
        entityType: input.list === "position" ? "TltPositionType" : "TltHelpTag",
        entityId: entryId,
        summary: `${input.action === "add" ? "Added" : input.action === "rename" ? "Renamed" : input.action === "retire" ? "Retired" : "Restored"} a TLT ${input.list === "position" ? "position type" : "help-area tag"}.`,
        metadata: { actorAttendeeAccountId: actor.accountId, list: input.list, listAction: input.action, entryId },
      }, tx);
      return { id: entryId };
    });
  } catch (error) {
    // Two adds of the same name at once: the unique name index answers the second.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new TltDirectoryError("NAME_TAKEN", "That name is already on the list (retired names count).");
    }
    throw error;
  }
}

/** The CSV for the current filters, audited with counts and filter keys only (never a name or search text). */
export async function runTltExport(filters: TltFilters, actor: TltDirectorActor, now = new Date()) {
  const { rows } = await readTltDirectory(filters, now);
  const table = tltExportTable(rows);
  await writeAuditLog({
    action: "TLT_DIRECTORY_EXPORTED",
    entityType: "TltProfile",
    summary: "Exported the TLT directory to CSV.",
    metadata: {
      actorAttendeeAccountId: actor.accountId,
      clubYear: clubYearFor(now),
      rowCount: rows.length,
      filters: activeFilterKeys(filters),
      sort: filters.sort,
      columns: table.headers,
    },
  });
  return { ...table, rowCount: rows.length, csv: toCsv([table.headers, ...table.rows]) };
}

/**
 * One audit row for a page view by the TLT director: counts and filter keys only, never the search text or a name.
 * A single insert, with the counts the page already has.
 */
export async function recordTltDirectoryView(
  view: { filters: TltFilters; shown: number; matching: number; total: number; page: number },
  actor: TltDirectorActor,
  now = new Date(),
) {
  await writeAuditLog({
    action: "TLT_DIRECTORY_VIEWED",
    entityType: "TltProfile",
    summary: "Opened the TLT directory.",
    metadata: {
      actorAttendeeAccountId: actor.accountId,
      clubYear: clubYearFor(now),
      rowsShown: view.shown,
      rowsMatching: view.matching,
      totalTlts: view.total,
      page: view.page,
      filters: activeFilterKeys(view.filters),
      sort: view.filters.sort,
    },
  });
}
