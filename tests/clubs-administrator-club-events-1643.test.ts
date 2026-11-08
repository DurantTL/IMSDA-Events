import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1643 (Caleb, 2026-11-07): an active Clubs Administrator holds the EVENT_ADMIN permission set on every event whose
 * audience is CLUB, and nowhere else; a revoke applies on the next request; real memberships still combine; the audit
 * entry records the role. The real resolver, permission check, list filter and audit service run; only the database is
 * faked. Synthetic data only.
 */

vi.mock("server-only", () => ({}));

type Grant = { userId: string; revokedAt: Date | null };
type Event = { id: string; audience: "CLUB" | "GENERAL" };
type Membership = { eventId: string; userId: string; role: string; status: "ACTIVE" | "INACTIVE"; permissions: string[] };

const db = vi.hoisted(() => ({
  grants: [] as Grant[],
  events: [] as Event[],
  memberships: [] as Membership[],
  users: [] as Array<{ id: string; globalRole: "SYSTEM_ADMIN" | null }>,
  auditRows: [] as Array<Record<string, unknown>>,
  eventFindManyWheres: [] as unknown[],
}));

function fakeClient() {
  return {
    clubsAdministratorGrant: {
      findFirst: async ({ where }: { where: { userId: string } }) => (db.grants.find((grant) => grant.userId === where.userId && grant.revokedAt === null) ? { id: "grant" } : null),
    },
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => db.users.find((user) => user.id === where.id) ?? null,
    },
    event: {
      findUnique: async ({ where, select }: { where: { id: string }; select: { memberships?: { where: { userId: string; role: string } } } }) => {
        const event = db.events.find((candidate) => candidate.id === where.id);
        if (!event) return null;
        if (!select.memberships) return { audience: event.audience };
        const wanted = select.memberships.where;
        return {
          audience: event.audience,
          memberships: db.memberships.filter((m) => m.eventId === event.id && m.userId === wanted.userId && m.status === "ACTIVE" && m.role === wanted.role).map(() => ({ id: "m" })),
        };
      },
      findMany: async (args: { where: { id?: { in: string[] }; audience?: string } }) => {
        db.eventFindManyWheres.push(args.where);
        return db.events.filter((event) => (!args.where.id || args.where.id.in.includes(event.id)) && (!args.where.audience || event.audience === args.where.audience));
      },
    },
    eventMembership: {
      findUnique: async ({ where }: { where: { eventId_userId: { eventId: string; userId: string } } }) =>
        db.memberships.find((m) => m.eventId === where.eventId_userId.eventId && m.userId === where.eventId_userId.userId) ?? null,
      findMany: async ({ where }: { where: { userId: string; eventId: { in: string[] } } }) =>
        db.memberships.filter((m) => m.userId === where.userId && where.eventId.in.includes(m.eventId) && m.status === "ACTIVE"),
    },
    auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { db.auditRows.push(data); return data; } },
  };
}

vi.mock("@/lib/prisma", () => ({ getPrisma: () => fakeClient() }));

import { requirePermission, effectivePermissions, AccessDeniedError, type Session } from "@/modules/access/authorization";
import { clubsAdministratorPermissions, findEffectiveMembership } from "@/modules/access/club-event-access";
import { listActiveEventPermissionsForUser, listActiveEventRolesForUser } from "@/modules/access/membership-repository";
import { eventPermissions, rolePermissions } from "@/modules/access/permissions";
import { wasClubsAdministratorAccess } from "@/lib/clubs-administrator-access-record";
import { runWithRequestScopedSet } from "@/lib/request-scoped-set";
import { withClubsAdministratorMarker } from "@/modules/audit/clubs-administrator-marker";
import { findActiveMembership } from "@/modules/events/repository";

const CLUB = "event-club";
const CAMP = "event-camp-meeting";
const clubsAdmin = { id: "user-clubs-admin", email: "clubs.admin@example.test", displayName: "Synthetic Clubs Admin", globalRole: null };
const sessionFor = (user: typeof clubsAdmin | { id: string; email: string; displayName: string; globalRole: "SYSTEM_ADMIN" | null }): Session => ({ user });

