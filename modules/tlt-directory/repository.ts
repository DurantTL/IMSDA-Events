import "server-only";

import { conferenceClubWhere } from "@/modules/organizations/area-coordinator-ministries-domain";
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
  summarizeOpportunityAnswers,
  tltExportTable,
  type TltDirectoryRow,
  type TltFilters,
  type TltListAction,
  type OpportunityAnswerRow,
  type TltAnswerSummary,
  type TltMoveUpPlan,
  type TltMoveUpRequest,
  type TltProfileUpdate,
  type TltSuggestionAccept,
  planTltMoveUp,
} from "@/modules/tlt-directory/domain";
import type { TltDirectorActor } from "@/modules/tlt-directory/access";
import { personIsCurrentTlt } from "@/modules/tlt-directory/current-tlt";
import { toCsv } from "@/modules/reporting/csv";

/**
 * The TLT directory's data (#1686). A TLT is a youth roster member flagged `isTlt`, ACTIVE, on an active club's roster
 * for the current club year. The saved record (`TltProfile`) hangs off the `Person`, not the roster row: carrying a
 * roster forward keeps the same Person, so year, position, status and tags follow the teen into the next club year.
 * The only form answers read are the four TLT Opportunities answers `readOpportunityAnswers` pulls out (suggested tags,
 * shirt). Nothing here reads contact details, school type, church membership or a birth date (the sealed date is
 * opened only to compute an age and is never returned).
 */

type Db = Prisma.TransactionClient;

/** The registration forms made from the TLT Opportunities template (`tlt_opportunities`). */
const TLT_OPPORTUNITIES_TEMPLATE_KEY = "tlt_opportunities";

/**
 * One batched read of the TLT Opportunities answers for a set of people, newest first. A raw query on purpose: it pulls
 * out only the four answers the directory uses (`leadership_opportunities`, `need_tlt_shirt`, `shirt_type`,
 * `shirt_size`), so no other answer on those registrations (health, contact, anything) is ever loaded. Only
 * registrations of a form made from the TLT Opportunities template count, and not drafts or cancelled ones.
 */
async function readOpportunityAnswers(db: Pick<Db, "$queryRaw">, personIds: string[]): Promise<Map<string, TltAnswerSummary>> {
  if (personIds.length === 0) return new Map();
  const rows = await db.$queryRaw<Array<{ personId: string; opportunities: unknown; attendeeCount: number | bigint; needShirt: string | null; shirtType: string | null; shirtSize: string | null }>>(Prisma.sql`
    SELECT a."personId" AS "personId",
           s."responses" -> 'leadership_opportunities' AS "opportunities",
           (SELECT COUNT(*) FROM "RegistrationAttendee" x WHERE x."registrationId" = r."id") AS "attendeeCount",
           a."formResponses" ->> 'need_tlt_shirt' AS "needShirt",
           a."formResponses" ->> 'shirt_type' AS "shirtType",
           a."formResponses" ->> 'shirt_size' AS "shirtSize"
    FROM "RegistrationAttendee" a
    JOIN "Registration" r ON r."id" = a."registrationId"
    JOIN "PublicRegistrationSubmission" s ON s."registrationId" = r."id"
    JOIN "RegistrationFormVersion" v ON v."id" = s."formVersionId"
    JOIN "RegistrationForm" f ON f."id" = v."formId"
    JOIN "SeededFormTemplateVersion" tv ON tv."id" = f."sourceTemplateVersionId"
    JOIN "SeededFormTemplate" t ON t."id" = tv."templateId"
    WHERE t."key" = ${TLT_OPPORTUNITIES_TEMPLATE_KEY}
      AND r."status" IN ('SUBMITTED', 'CONFIRMED', 'WAITLISTED')
      AND a."personId" = ANY(${personIds}::text[])
    ORDER BY r."createdAt" DESC, a."createdAt" DESC
  `);
  const answers: OpportunityAnswerRow[] = rows.map((row) => ({ ...row, attendeeCount: Number(row.attendeeCount) }));
  return summarizeOpportunityAnswers(answers);
}

