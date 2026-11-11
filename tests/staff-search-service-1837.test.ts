import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Staff record search (#1837): what each role gets back from `searchStaffRecords`. The mocked database applies the
 * `where` the service sends to synthetic rows, so a record outside a role's access is only absent if the query excluded
 * it. Synthetic names only.
 */

type Row = Record<string, unknown>;

/** A small evaluator for the Prisma filter shapes the service uses. */
function matches(where: Row | undefined, row: Row): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, condition]) => {
    if (key === "AND") return (condition as Row[]).every((part) => matches(part, row));
    if (key === "OR") return (condition as Row[]).some((part) => matches(part, row));
    return field(condition, row[key]);
  });
}

function field(condition: unknown, value: unknown): boolean {
  if (condition === null) return value === null || value === undefined;
  if (condition instanceof Date || typeof condition !== "object") return value === condition;
  const c = condition as Row;
  if ("contains" in c) return typeof value === "string" && value.toLowerCase().includes(String(c.contains).toLowerCase());
  if ("some" in c) return ((value as Row[]) ?? []).some((item) => matches(c.some as Row, item));
  if ("is" in c) return Boolean(value) && matches(c.is as Row, value as Row);
  if ("gte" in c || "lt" in c || "lte" in c || "gt" in c) {
    const time = value instanceof Date ? value.getTime() : Number.NaN;
    return (!("gte" in c) || time >= (c.gte as Date).getTime()) && (!("lt" in c) || time < (c.lt as Date).getTime())
      && (!("lte" in c) || time <= (c.lte as Date).getTime()) && (!("gt" in c) || time > (c.gt as Date).getTime());
  }
  return matches(c, (value ?? {}) as Row);
}

const now = new Date("2027-02-01T12:00:00.000Z");
const long = (iso: string) => new Date(iso);

const org = (id: string, type: "CLUB" | "CHURCH", name: string, extra: Row = {}): Row => ({
  id, type, name, city: "Synthville", isActive: true, parentOrganization: null, directorGrants: [], ...extra,
});
const sponsor = { name: "Synthville Church" };
const director = (displayName: string): Row => ({
  role: "DIRECTOR", revokedAt: null, effectiveFrom: long("2026-01-01T00:00:00Z"), effectiveTo: null,
  attendeeAccount: { displayName, firstName: displayName.split(" ")[0], lastName: displayName.split(" ")[1] },
});
const event = (id: string, name: string, extra: Row = {}): Row => ({
  id, name, startsAt: long("2027-07-14T15:00:00Z"), endsAt: long("2027-07-17T15:00:00Z"), timezone: "America/Chicago",
  audience: "GENERAL", archivedAt: null, isBillingContainer: false, memberships: [], ...extra,
});
const member = (userId: string, role: string, extra: Row = {}) => ({ userId, role, status: "ACTIVE", permissions: [], ...extra });

const database = vi.hoisted(() => ({ organizations: [] as Row[], events: [] as Row[], clubsAdministrators: new Set<string>(), organizationCalls: [] as Row[], eventCalls: [] as Row[] }));

const prisma = {
  organization: {
    findMany: vi.fn(async (args: { where: Row; take: number; select: Row }) => {
      database.organizationCalls.push(args);
      return database.organizations.filter((row) => matches(args.where, row)).slice(0, args.take);
    }),
  },
  event: {
    findMany: vi.fn(async (args: { where: Row; take: number; select: Row; orderBy: unknown }) => {
      database.eventCalls.push(args);
      const userId = JSON.stringify(args.where).match(/"userId":"([^"]+)"/)?.[1] ?? "";
      return database.events
        .filter((row) => matches(args.where, row))
        .slice(0, args.take)
        .map((row) => ({ ...row, memberships: (row.memberships as { userId: string }[]).filter((m) => m.userId === userId) }));
    }),
  },
  clubsAdministratorGrant: {
    findFirst: vi.fn(async (args: { where: { userId: string } }) => (database.clubsAdministrators.has(args.where.userId) ? { id: "grant" } : null)),
  },
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => prisma }));

import { STAFF_SEARCH_GROUP_LIMIT } from "@/modules/staff-search/domain";
import { searchStaffRecords } from "@/modules/staff-search/service";

