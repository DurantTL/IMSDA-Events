/**
 * Proves that a Clubs Administrator is the event administrator of every club event, and only club events (#1643),
 * against a real PostgreSQL database.
 *
 * - Permissions: an active Clubs Administrator passes `requirePermission` for every Event Administrator permission on a
 *   CLUB-audience event and is refused on a GENERAL event; the permissions no role carries stay refused.
 * - Revoke: revoking the grant removes the access on the very next lookup, and re-granting restores it.
 * - Real memberships combine: staff on a GENERAL event keep exactly that membership there.
 * - The event list: club events are listed for a Clubs Administrator (and not for a plain staff account), archived ones
 *   only when asked for; `clubEvents: "exclude"` lists the person's own assignments only.
 * - Audit: in a request whose access was checked through the role, every write path (writeAuditLog, a direct create or
 *   createMany inside a transaction) on a club event writes `actorRole: CLUBS_ADMINISTRATOR`; not on a general event, not
 *   for a system administrator, not in a request that did not check access through the role. The marker runs no query, so
 *   audited transactions on a one-connection pool finish at once.
 * Uses fictitious rows it creates and removes itself.
 *
 *   npm run test:clubs-admin-club-events
 */
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";

loadEnvConfig(process.cwd());
process.env.SECRET_ENCRYPTION_KEY ||= "verify-clubs-admin-club-events-synthetic-key-not-a-secret";

const databaseHost = (() => {
  try { return new URL(process.env.DATABASE_URL ?? "").hostname; } catch { return ""; }
})();
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(databaseHost)) {
  console.error(`Refusing to run: DATABASE_URL points at "${databaseHost || "nothing"}", not a local or CI database.`);
  process.exit(1);
}

const prisma = new PrismaClient();
const P = "cace";
const id = (name: string) => `${P}_${name}`;
const clubsAdminId = id("clubsadmin");
const sysAdminId = id("sysadmin");
const plainId = id("plain");
const clubEventId = id("club");
const archivedClubEventId = id("clubarch");
const campEventId = id("camp");
const staffCampEventId = id("staffcamp");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