beforeEach(() => {
  db.grants = [{ userId: clubsAdmin.id, revokedAt: null }];
  db.events = [{ id: CLUB, audience: "CLUB" }, { id: CAMP, audience: "GENERAL" }];
  db.memberships = [];
  db.users = [{ id: clubsAdmin.id, globalRole: null }, { id: "user-system", globalRole: "SYSTEM_ADMIN" }];
  db.auditRows = [];
  db.eventFindManyWheres = [];
});

describe("event permissions for a Clubs Administrator (#1643)", () => {
  it("holds every EVENT_ADMIN permission on a club event, and no more", async () => {
    const membership = await findActiveMembership(clubsAdmin.id, CLUB);
    expect(membership).toMatchObject({ role: "EVENT_ADMIN", status: "ACTIVE", viaClubsAdministrator: true });
    expect(effectivePermissions(clubsAdmin, membership)).toEqual(expect.arrayContaining([...rolePermissions.EVENT_ADMIN]));
    for (const permission of rolePermissions.EVENT_ADMIN) {
      await expect(requirePermission(sessionFor(clubsAdmin), CLUB, permission, findActiveMembership)).resolves.toBeTruthy();
    }
    // The permissions no role carries stay a per-assignment grant by a system administrator.
    for (const permission of ["VIEW_HEALTH_INFORMATION", "FINALIZE_INVOICES"] as const) {
      await expect(requirePermission(sessionFor(clubsAdmin), CLUB, permission, findActiveMembership)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    }
  });

  it("holds nothing on a non-club event without a membership", async () => {
    expect(await findActiveMembership(clubsAdmin.id, CAMP)).toBeNull();
    await expect(requirePermission(sessionFor(clubsAdmin), CAMP, "VIEW_EVENT", findActiveMembership)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(requirePermission(sessionFor(clubsAdmin), CAMP, "VIEW_EVENT", findActiveMembership)).rejects.toMatchObject({ code: "EVENT_ACCESS_DENIED" });
  });

  it("holds nothing on an event that does not exist", async () => {
    expect(await findActiveMembership(clubsAdmin.id, "event-missing")).toBeNull();
  });

  it("loses the access on the very next request when the grant is revoked", async () => {
    await expect(requirePermission(sessionFor(clubsAdmin), CLUB, "MANAGE_FINANCE", findActiveMembership)).resolves.toBeTruthy();
    db.grants[0].revokedAt = new Date("2026-11-08T00:00:00Z");
    await expect(requirePermission(sessionFor(clubsAdmin), CLUB, "MANAGE_FINANCE", findActiveMembership)).rejects.toMatchObject({ code: "EVENT_ACCESS_DENIED" });
    expect((await listActiveEventPermissionsForUser(clubsAdmin.id, [CLUB])).size).toBe(0);
    expect((await listActiveEventRolesForUser(clubsAdmin.id, [CLUB])).size).toBe(0);
  });

  it("gives a person who is not a Clubs Administrator nothing on a club event", async () => {
    expect(await findActiveMembership("user-plain", CLUB)).toBeNull();
  });

  it("combines with a real membership: extra grants kept on a club event, the real role alone elsewhere", async () => {
    db.memberships = [
      { eventId: CLUB, userId: clubsAdmin.id, role: "READ_ONLY_STAFF", status: "ACTIVE", permissions: ["VIEW_HEALTH_INFORMATION"] },
      { eventId: CAMP, userId: clubsAdmin.id, role: "READ_ONLY_STAFF", status: "ACTIVE", permissions: [] },
    ];
    const onClub = await findActiveMembership(clubsAdmin.id, CLUB);
    expect(onClub?.role).toBe("EVENT_ADMIN");
    expect(effectivePermissions(clubsAdmin, onClub)).toEqual(expect.arrayContaining([...rolePermissions.EVENT_ADMIN, "VIEW_HEALTH_INFORMATION"]));
    const onCamp = await findActiveMembership(clubsAdmin.id, CAMP);
    expect(onCamp).toMatchObject({ role: "READ_ONLY_STAFF" });
    expect(onCamp?.viaClubsAdministrator).toBeUndefined();
    await expect(requirePermission(sessionFor(clubsAdmin), CAMP, "MANAGE_FINANCE", findActiveMembership)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("does not carry the extra grants of an inactive membership", async () => {
    db.memberships = [{ eventId: CLUB, userId: clubsAdmin.id, role: "READ_ONLY_STAFF", status: "INACTIVE", permissions: ["VIEW_HEALTH_INFORMATION"] }];
    const membership = await findEffectiveMembership(fakeClient() as never, clubsAdmin.id, CLUB);
    expect(membership?.permissions).toEqual([]);
  });

  it("returns a real active EVENT_ADMIN membership as it is", async () => {
    db.memberships = [{ eventId: CLUB, userId: clubsAdmin.id, role: "EVENT_ADMIN", status: "ACTIVE", permissions: [] }];
    expect((await findActiveMembership(clubsAdmin.id, CLUB))?.viaClubsAdministrator).toBeUndefined();
  });

  it("builds the same permission set the shell uses", async () => {
    db.memberships = [{ eventId: CLUB, userId: clubsAdmin.id, role: "READ_ONLY_STAFF", status: "ACTIVE", permissions: ["VIEW_HEALTH_INFORMATION"] }];
    const permissions = await listActiveEventPermissionsForUser(clubsAdmin.id, [CLUB, CAMP]);
    expect(permissions.get(CLUB)).toEqual(expect.arrayContaining([...rolePermissions.EVENT_ADMIN, "VIEW_HEALTH_INFORMATION"]));
    expect(permissions.has(CAMP)).toBe(false);
    expect(clubsAdministratorPermissions()).toEqual([...rolePermissions.EVENT_ADMIN]);
    const roles = await listActiveEventRolesForUser(clubsAdmin.id, [CLUB, CAMP]);
    expect(roles.get(CLUB)).toBe("EVENT_ADMIN");
    expect(roles.has(CAMP)).toBe(false);
  });

  it("leaves a system administrator's own full set as it was", () => {
    expect(effectivePermissions({ id: "user-system", email: "s@example.test", displayName: "S", globalRole: "SYSTEM_ADMIN" }, null)).toEqual([...eventPermissions]);
  });
});

describe("the audit marker (#1643)", () => {
  const row = (eventId: string | undefined, actorUserId: string | undefined, metadata?: unknown) => ({ eventId, actorUserId, action: "X", entityType: "Event", summary: "s", metadata });
  const inRequest = <T>(run: () => T) => runWithRequestScopedSet(run);

  it("marks a row whose actor and event match an access the lookup recorded in this request", async () => {
    await inRequest(async () => {
      await findActiveMembership(clubsAdmin.id, CLUB);
      expect(withClubsAdministratorMarker(row(CLUB, clubsAdmin.id, { field: "capacity" })).metadata).toEqual({ field: "capacity", actorRole: "CLUBS_ADMINISTRATOR" });
      expect(withClubsAdministratorMarker(row(CLUB, clubsAdmin.id))).toEqual({ ...row(CLUB, clubsAdmin.id), metadata: { actorRole: "CLUBS_ADMINISTRATOR" } });
    });
  });

  it("does not mark a different event, a different actor, a row with no event or actor, or a request that recorded nothing", async () => {
    await inRequest(async () => {
      await findActiveMembership(clubsAdmin.id, CLUB);
      expect(withClubsAdministratorMarker(row(CAMP, clubsAdmin.id, { a: 1 })).metadata).toEqual({ a: 1 });
      expect(withClubsAdministratorMarker(row(CLUB, "user-plain", { a: 2 })).metadata).toEqual({ a: 2 });
      expect(withClubsAdministratorMarker(row(undefined, clubsAdmin.id, { a: 3 })).metadata).toEqual({ a: 3 });
      expect(withClubsAdministratorMarker(row(CLUB, undefined)).metadata).toBeUndefined();
    });
    await inRequest(async () => {
      expect(withClubsAdministratorMarker(row(CLUB, clubsAdmin.id, { a: 4 })).metadata).toEqual({ a: 4 });
    });
  });

  it("does not leak between requests, and writes unmarked with no store", async () => {
    await inRequest(() => findActiveMembership(clubsAdmin.id, CLUB));
    await inRequest(async () => expect(withClubsAdministratorMarker(row(CLUB, clubsAdmin.id)).metadata).toBeUndefined());
    // Outside a request and outside a React render nothing is kept.
    await findActiveMembership(clubsAdmin.id, CLUB);
    expect(withClubsAdministratorMarker(row(CLUB, clubsAdmin.id)).metadata).toBeUndefined();
  });

  it("records nothing for a non-club event, a revoked grant, a system administrator's own lookup, or a real event administrator", async () => {
    await inRequest(async () => {
      await findActiveMembership(clubsAdmin.id, CAMP);
      db.grants[0].revokedAt = new Date();
      await findActiveMembership(clubsAdmin.id, CLUB);
      db.grants[0].revokedAt = null;
      db.memberships = [{ eventId: CLUB, userId: clubsAdmin.id, role: "EVENT_ADMIN", status: "ACTIVE", permissions: [] }];
      await findActiveMembership(clubsAdmin.id, CLUB);
      expect(wasClubsAdministratorAccess(clubsAdmin.id, CAMP)).toBe(false);
      expect(wasClubsAdministratorAccess(clubsAdmin.id, CLUB)).toBe(false);
    });
  });

  it("keeps an actorRole already set", async () => {
    await inRequest(async () => {
      await findActiveMembership(clubsAdmin.id, CLUB);
      expect(withClubsAdministratorMarker(row(CLUB, clubsAdmin.id, { actorRole: "SOMETHING", n: 1 })).metadata).toEqual({ actorRole: "SOMETHING", n: 1 });
    });
  });

  it("makes no database query", () => {
    const source = readFileSync(join(process.cwd(), "modules/audit/clubs-administrator-marker.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(source).not.toMatch(/getPrisma|await |client\.|async /);
    // The extension in lib/prisma.ts: no await and no call except the marker and `query(...)`.
    const prismaSource = readFileSync(join(process.cwd(), "lib/prisma.ts"), "utf8");
    const block = prismaSource.slice(prismaSource.indexOf("auditLog: {"), prismaSource.indexOf("}) as unknown as PrismaClient"));
    expect(block).toContain("withClubsAdministratorMarker");
    expect(block).not.toMatch(/\bawait\b|\bimport\(|\bbase\b|\btx\b/);
    const calls = [...block.matchAll(/([A-Za-z_$][\w$.]*)\(/g)].map((match) => match[1]);
    expect(calls.filter((name) => !["create", "createMany", "query", "withClubsAdministratorMarker", "Array.isArray", "args.data.map"].includes(name))).toEqual([]);
  });
});

describe("the event list (#1643)", () => {
  it("includes every club event for an active Clubs Administrator and not for anyone else", async () => {
    const { eventAccessFilter } = await import("@/modules/events/repository");
    expect(await eventAccessFilter(clubsAdmin.id, false, "include")).toEqual({
      OR: [{ memberships: { some: { userId: clubsAdmin.id, status: "ACTIVE" } } }, { audience: "CLUB" }],
    });
    expect(await eventAccessFilter(clubsAdmin.id, false, "exclude")).toEqual({ memberships: { some: { userId: clubsAdmin.id, status: "ACTIVE" } } });
    expect(await eventAccessFilter("user-plain", false, "include")).toEqual({ memberships: { some: { userId: "user-plain", status: "ACTIVE" } } });
    expect(await eventAccessFilter("user-system", true, "include")).toEqual({});
    db.grants[0].revokedAt = new Date();
    expect(await eventAccessFilter(clubsAdmin.id, false, "include")).toEqual({ memberships: { some: { userId: clubsAdmin.id, status: "ACTIVE" } } });
  });
});