const sysadmin = { id: "u_sys", globalRole: "SYSTEM_ADMIN" };
const eventAdmin = { id: "u_eventadmin", globalRole: null };
const registrar = { id: "u_registrar", globalRole: null };
const kitchen = { id: "u_kitchen", globalRole: null };
const clubsAdmin = { id: "u_clubsadmin", globalRole: null };
const siteEditor = { id: "u_siteeditor", globalRole: null };

beforeEach(() => {
  vi.clearAllMocks();
  database.organizationCalls.length = 0;
  database.eventCalls.length = 0;
  database.clubsAdministrators = new Set([clubsAdmin.id]);
  database.organizations = [
    org("club_a", "CLUB", "Synth Pathfinders", { parentOrganization: sponsor }),
    org("club_b", "CLUB", "Maple Adventurers", { city: "Other Town", directorGrants: [director("Dana Quill")] }),
    org("church_a", "CHURCH", "Synthville Church"),
    org("church_b", "CHURCH", "Synth Valley Church", { city: "Other Town" }),
  ];
  database.events = [
    event("ev_open", "Synth Camp Meeting 2027", { memberships: [member(eventAdmin.id, "EVENT_ADMIN"), member(registrar.id, "REGISTRATION_MANAGER"), member(kitchen.id, "KITCHEN_STAFF")] }),
    event("ev_other", "Synth Retreat 2027", { memberships: [member("u_someone_else", "EVENT_ADMIN")] }),
    event("ev_club", "Synth Camporee 2027", { audience: "CLUB" }),
    event("ev_old", "Synth Archive 2027", { archivedAt: long("2027-01-01T00:00:00Z"), memberships: [member(eventAdmin.id, "EVENT_ADMIN")] }),
    event("ev_billing", "Synth Billing 2027", { isBillingContainer: true, memberships: [member(eventAdmin.id, "EVENT_ADMIN")] }),
    event("ev_inactive_member", "Synth Former 2027", { memberships: [member(registrar.id, "REGISTRATION_MANAGER", { status: "INACTIVE" })] }),
  ];
});

const ids = (group: { items: { id: string }[] }) => group.items.map((item) => item.id).sort();

describe("the per-group limit", () => {
  it("is pinned at five, reads one more to know there is more, and offers See all only then", async () => {
    expect(STAFF_SEARCH_GROUP_LIMIT).toBe(5);
    database.organizations = Array.from({ length: 9 }, (_, index) => org(`club_${index}`, "CLUB", `Synth Club ${index}`));
    const many = await searchStaffRecords(sysadmin, "synth", now);
    expect(many.clubs.items).toHaveLength(5);
    expect(many.clubs.more).toBe(true);
    expect(many.clubs.seeAllHref).toBe("/admin/organizations?kind=CLUB&q=synth");
    expect(database.organizationCalls[0].take).toBe(6);

    database.organizations = database.organizations.slice(0, 5);
    const exact = await searchStaffRecords(sysadmin, "synth", now);
    expect(exact.clubs.items).toHaveLength(5);
    expect(exact.clubs.more).toBe(false);
    expect(exact.clubs.seeAllHref).toBeNull();
  });
});