async function cleanup() {
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorUserId: { startsWith: `${P}_` } }, { eventId: { startsWith: `${P}_` } }] } });
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('imsda.event_deletion', 'on', true)`;
    await tx.event.deleteMany({ where: { id: { startsWith: `${P}_` } } });
  });
  await prisma.clubsAdministratorGrant.deleteMany({ where: { userId: { startsWith: `${P}_` } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: `${P}_` } } });
}

const eventBase = {
  startsAt: new Date("2028-10-13T15:00:00Z"),
  endsAt: new Date("2028-10-15T18:00:00Z"),
  timezone: "America/Chicago",
};

async function main() {
  const { requirePermission } = await import("../modules/access/authorization");
  const { rolePermissions } = await import("../modules/access/permissions");
  const { findActiveMembership, listEventsForUser } = await import("../modules/events/repository");
  const { listArchivedEventsForUser } = await import("../modules/events/archive-repository");
  const { listActiveEventPermissionsForUser } = await import("../modules/access/membership-repository");
  const { writeAuditLog } = await import("../modules/audit/audit-service");
  const { getPrisma } = await import("../lib/prisma");
  const { runWithRequestContext } = await import("../lib/request-context");

  await cleanup();
  await prisma.user.createMany({
    data: [
      { id: clubsAdminId, email: `${P}-clubsadmin@example.test`, displayName: "Club Events Check Clubs Admin" },
      { id: sysAdminId, email: `${P}-sysadmin@example.test`, displayName: "Club Events Check System Admin", globalRole: "SYSTEM_ADMIN" },
      { id: plainId, email: `${P}-plain@example.test`, displayName: "Club Events Check Staff" },
    ],
  });
  await prisma.event.create({ data: { id: clubEventId, slug: `${P}-club`, name: "Cace Club Event", audience: "CLUB", isPublished: true, ...eventBase } });
  await prisma.event.create({ data: { id: archivedClubEventId, slug: `${P}-clubarch`, name: "Cace Archived Club Event", audience: "CLUB", archivedAt: new Date("2028-11-01T00:00:00Z"), ...eventBase } });
  await prisma.event.create({ data: { id: campEventId, slug: `${P}-camp`, name: "Cace Camp Meeting", audience: "GENERAL", isPublished: true, ...eventBase } });
  await prisma.event.create({ data: { id: staffCampEventId, slug: `${P}-staffcamp`, name: "Cace Staffed Camp", audience: "GENERAL", ...eventBase } });
  await prisma.eventMembership.create({ data: { eventId: staffCampEventId, userId: clubsAdminId, role: "READ_ONLY_STAFF" } });
  await prisma.clubsAdministratorGrant.create({ data: { userId: clubsAdminId, grantedByUserId: sysAdminId } });

  const session = (userId: string) => ({ user: { id: userId, email: `${userId}@example.test`, displayName: userId, globalRole: null } });
  const allowed = async (userId: string, eventId: string, permission: Parameters<typeof requirePermission>[2]) => {
    try { await requirePermission(session(userId), eventId, permission, findActiveMembership); return true; } catch { return false; }
  };

  // ---- Permissions ----
  for (const permission of rolePermissions.EVENT_ADMIN) {
    assert(await allowed(clubsAdminId, clubEventId, permission), `a Clubs Administrator holds ${permission} on a club event`);
    assert(!(await allowed(clubsAdminId, campEventId, permission)), `a Clubs Administrator does not hold ${permission} on a general event`);
    assert(!(await allowed(plainId, clubEventId, permission)), `an account with no grant does not hold ${permission} on a club event`);
  }
  assert(!(await allowed(clubsAdminId, clubEventId, "VIEW_HEALTH_INFORMATION")), "health information stays a per-assignment grant");
  assert(!(await allowed(clubsAdminId, clubEventId, "FINALIZE_INVOICES")), "finalizing invoices stays a per-assignment grant");
  assert(await allowed(clubsAdminId, staffCampEventId, "VIEW_EVENT"), "a real staff membership on a general event still applies");
  assert(!(await allowed(clubsAdminId, staffCampEventId, "MANAGE_FINANCE")), "a real read-only membership on a general event is not raised");
  const shellPermissions = await listActiveEventPermissionsForUser(clubsAdminId, [clubEventId, campEventId, staffCampEventId]);
  assert(shellPermissions.get(clubEventId)?.includes("MANAGE_STAFF"), "the shell sees the event administrator set on the club event");
  assert(!shellPermissions.has(campEventId), "the shell sees nothing on a general event without a membership");

  // ---- The event list ----
  const listed = async (userId: string, options?: Parameters<typeof listEventsForUser>[2]) => (await listEventsForUser(userId, false, options)).map((event) => event.id).filter((eventId) => eventId.startsWith(`${P}_`)).sort();
  assert(JSON.stringify(await listed(clubsAdminId)) === JSON.stringify([clubEventId, staffCampEventId].sort()), "the list holds the club event and the staffed event, not the other general event or the archived club event");
  assert(JSON.stringify(await listed(clubsAdminId, { archived: "include" })) === JSON.stringify([archivedClubEventId, clubEventId, staffCampEventId].sort()), "archived club events come with archived: include");
  assert(JSON.stringify(await listed(clubsAdminId, { clubEvents: "exclude" })) === JSON.stringify([staffCampEventId]), "clubEvents: exclude lists only the person's own assignments");
  assert((await listed(plainId)).length === 0, "an account with no grant or assignment lists nothing");
  assert((await listArchivedEventsForUser(clubsAdminId, false)).map((event) => event.id).filter((eventId) => eventId.startsWith(`${P}_`)).join() === archivedClubEventId, "the archived list holds the archived club event");

  // ---- Audit ----
  const metadataOf = async (action: string) => (await prisma.auditLog.findFirstOrThrow({ where: { action, eventId: { startsWith: `${P}_` } } })).metadata as Record<string, unknown> | null;
  // Audit rows are marked from what the permission lookup recorded in the request: the request below checks access the way a
  // route does (`requirePermission` with `findActiveMembership`), then writes. No query runs at write time.
  const inRequest = <T>(run: () => Promise<T>) => runWithRequestContext({ correlationId: id("request") }, run);
  await inRequest(async () => {
    await requirePermission(session(clubsAdminId), clubEventId, "CONFIGURE_EVENT", findActiveMembership);
    await writeAuditLog({ eventId: clubEventId, actorUserId: clubsAdminId, action: "CACE_CLUB", entityType: "Event", entityId: clubEventId, summary: "Check entry.", metadata: { n: 1 } });
    await writeAuditLog({ eventId: campEventId, actorUserId: clubsAdminId, action: "CACE_CAMP", entityType: "Event", entityId: campEventId, summary: "Check entry.", metadata: { n: 2 } });
    // A direct create inside a transaction (as the tag, promo code and registration repositories write their audit rows) and a
    // createMany get the marker too, and the actor's own metadata is kept.
    await getPrisma().$transaction(async (tx) => {
      await tx.auditLog.create({ data: { eventId: clubEventId, actorUserId: clubsAdminId, action: "CACE_DIRECT", entityType: "Tag", entityId: id("tag"), correlationId: id("c1"), summary: "Check entry.", metadata: { name: "x" } } });
      await tx.auditLog.createMany({ data: [
        { eventId: clubEventId, actorUserId: clubsAdminId, action: "CACE_MANY", entityType: "Tag", entityId: id("tag"), correlationId: id("c2"), summary: "Check entry." },
        { eventId: campEventId, actorUserId: clubsAdminId, action: "CACE_MANY_CAMP", entityType: "Tag", entityId: id("tag"), correlationId: id("c3"), summary: "Check entry." },
      ] });
    });
  });
  await inRequest(async () => {
    // A system administrator's lookup never goes through the role, so nothing is recorded for their writes.
    await writeAuditLog({ eventId: clubEventId, actorUserId: sysAdminId, action: "CACE_SYSTEM", entityType: "Event", entityId: clubEventId, summary: "Check entry.", metadata: { n: 3 } });
    // A write in a request that never checked access through the role is unmarked, even for the same person.
    await writeAuditLog({ eventId: clubEventId, actorUserId: clubsAdminId, action: "CACE_UNCHECKED", entityType: "Event", entityId: clubEventId, summary: "Check entry.", metadata: { n: 5 } });
  });
  assert((await metadataOf("CACE_CLUB"))?.actorRole === "CLUBS_ADMINISTRATOR", "an action on a club event records the Clubs Administrator role");
  assert((await metadataOf("CACE_CAMP"))?.actorRole === undefined, "an action on a general event does not");
  assert((await metadataOf("CACE_SYSTEM"))?.actorRole === undefined, "a system administrator's action does not");
  assert((await metadataOf("CACE_UNCHECKED"))?.actorRole === undefined, "a request that did not check access through the role is unmarked");
  const direct = await metadataOf("CACE_DIRECT");
  assert(direct?.actorRole === "CLUBS_ADMINISTRATOR" && direct?.name === "x", "a direct create in a transaction records the role and keeps its metadata");
  assert((await metadataOf("CACE_MANY"))?.actorRole === "CLUBS_ADMINISTRATOR", "a createMany row on a club event records the role");
  assert((await metadataOf("CACE_MANY_CAMP"))?.actorRole === undefined, "a createMany row on a general event does not");

  // ---- No pool wait: an audited transaction on a one-connection pool finishes at once (the marker runs no query). ----
  {
    const single = new PrismaClient({ datasources: { db: { url: `${process.env.DATABASE_URL}${process.env.DATABASE_URL?.includes("?") ? "&" : "?"}connection_limit=1&pool_timeout=3` } } });
    const { withClubsAdministratorMarker } = await import("../modules/audit/clubs-administrator-marker");
    const started = Date.now();
    await inRequest(async () => {
      await requirePermission(session(clubsAdminId), clubEventId, "CONFIGURE_EVENT", findActiveMembership);
      // The app's extension, on a one-connection client, as `lib/prisma.ts` builds it.
      const extended = single.$extends({ query: { auditLog: { async create({ args, query }) { return query({ ...args, data: withClubsAdministratorMarker(args.data) }); } } } });
      await Promise.all([1, 2, 3].map((n) => extended.$transaction(async (tx) => {
        await tx.auditLog.create({ data: { eventId: clubEventId, actorUserId: clubsAdminId, action: `CACE_POOL_${n}`, entityType: "Tag", entityId: id("tag"), correlationId: id(`p${n}`), summary: "Check entry." } });
      }, { timeout: 5000 })));
    });
    await single.$disconnect();
    assert(Date.now() - started < 3000, "audited transactions on a one-connection pool do not wait for a second connection");
    assert((await metadataOf("CACE_POOL_1"))?.actorRole === "CLUBS_ADMINISTRATOR", "a write on the one-connection pool is marked");
  }

  // ---- Revoke: the very next lookup ----
  await prisma.clubsAdministratorGrant.update({ where: { userId: clubsAdminId }, data: { revokedAt: new Date() } });
  assert(!(await allowed(clubsAdminId, clubEventId, "VIEW_EVENT")), "a revoked Clubs Administrator is refused on a club event at once");
  assert((await findActiveMembership(clubsAdminId, clubEventId)) === null, "no membership resolves after the revoke");
  assert(!(await listed(clubsAdminId)).includes(clubEventId), "the club event leaves the list at once");
  await inRequest(async () => {
    await findActiveMembership(clubsAdminId, clubEventId);
    await writeAuditLog({ eventId: clubEventId, actorUserId: clubsAdminId, action: "CACE_REVOKED", entityType: "Event", entityId: clubEventId, summary: "Check entry.", metadata: { n: 4 } });
  });
  assert((await metadataOf("CACE_REVOKED"))?.actorRole === undefined, "no marker after the revoke");
  await prisma.clubsAdministratorGrant.update({ where: { userId: clubsAdminId }, data: { revokedAt: null } });
  assert(await allowed(clubsAdminId, clubEventId, "MANAGE_FINANCE"), "a new grant restores the access");

  console.log("Clubs Administrator club event access: all checks passed.");
}

main()
  .then(async () => { await cleanup(); })
  .catch(async (error) => {
    console.error(error);
    await cleanup().catch(() => undefined);
    process.exitCode = 1;
  })
  .finally(async () => { await prisma.$disconnect(); });
