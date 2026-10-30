/**
 * Proves the event archive contract (#635) against a real PostgreSQL database.
 *
 * - Permissions: a system administrator and the event's own Event Admin may
 *   archive and unarchive; another role, an Event Admin of a different event,
 *   and an account with no role are refused, and a refusal changes no row.
 * - No data changes: archiving changes only `archivedAt`, `archivedByUserId`
 *   and `updatedAt` on the one Event row. A full table-count diff shows the
 *   only growth is one audit row, and unarchiving restores every column.
 * - Audit: one row per archive and per unarchive, ids only (no name or date),
 *   and a repeated request writes none.
 * - Hiding: an archived event is left out of the staff event list, the public
 *   event page, the public calendar and the Archived events list's complement,
 *   and registration reads as closed; unarchiving brings each back.
 * Uses fictitious rows it creates and removes itself.
 *
 *   npm run test:event-archive
 */
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";

loadEnvConfig(process.cwd());
process.env.SECRET_ENCRYPTION_KEY ||= "verify-event-archive-synthetic-key-not-a-secret";

const databaseHost = (() => {
  try { return new URL(process.env.DATABASE_URL ?? "").hostname; } catch { return ""; }
})();
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(databaseHost)) {
  console.error(`Refusing to run: DATABASE_URL points at "${databaseHost || "nothing"}", not a local or CI database.`);
  process.exit(1);
}

const prisma = new PrismaClient();
const P = "evarc";
const id = (name: string) => `${P}_${name}`;
const adminId = id("sysadmin");
const eventAdminId = id("eventadmin");
const otherAdminId = id("otheradmin");
const staffId = id("staff");
const strangerId = id("stranger");
const eventId = id("event");
const siblingId = id("sibling");
const otherEventId = id("other");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

async function tableCounts() {
  const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'
    ORDER BY table_name`;
  const counts = new Map<string, number>();
  for (const { table_name } of tables) {
    const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM "${table_name}"`);
    counts.set(table_name, Number(rows[0].n));
  }
  return counts;
}

function without(row: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)));
}

function diffCounts(before: Map<string, number>, after: Map<string, number>) {
  const changes: Record<string, number> = {};
  for (const [table, n] of after) if (n !== (before.get(table) ?? 0)) changes[table] = n - (before.get(table) ?? 0);
  return changes;
}

async function cleanup() {
  const events = { id: { startsWith: `${P}_` } };
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorUserId: { startsWith: `${P}_` } }, { entityId: { startsWith: `${P}_` } }] } });
  await prisma.$transaction(async (tx) => {
    // Event deletion is the one way lifecycle history may be deleted (#156).
    await tx.$executeRaw`SELECT set_config('imsda.event_deletion', 'on', true)`;
    await tx.event.deleteMany({ where: events });
  });
  await prisma.honor.deleteMany({ where: events });
  await prisma.person.deleteMany({ where: events });
  await prisma.user.deleteMany({ where: { id: { startsWith: `${P}_` } } });
}

const eventBase = {
  startsAt: new Date("2028-10-13T15:00:00Z"),
  endsAt: new Date("2028-10-15T18:00:00Z"),
  timezone: "America/Chicago",
};