describe("what each role finds", () => {
  it("system administrator: clubs, churches and every current event", async () => {
    const result = await searchStaffRecords(sysadmin, "synth", now);
    expect(ids(result.clubs)).toEqual(["club_a"]);
    expect(ids(result.churches)).toEqual(["church_a", "church_b"]);
    // Archived and billing-container events are never listed, even for a system administrator.
    expect(ids(result.events)).toEqual(["ev_club", "ev_inactive_member", "ev_open", "ev_other"]);
    expect(result.events.items.every((item) => item.href.startsWith("/overview?event="))).toBe(true);
    expect(result.clubs.items[0].href).toBe("/admin/organizations/club_a/club");
    expect(result.churches.items.find((item) => item.id === "church_a")?.href).toBe("/admin/organizations?kind=CHURCH&q=Synthville+Church");
  });

  it("event administrator: only their own events, no clubs and no churches (nothing is even read)", async () => {
    const result = await searchStaffRecords(eventAdmin, "synth", now);
    expect(ids(result.events)).toEqual(["ev_open"]);
    expect(result.clubs.items).toEqual([]);
    expect(result.churches.items).toEqual([]);
    expect(prisma.organization.findMany).not.toHaveBeenCalled();
    expect(result.events.items[0].href).toBe("/overview?event=ev_open");
  });

  it("registrar: only their own active events, no clubs and no churches", async () => {
    const result = await searchStaffRecords(registrar, "synth", now);
    expect(ids(result.events)).toEqual(["ev_open"]);
    expect(result.clubs.items).toEqual([]);
    expect(result.churches.items).toEqual([]);
    expect(prisma.organization.findMany).not.toHaveBeenCalled();
  });

  it("kitchen staff: their event opens on Kitchen counts, the page they can use", async () => {
    const result = await searchStaffRecords(kitchen, "camp meeting", now);
    expect(result.events.items.map((item) => item.href)).toEqual(["/more/kitchen-report/counts?event=ev_open"]);
  });

  it("Clubs Administrator: clubs, club-audience events and their own events, no churches", async () => {
    database.events.find((row) => row.id === "ev_other")!.memberships = [member(clubsAdmin.id, "READ_ONLY_STAFF")];
    const result = await searchStaffRecords(clubsAdmin, "synth", now);
    expect(ids(result.clubs)).toEqual(["club_a"]);
    expect(ids(result.events)).toEqual(["ev_club", "ev_other"]);
    expect(result.churches.items).toEqual([]);
    expect(database.organizationCalls).toHaveLength(1);
    expect((database.organizationCalls[0].where as Row).type).toBe("CLUB");
    expect(result.clubs.items[0].href).toBe("/admin/organizations/club_a/club");
    expect(result.events.items.every((item) => item.href.startsWith("/overview?event="))).toBe(true);
  });

  it("site content editor with no event assignment: nothing at all", async () => {
    const result = await searchStaffRecords(siteEditor, "synth", now);
    expect(result.clubs.items).toEqual([]);
    expect(result.events.items).toEqual([]);
    expect(result.churches.items).toEqual([]);
    expect(prisma.organization.findMany).not.toHaveBeenCalled();
  });
});

describe("matching", () => {
  it("finds a club by its sponsoring church, its city and its director's name, but never returns the director", async () => {
    const byChurch = await searchStaffRecords(sysadmin, "synthville church pathfinders", now);
    expect(ids(byChurch.clubs)).toEqual(["club_a"]);
    const byCity = await searchStaffRecords(sysadmin, "other town", now);
    expect(ids(byCity.clubs)).toEqual(["club_b"]);
    const byDirector = await searchStaffRecords(sysadmin, "dana", now);
    expect(ids(byDirector.clubs)).toEqual(["club_b"]);
    expect(JSON.stringify(byDirector)).not.toMatch(/quill/i);
    const selected = database.organizationCalls.find((call) => (call.where as Row).type === "CLUB")!.select as Row;
    expect(Object.keys(selected).sort()).toEqual(["city", "id", "isActive", "name", "parentOrganization"]);
  });

  it("ignores a revoked or ended director grant", async () => {
    (database.organizations[1].directorGrants as Row[])[0].revokedAt = long("2026-06-01T00:00:00Z");
    expect(ids((await searchStaffRecords(sysadmin, "dana", now)).clubs)).toEqual([]);
  });

  it("finds an event by name and by the year it starts in", async () => {
    expect(ids((await searchStaffRecords(sysadmin, "retreat", now)).events)).toEqual(["ev_other"]);
    expect(ids((await searchStaffRecords(sysadmin, "2027", now)).events)).toHaveLength(4);
    expect(ids((await searchStaffRecords(sysadmin, "2026", now)).events)).toEqual([]);
  });

  it("returns only the fields shown for an event", async () => {
    const result = await searchStaffRecords(sysadmin, "retreat", now);
    expect(Object.keys(result.events.items[0]).sort()).toEqual(["endsAt", "href", "id", "name", "startsAt", "timezone"]);
    expect(Object.keys(database.eventCalls[0].select as Row).sort()).toEqual(["audience", "endsAt", "id", "memberships", "name", "startsAt", "timezone"]);
  });

  it("sends no query for a blank or symbol-only search and caps a long one", async () => {
    expect((await searchStaffRecords(sysadmin, "   ", now)).clubs.items).toEqual([]);
    expect((await searchStaffRecords(sysadmin, "***", now)).events.items).toEqual([]);
    expect(prisma.event.findMany).not.toHaveBeenCalled();
    const result = await searchStaffRecords(sysadmin, `synth ${"x".repeat(500)}`, now);
    expect(result.query.length).toBeLessThanOrEqual(80);
  });
});