export async function listTltDirectoryRows(now = new Date()): Promise<TltDirectoryRow[]> {
  const prisma = getPrisma();
  const members = await prisma.clubRosterMember.findMany({
    where: {
      clubYear: clubYearFor(now),
      attendeeType: "YOUTH",
      isTlt: true,
      status: "ACTIVE",
      personId: { not: null },
      organization: conferenceClubWhere(),
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
      tltYearClubYear: true,
      positionTypeId: true,
      status: true,
      positionType: { select: { name: true } },
      tags: { select: { tag: { select: { id: true, name: true, sortOrder: true } } } },
    },
  });
  const profileByPerson = new Map(profiles.map((profile) => [profile.personId, profile]));
  // Two more reads for the whole list, never one per row: the TLT Opportunities answers, then the seeded tags they map to.
  const answers = await readOpportunityAnswers(prisma, personIds);
  const wantedSeedKeys = [...new Set([...answers.values()].flatMap((answer) => answer.seedKeys))];
  const seededTags = wantedSeedKeys.length === 0 ? [] : await prisma.tltHelpTag.findMany({
    where: { seedKey: { in: wantedSeedKeys }, retiredAt: null },
    select: { id: true, name: true, seedKey: true },
  });
  const tagBySeedKey = new Map(seededTags.flatMap((tag) => (tag.seedKey ? [[tag.seedKey, { id: tag.id, name: tag.name }] as const] : [])));
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
    const answer = answers.get(member.personId!);
    const haveTagIds = new Set((profile?.tags ?? []).map((link) => link.tag.id));
    const suggestedTags = (answer?.seedKeys ?? []).flatMap((key) => {
      const tag = tagBySeedKey.get(key);
      return tag && !haveTagIds.has(tag.id) ? [tag] : [];
    });
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
      tltYearClubYear: profile?.tltYearClubYear ?? null,
      positionTypeId: profile?.positionTypeId ?? null,
      positionName: profile?.positionType?.name ?? null,
      status: profile?.status ?? null,
      tags: (profile?.tags ?? [])
        .map((link) => link.tag)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "en-US"))
        .map((tag) => ({ id: tag.id, name: tag.name })),
      suggestedTags,
      shirt: answer?.shirt ?? null,
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
    const isTlt = await personIsCurrentTlt(tx, input.personId, now);
    if (!isTlt) throw new TltDirectoryError("NOT_A_TLT", "That person isn't a TLT on a current club roster.");

    // Lock this TLT's record before comparing the year, so a move-up that commits first is seen (and refused here) and
    // one that starts after waits for this save: neither can be overwritten by the other.
    await tx.$queryRaw(Prisma.sql`SELECT 1 FROM "TltProfile" WHERE "personId" = ${input.personId} FOR UPDATE`);
    const existing = await tx.tltProfile.findUnique({
      where: { personId: input.personId },
      select: { id: true, tltYear: true, positionTypeId: true, status: true, tags: { select: { tagId: true } } },
    });
    if ((existing?.tltYear ?? null) !== input.expectedTltYear) {
      throw new TltDirectoryError("YEAR_CHANGED", "This TLT's year changed since you opened the page. Reload and try again.");
    }
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

    // The year applies to this club year whenever it is set or changed; clearing it clears the club year too.
    const yearChanged = (existing?.tltYear ?? null) !== input.tltYear;
    const clubYearNow = clubYearFor(now);
    const profile = await tx.tltProfile.upsert({
      where: { personId: input.personId },
      create: {
        personId: input.personId,
        tltYear: input.tltYear,
        tltYearClubYear: input.tltYear === null ? null : clubYearNow,
        positionTypeId: input.positionTypeId,
        status: input.status,
        updatedByAccountId: actor.accountId,
      },
      update: {
        tltYear: input.tltYear,
        ...(yearChanged ? { tltYearClubYear: input.tltYear === null ? null : clubYearNow } : {}),
        positionTypeId: input.positionTypeId,
        status: input.status,
        updatedByAccountId: actor.accountId,
      },
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

/**
 * One click on a suggested tag (#1686). The server works out again which tags this person's answers suggest and refuses
 * anything else, so the request can't add an arbitrary tag under the "suggestion" name. A retired tag is never
 * suggested. Creates the TLT's record if there isn't one (year, position and status stay "Not set"). Audit: ids only.
 */
export async function acceptTltTagSuggestion(input: TltSuggestionAccept, actor: TltDirectorActor, now = new Date()) {
  try {
    await acceptSuggestionOnce(input, actor, now);
  } catch (error) {
    // Two accepts at once for a TLT with no record: both try to create it and the second hits the unique person index.
    // That transaction is void, so run it again once: the record now exists and the tag is added (or already there).
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") await acceptSuggestionOnce(input, actor, now);
    else throw error;
  }
}

async function acceptSuggestionOnce(input: TltSuggestionAccept, actor: TltDirectorActor, now: Date) {
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    const isTlt = await personIsCurrentTlt(tx, input.personId, now);
    if (!isTlt) throw new TltDirectoryError("NOT_A_TLT", "That person isn't a TLT on a current club roster.");
    const tag = await tx.tltHelpTag.findUnique({ where: { id: input.tagId }, select: { id: true, seedKey: true, retiredAt: true } });
    const answers = await readOpportunityAnswers(tx, [input.personId]);
    if (!tag || tag.retiredAt || !tag.seedKey || !answers.get(input.personId)?.seedKeys.includes(tag.seedKey)) {
      throw new TltDirectoryError("NOT_SUGGESTED", "That tag isn't suggested for this TLT.");
    }
    const profile = await tx.tltProfile.upsert({
      where: { personId: input.personId },
      create: { personId: input.personId, tltYear: null, positionTypeId: null, status: null, updatedByAccountId: actor.accountId },
      update: { updatedByAccountId: actor.accountId },
      select: { id: true },
    });
    await tx.tltProfileTag.createMany({ data: [{ profileId: profile.id, tagId: tag.id }], skipDuplicates: true });
    await writeAuditLog({
      action: "TLT_DIRECTORY_TAG_SUGGESTION_ACCEPTED",
      entityType: "TltProfile",
      entityId: profile.id,
      summary: "Accepted a suggested help-area tag for a TLT.",
      metadata: { actorAttendeeAccountId: actor.accountId, personId: input.personId, tagId: tag.id },
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

/** The move-up review for this club year: the directory's TLTs, grouped (see `planTltMoveUp`). */
export async function readTltMoveUp(now = new Date()) {
  const rows = await listTltDirectoryRows(now);
  return planTltMoveUp(rows, clubYearFor(now));
}

/** The people the conditional update below may touch: still Year 1 to 3, not finished or left, not already set for this club year. */
function moveUpUpdate(kind: "move" | "keep", personIds: string[], clubYear: string, accountId: string) {
  const year = kind === "move" ? Prisma.sql`"tltYear" = "tltYear" + 1,` : Prisma.empty;
  return Prisma.sql`
    UPDATE "TltProfile"
    SET ${year} "tltYearClubYear" = ${clubYear}, "updatedByAccountId" = ${accountId}, "updatedAt" = now()
    WHERE "personId" = ANY(${personIds}::text[])
      AND "tltYear" BETWEEN 1 AND 3
      AND ("status" IS NULL OR "status"::text NOT IN ('FINISHED', 'LEFT'))
      AND ("tltYearClubYear" IS NULL OR "tltYearClubYear" < ${clubYear} COLLATE "C")
    RETURNING "personId"`;
}

/**
 * The confirmed move-up (#1686). The club year must be the current one (else STALE_CLUB_YEAR). In one transaction, for
 * the people who are still current TLTs: the ticked ones are moved up one year and the unticked ones are held at their
 * current year for this club year (so they are not offered again). Each is one set-based conditional UPDATE: the year
 * must still be 1 to 3, the status not finished or left, and the year not already set for this club year, so a double
 * submit or a concurrent edit changes nobody twice. Everyone else counts as skipped. One audit row: ids and counts,
 * never a name.
 */
export async function confirmTltMoveUp(input: TltMoveUpRequest, actor: TltDirectorActor, now = new Date()) {
  const clubYear = clubYearFor(now);
  if (input.clubYear !== clubYear) {
    throw new TltDirectoryError("STALE_CLUB_YEAR", "The club year has changed since this page was opened. Reload the page and check the list again.");
  }
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const requested = [...input.moveIds, ...input.keepIds];
    const roster = await tx.clubRosterMember.findMany({
      where: {
        personId: { in: requested },
        clubYear,
        attendeeType: "YOUTH",
        isTlt: true,
        status: "ACTIVE",
        organization: conferenceClubWhere(),
      },
      select: { personId: true },
    });
    const current = new Set(roster.flatMap((member) => (member.personId ? [member.personId] : [])));
    const run = async (kind: "move" | "keep", ids: string[]) => {
      const wanted = ids.filter((id) => current.has(id));
      if (wanted.length === 0) return [] as string[];
      const rows = await tx.$queryRaw<Array<{ personId: string }>>(moveUpUpdate(kind, wanted, clubYear, actor.accountId));
      return rows.map((row) => row.personId);
    };
    const movedPersonIds = await run("move", input.moveIds);
    const keptPersonIds = await run("keep", input.keepIds);
    const moved = movedPersonIds.length;
    const kept = keptPersonIds.length;
    const skipped = requested.length - moved - kept;
    await writeAuditLog({
      action: "TLT_YEAR_MOVE_UP_CONFIRMED",
      entityType: "TltProfile",
      summary: "Confirmed the TLT year move-up.",
      metadata: { actorAttendeeAccountId: actor.accountId, clubYear, movedCount: moved, keptCount: kept, skippedCount: skipped, movedPersonIds, keptPersonIds },
    }, tx);
    return { moved, kept, skipped };
  }, { timeout: 20_000 });
}

/** One audit row when the TLT director opens the move-up page: counts only. */
export async function recordTltMoveUpView(plan: TltMoveUpPlan, actor: TltDirectorActor) {
  await writeAuditLog({
    action: "TLT_YEAR_MOVE_UP_VIEWED",
    entityType: "TltProfile",
    summary: "Opened the TLT year move-up.",
    metadata: {
      actorAttendeeAccountId: actor.accountId,
      clubYear: plan.clubYear,
      proposedCount: plan.proposed.length,
      lastLevelCount: plan.lastLevel.length,
      notSetCount: plan.notSet.length,
      alreadyThisYearCount: plan.alreadyThisYear,
    },
  });
}