async function main() {
  const { archiveEvent, unarchiveEvent, listArchivedEventsForUser, EventArchiveForbiddenError } = await import("../modules/events/archive-repository");
  const { listEventsForUser } = await import("../modules/events/repository");
  const { listPublicCalendarItems } = await import("../modules/calendar/repository");
  const { getPublicEventLanding } = await import("../modules/events/public-repository");
  const { selectEventContext } = await import("../modules/events/context-selection");

  await cleanup();
  await prisma.user.createMany({
    data: [
      { id: adminId, email: `${P}-admin@example.test`, displayName: "Archive Check Admin", globalRole: "SYSTEM_ADMIN" },
      { id: eventAdminId, email: `${P}-eventadmin@example.test`, displayName: "Archive Check Event Admin" },
      { id: otherAdminId, email: `${P}-otheradmin@example.test`, displayName: "Archive Check Other Admin" },
      { id: staffId, email: `${P}-staff@example.test`, displayName: "Archive Check Staff" },
      { id: strangerId, email: `${P}-stranger@example.test`, displayName: "Archive Check Stranger" },
    ],
  });
  await prisma.event.create({ data: { id: eventId, slug: `${P}-event`, name: "Evarc Event", isPublished: true, showOnCalendar: true, ...eventBase } });
  await prisma.event.create({ data: { id: siblingId, slug: `${P}-sibling`, name: "Evarc Sibling", isPublished: true, ...eventBase } });
  await prisma.event.create({ data: { id: otherEventId, slug: `${P}-other`, name: "Evarc Other", ...eventBase } });
  await prisma.eventMembership.createMany({
    data: [
      { eventId, userId: eventAdminId, role: "EVENT_ADMIN" },
      { eventId: siblingId, userId: eventAdminId, role: "EVENT_ADMIN" },
      { eventId, userId: staffId, role: "REGISTRATION_MANAGER" },
      { eventId: otherEventId, userId: otherAdminId, role: "EVENT_ADMIN" },
    ],
  });

  const actor = (userId: string, eventRole: string | null, globalRole: "SYSTEM_ADMIN" | null = null) => ({ userId, globalRole, eventRole });
  const readEvent = () => prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  const original = await readEvent();
  assert(original.archivedAt === null && original.archivedByUserId === null, "a new event is not archived");
  const phaseSource = { isPublished: true, lifecycleState: null, timezone: "America/Chicago", registrationOpensOn: null, registrationClosesOn: null, waitlistEnabled: false, endsAt: null };
  const { evaluateEventRegistrationPhase } = await import("../modules/events/lifecycle");

  // ---- Permissions: refusals change nothing. ----
  const beforeRefusals = await tableCounts();
  for (const [label, who] of [
    ["a registration manager", actor(staffId, "REGISTRATION_MANAGER")],
    ["an Event Admin of another event", actor(otherAdminId, null)],
    ["an account with no role", actor(strangerId, null)],
  ] as const) {
    let refused = false;
    try { await archiveEvent({ eventId, actor: who }); } catch (error) { refused = error instanceof EventArchiveForbiddenError; }
    assert(refused, `${label} cannot archive`);
  }
  let missing = false;
  try { await archiveEvent({ eventId: id("nope"), actor: actor(adminId, null, "SYSTEM_ADMIN") }); } catch (error) { missing = (error as { code?: string }).code === "EVENT_NOT_FOUND"; }
  assert(missing, "an unknown event is reported as not found");
  assert(Object.keys(diffCounts(beforeRefusals, await tableCounts())).length === 0, "refusals change no row anywhere");
  assert((await readEvent()).archivedAt === null, "refusals leave the event unarchived");
  let unarchiveRefused = false;
  try { await unarchiveEvent({ eventId, actor: actor(staffId, "REGISTRATION_MANAGER") }); } catch (error) { unarchiveRefused = error instanceof EventArchiveForbiddenError; }
  assert(unarchiveRefused, "unarchive has the same permission rule");

  // ---- Visible before archiving. ----
  const everyone = await listEventsForUser(eventAdminId, false);
  assert(everyone.some((event) => event.id === eventId), "the live event is in the staff list");
  const calendarFrom = "2028-10-01";
  const calendarTo = "2028-10-31";
  assert((await listPublicCalendarItems(calendarFrom, calendarTo)).some((item) => item.key === `event-${eventId}`), "the live event is on the public calendar");
  assert(Boolean(await getPublicEventLanding(`${P}-event`)), "the live event has a public page");

  // ---- Archive as the Event Admin. ----
  const beforeArchive = await tableCounts();
  const archived = await archiveEvent({ eventId, actor: actor(eventAdminId, "EVENT_ADMIN") });
  assert(archived.archived && archived.changed, "the Event Admin archives their event");
  const afterArchive = diffCounts(beforeArchive, await tableCounts());
  assert(JSON.stringify(afterArchive) === JSON.stringify({ AuditLog: 1, EventLifecycleTransition: 1 }), `archiving adds one audit row and one lifecycle history row and nothing else (got ${JSON.stringify(afterArchive)})`);
  const archivedRow = await readEvent();
  assert(archivedRow.archivedAt instanceof Date && archivedRow.archivedByUserId === eventAdminId, "archivedAt and archivedByUserId are set");
  assert(JSON.stringify(without(archivedRow, ["archivedAt", "archivedByUserId", "updatedAt"])) === JSON.stringify(without(original, ["archivedAt", "archivedByUserId", "updatedAt"])), "archiving changes no other column");
  const audit = await prisma.auditLog.findMany({ where: { entityId: eventId, action: "EVENT_ARCHIVED" } });
  assert(audit.length === 1 && audit[0].actorUserId === eventAdminId && audit[0].eventId === eventId, "one EVENT_ARCHIVED audit row names the actor and event");
  assert(JSON.stringify(audit[0].metadata) === JSON.stringify({ eventId }), "the audit metadata is ids only");
  assert(!JSON.stringify(audit[0]).includes("Evarc"), "the audit row holds no event name");

  // A repeat is idempotent: no second audit row.
  const repeat = await archiveEvent({ eventId, actor: actor(adminId, null, "SYSTEM_ADMIN") });
  assert(repeat.archived && !repeat.changed, "archiving an archived event changes nothing");
  assert((await prisma.auditLog.count({ where: { entityId: eventId, action: "EVENT_ARCHIVED" } })) === 1, "a repeated archive writes no second audit row");
  assert((await readEvent()).archivedByUserId === eventAdminId, "a repeated archive keeps who archived it");

  // ---- Hidden everywhere it should be. ----
  const listed = await listEventsForUser(eventAdminId, false);
  assert(!listed.some((event) => event.id === eventId) && listed.some((event) => event.id === siblingId), "the staff list drops the archived event only");
  assert(!(await listEventsForUser(adminId, true)).some((event) => event.id === eventId), "the system administrator's list drops it too");
  const included = await listEventsForUser(adminId, true, { archived: "include" });
  assert(included.some((event) => event.id === eventId && event.archivedAt !== null), "an explicit include still finds it");
  const selection = selectEventContext({ events: included, lastUsedEventId: eventId });
  assert(!("event" in selection) || selection.event.id !== eventId, "default selection never picks the archived event");
  assert(selectEventContext({ events: included, requestedEventId: eventId }).kind === "requested", "a direct link still opens it");
  assert(!(await listPublicCalendarItems(calendarFrom, calendarTo)).some((item) => item.key === `event-${eventId}`), "the public calendar drops it");
  assert((await getPublicEventLanding(`${P}-event`)) === null, "its public page is gone");
  assert(evaluateEventRegistrationPhase({ ...phaseSource, archivedAt: archivedRow.archivedAt }) === "CLOSED", "registration reads as closed");
  const archivedList = await listArchivedEventsForUser(eventAdminId, false);
  assert(archivedList.length === 1 && archivedList[0].id === eventId, "the Archived events list holds it for its Event Admin");
  assert((await listArchivedEventsForUser(otherAdminId, false)).length === 0, "another event's admin does not see it in their archived list");
  assert((await listArchivedEventsForUser(adminId, true)).some((event) => event.id === eventId), "a system administrator sees every archived event");

  // ---- Unarchive restores everything exactly. ----
  const beforeUnarchive = await tableCounts();
  const restored = await unarchiveEvent({ eventId, actor: actor(adminId, null, "SYSTEM_ADMIN") });
  assert(!restored.archived && restored.changed, "a system administrator unarchives");
  assert(JSON.stringify(diffCounts(beforeUnarchive, await tableCounts())) === JSON.stringify({ AuditLog: 1, EventLifecycleTransition: 1 }), "unarchiving adds one audit row and one lifecycle history row and nothing else");
  const restoredRow = await readEvent();
  assert(restoredRow.archivedAt === null && restoredRow.archivedByUserId === null, "unarchiving clears both fields");
  assert(JSON.stringify(without(restoredRow, ["updatedAt"])) === JSON.stringify(without(original, ["updatedAt"])), "every column is back exactly as it was");
  assert((await listEventsForUser(eventAdminId, false)).some((event) => event.id === eventId), "the staff list has it again");
  assert((await listPublicCalendarItems(calendarFrom, calendarTo)).some((item) => item.key === `event-${eventId}`), "the public calendar has it again");
  assert(Boolean(await getPublicEventLanding(`${P}-event`)), "its public page is back");
  assert(evaluateEventRegistrationPhase({ ...phaseSource, archivedAt: null }) === "OPEN", "registration is open again");
  const unarchiveAudit = await prisma.auditLog.findMany({ where: { entityId: eventId, action: "EVENT_UNARCHIVED" } });
  assert(unarchiveAudit.length === 1 && JSON.stringify(unarchiveAudit[0].metadata) === JSON.stringify({ eventId }), "one EVENT_UNARCHIVED audit row, ids only");
  const again = await unarchiveEvent({ eventId, actor: actor(adminId, null, "SYSTEM_ADMIN") });
  assert(!again.archived && !again.changed, "unarchiving a live event changes nothing");

  // ---- The class waitlist sweep leaves an archived event's live offers alone (they are not lapsed, and unarchiving could not undo that). ----
  const { sweepClassWaitlists, promoteClassWaitlists } = await import("../modules/honors/waitlist-repository");
  const sweepNow = new Date("2028-10-01T12:00:00Z");
  async function offeredEntry(forEventId: string, key: string) {
    const honor = await prisma.honor.create({ data: { id: id(`honor_${key}`), code: `EVARC-${key}`, name: `Evarc honor ${key}`, normalizedName: `evarc honor ${key}` } });
    const offering = await prisma.honorOffering.create({ data: { id: id(`offering_${key}`), eventId: forEventId, honorId: honor.id, span: "ALL_SESSIONS", capacity: 5 } });
    const holder = await prisma.person.create({ data: { id: id(`holder_${key}`), firstName: "Evarc", lastName: `Holder ${key}` } });
    const registration = await prisma.registration.create({ data: { id: id(`reg_${key}`), eventId: forEventId, accountHolderPersonId: holder.id, confirmationCode: `REG-${P}-${key}`, status: "SUBMITTED", totalAmount: 0, submittedAt: sweepNow } });
    const attendee = await prisma.registrationAttendee.create({
      data: { eventId: forEventId, registrationId: registration.id, personId: holder.id, attendeeType: "YOUTH", position: 0, profileSnapshot: { firstName: "Evarc", lastName: key, ageOnEventDate: 13 } },
    });
    return prisma.honorClassWaitlistEntry.create({
      data: {
        id: id(`entry_${key}`), eventId: forEventId, offeringId: offering.id, registrationId: registration.id, registrationAttendeeId: attendee.id,
        status: "OFFERED", offeredAt: new Date("2028-09-20T12:00:00Z"), offerExpiresAt: new Date("2028-09-25T12:00:00Z"), offerCount: 1,
      },
    });
  }
  const liveEntry = await offeredEntry(eventId, "live");
  const controlEntry = await offeredEntry(siblingId, "control");
  const readEntry = (entryId: string) => prisma.honorClassWaitlistEntry.findUniqueOrThrow({ where: { id: entryId } });
  const liveBefore = await readEntry(liveEntry.id);
  await archiveEvent({ eventId, actor: actor(adminId, null, "SYSTEM_ADMIN") });
  const sweep = await sweepClassWaitlists(sweepNow);
  assert(sweep.failed === 0, "the sweep ran cleanly");
  assert(JSON.stringify(await readEntry(liveEntry.id)) === JSON.stringify(liveBefore), "the sweep leaves an archived event's OFFERED entry exactly as it was");
  assert((await readEntry(controlEntry.id)).status === "EXPIRED", "the same sweep still lapses an expired offer on an event that is not archived");
  // Direct promotion (what a cancellation, transfer or staff action on the event runs) is a no-op for an archived event too.
  const direct = await prisma.$transaction((tx) => promoteClassWaitlists(tx, eventId, [liveEntry.offeringId], sweepNow));
  assert(direct.lapsed === 0 && direct.offered === 0 && direct.messageIds.length === 0, "promoting on an archived event does nothing");
  assert(JSON.stringify(await readEntry(liveEntry.id)) === JSON.stringify(liveBefore), "direct promotion leaves an archived event's OFFERED entry exactly as it was");
  await unarchiveEvent({ eventId, actor: actor(adminId, null, "SYSTEM_ADMIN") });
  assert(JSON.stringify(await readEntry(liveEntry.id)) === JSON.stringify(liveBefore), "unarchiving finds the entry unchanged");
  const afterUnarchive = await prisma.$transaction((tx) => promoteClassWaitlists(tx, eventId, [liveEntry.offeringId], sweepNow));
  assert(afterUnarchive.lapsed === 1 && (await readEntry(liveEntry.id)).status === "EXPIRED", "after unarchive the first promotion lapses an offer whose time ran out meanwhile");

  // ---- A deleted archiver does not block anything. ----
  await archiveEvent({ eventId, actor: actor(staffId, "EVENT_ADMIN") });
  await prisma.eventMembership.deleteMany({ where: { userId: staffId } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: staffId } });
  await prisma.user.delete({ where: { id: staffId } });
  assert((await readEvent()).archivedAt !== null && (await readEvent()).archivedByUserId === null, "deleting the archiving account keeps the event archived");

  console.log("Event archive checks passed.");
}

main()
  .then(async () => {
    await cleanup();
  })
  .catch(async (error) => {
    console.error(error);
    await cleanup().catch((cleanupError) => console.error("Cleanup failed:", cleanupError));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
