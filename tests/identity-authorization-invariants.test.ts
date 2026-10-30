import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Identity slice 4 (#128): the authorization invariants. Centralizing identity
 * (`Person`, households, account links, merges) must not let anyone see more
 * than before. Each invariant is proved against the real code path with a
 * faked database, and each test names what would make it fail. Synthetic data
 * only. Invariant 6 (retry and concurrency) lives with slice 3's tests in
 * tests/person-soft-merge.test.ts and scripts/verify-person-soft-merge.ts.
 * Invariant 1's pure authorization half is in tests/account-links-invariant.test.ts.
 */

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  writeAuditLog: vi.fn(),
  getCurrentSession: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => null }));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));

import { requirePermission, type MembershipLookup, type Session } from "@/modules/access/authorization";
import { eventPermissions } from "@/modules/access/permissions";
import { requireSystemAdministrator } from "@/modules/people/duplicate-match-access";
import { requirePersonMergePermission } from "@/modules/people/person-merge-access";
import { personBelongsToEvent } from "@/modules/people/event-scope";
import { currentHouseholdMembers, personHouseholdsAsOf } from "@/modules/people/household-repository";
import { authorizeAttendeeRegistration, matchingRegistrationIdsForVerifiedEmail } from "@/modules/attendee-accounts/registrations-repository";
import { getMergedPersonView } from "@/modules/people/person-merge-repository";

const ROOT = process.cwd();
const source = (path: string) => readFileSync(join(ROOT, path), "utf8");

function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const relative = join(dir, name);
    if (statSync(join(ROOT, relative)).isDirectory()) return name === "node_modules" || name === ".next" ? [] : sourceFiles(relative);
    return /\.(ts|tsx)$/.test(name) ? [relative] : [];
  });
}

/** A database that fails the test if code reads any of the named models. */
function forbidModels(base: Record<string, unknown>, forbidden: string[]) {
  return new Proxy(base, {
    get(target, property) {
      if (typeof property === "string" && forbidden.includes(property)) {
        throw new Error(`Forbidden read of ${property}`);
      }
      return target[property as string];
    },
  });
}

const staffWithEveryEventPermission: Session = {
  user: { id: "usr_full", email: "full@example.test", displayName: "Full Staff", globalRole: null },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getPrisma.mockReset();
});

describe("invariant 1 and 5: staff authority comes only from event membership or the global role, never from identity", () => {
  it("holding every event permission on every event is still not an identity permission", async () => {
    const lookup: MembershipLookup = async (userId, eventId) => ({
      eventId, userId, role: "EVENT_ADMIN" as never, status: "ACTIVE", permissions: [...eventPermissions],
    });
    for (const permission of eventPermissions) {
      await expect(requirePermission(staffWithEveryEventPermission, "evt_a", permission, lookup)).resolves.toBeTruthy();
    }
    mocks.getCurrentSession.mockResolvedValue(staffWithEveryEventPermission);
    // Neither identity gate consults memberships at all: only `globalRole` counts.
    await expect(requireSystemAdministrator()).rejects.toMatchObject({ status: 403, code: "PERMISSION_DENIED" });
    await expect(requirePersonMergePermission("EDIT")).rejects.toMatchObject({ status: 403, code: "PERMISSION_DENIED" });
    await expect(requirePersonMergePermission("READ")).rejects.toMatchObject({ status: 403, code: "PERMISSION_DENIED" });
    expect(mocks.getPrisma).not.toHaveBeenCalled();
  });

  it("an attendee-only visitor (no staff session) is refused as unauthenticated, not as a person", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    await expect(requireSystemAdministrator()).rejects.toMatchObject({ status: 401, code: "AUTHENTICATION_REQUIRED" });
    await expect(requirePersonMergePermission("READ")).rejects.toMatchObject({ status: 401 });
  });

  it("only the global system-administrator role passes the identity gates", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "usr_admin", email: "admin@example.test", displayName: "Admin", globalRole: "SYSTEM_ADMIN" } });
    await expect(requireSystemAdministrator()).resolves.toMatchObject({ id: "usr_admin" });
    await expect(requirePersonMergePermission("EDIT")).resolves.toMatchObject({ id: "usr_admin" });
    await expect(requirePersonMergePermission("READ")).resolves.toMatchObject({ id: "usr_admin" });
  });

  it("keeps the staff authorization modules free of Person, household, link, merge and attendee-account code", () => {
    // Fails if someone wires a person link, household or attendee session into a staff permission check.
    for (const path of ["modules/access/authorization.ts", "modules/access/permissions.ts"]) {
      const text = source(path);
      expect(text, path).not.toMatch(/PersonLink|account-links|modules\/people|modules\/attendee-accounts|householdMember|personMerge/i);
    }
  });

  it("keeps the attendee registration authorization free of Person links, households and merges", () => {
    // Fails if an attendee's access to a registration is ever derived from a link, household or merge.
    const text = source("modules/attendee-accounts/registrations-repository.ts");
    expect(text).not.toMatch(/PersonLink|account-links|householdMember|personMerge|modules\/people/i);
  });

  it("no identity module imports staff authorization except the two named gates", () => {
    const allowed = new Set(["modules/people/duplicate-match-access.ts", "modules/people/person-merge-access.ts", "modules/people/duplicate-match-api-errors.ts"]);
    const offenders = sourceFiles("modules/people").filter((file) => !allowed.has(file) && /from ["']@\/modules\/access\/(authorization|current-session)/.test(source(file)));
    expect(offenders).toEqual([]);
  });
});

describe("the identity routes refuse staff without identity permission and return no data", () => {
  const post = (body: unknown = {}) => new Request("https://events.imsda.test/x", {
    method: "POST", headers: { "content-type": "application/json", origin: "https://events.imsda.test" }, body: JSON.stringify(body),
  });
  const get = () => new Request("https://events.imsda.test/x");

  async function handlers() {
    return {
      matchesGet: (await import("@/app/api/people/matches/route")).GET,
      matchesPost: (await import("@/app/api/people/matches/route")).POST,
      mergesGet: (await import("@/app/api/people/merges/route")).GET,
      merge: (await import("@/app/api/people/matches/[candidateId]/merge/route")).POST,
      dismiss: (await import("@/app/api/people/matches/[candidateId]/dismiss/route")).POST,
      defer: (await import("@/app/api/people/matches/[candidateId]/defer/route")).POST,
      unmerge: (await import("@/app/api/people/merges/[mergeId]/unmerge/route")).POST,
    };
  }

  it("answers 403 with no body data, no database read and no audit entry for event staff", async () => {
    mocks.getCurrentSession.mockResolvedValue(staffWithEveryEventPermission);
    const h = await handlers();
    const candidate = { params: Promise.resolve({ candidateId: "c1" }) };
    const mergeCtx = { params: Promise.resolve({ mergeId: "m1" }) };
    const responses = await Promise.all([
      h.matchesGet(get()),
      h.matchesPost(post()),
      h.mergesGet(get()),
      h.merge(post({ primaryPersonId: "a", reason: "same person" }), candidate),
      h.dismiss(post({ reason: "different people" }), candidate),
      h.defer(post(), candidate),
      h.unmerge(post({ reason: "mistake made" }), mergeCtx),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(Object.keys(body).sort()).toEqual(["error", "message"]);
      expect(body.error).toBe("PERMISSION_DENIED");
    }
    expect(mocks.getPrisma).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("a global people search is not something event staff can reach: no route lists people across events for them", async () => {
    // The only cross-event identity lists are the queue and the merges list, both refused above.
    // Guard the surface: a new route under app/api/people must be added to this list on purpose.
    const routes = sourceFiles("app/api/people").map((file) => file.replace(/^app\/api\/people\//, "")).sort();
    expect(routes).toEqual([
      "matches/[candidateId]/defer/route.ts",
      "matches/[candidateId]/dismiss/route.ts",
      "matches/[candidateId]/merge/route.ts",
      "matches/route.ts",
      "merges/[mergeId]/unmerge/route.ts",
      "merges/route.ts",
    ]);
  });
});

/** The fake the attendee-registration reads run against: no household, link or merge model may be touched. */
function attendeeFake(registrations: Array<{ id: string; eventId: string; contactEmail: string }>) {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const base = {
    $queryRaw: vi.fn(async (query: { sql: string; values: unknown[] }) => {
      queries.push({ sql: query.sql, values: query.values });
      return registrations.filter((row) => query.values.includes(row.contactEmail)).map((row) => ({ id: row.id }));
    }),
    registration: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => registrations.find((row) => row.id === where.id) ?? null),
    },
  };
  const prisma = forbidModels(base, [
    "householdMember", "household", "personMerge", "attendeeAccountPersonLink", "userPersonLink", "person", "personMatchCandidate",
  ]);
  return { prisma, queries };
}

describe("invariant 3: an attendee account reaching a person through a household cannot read records at another event", () => {
  const registrations = [
    // Event A: the attendee's own registration, under her verified address.
    { id: "reg_a_self", eventId: "evt_a", contactEmail: "alicia@example.test" },
    // Event B: a household mate's registration, under his own address.
    { id: "reg_b_mate", eventId: "evt_b", contactEmail: "mateo@example.test" },
  ];

  it("claims only the registrations under the verified address, never the household's", async () => {
    const { prisma, queries } = attendeeFake(registrations);
    mocks.getPrisma.mockReturnValue(prisma);
    // Alicia and Mateo share a household (modelled by the forbidden-model proxy: it would throw if read).
    expect(await matchingRegistrationIdsForVerifiedEmail("alicia@example.test")).toEqual(["reg_a_self"]);
    expect(await authorizeAttendeeRegistration("alicia@example.test", "reg_a_self")).toEqual({ registrationId: "reg_a_self", eventId: "evt_a" });
    expect(await authorizeAttendeeRegistration("alicia@example.test", "reg_b_mate")).toBeNull();
    // The query itself matches on the contact address and mentions no household, link, merge or person-link table.
    for (const query of queries) {
      expect(query.sql).not.toMatch(/Household|PersonLink|PersonMerge|PersonMatch/i);
      expect(query.values).toEqual(["alicia@example.test"]);
    }
  });

  it("household reads return membership only: they never expose registrations", async () => {
    const members = [{
      id: "hm1", householdId: "h1", personId: "per_alicia", effectiveFrom: new Date("2020-01-01T00:00:00Z"), effectiveTo: null,
      role: null, canManage: true, createdAt: new Date("2020-01-01T00:00:00Z"), updatedAt: new Date("2020-01-01T00:00:00Z"),
    }];
    const prisma = forbidModels({ householdMember: { findMany: vi.fn(async () => members) } }, ["registration", "registrationAttendee", "payment", "person"]);
    mocks.getPrisma.mockReturnValue(prisma);
    const current = await currentHouseholdMembers("h1");
    const households = await personHouseholdsAsOf("per_alicia", new Date("2026-01-01T00:00:00Z"));
    for (const row of [...current, ...households]) {
      expect(Object.keys(row).join(" ")).not.toMatch(/registration|payment|confirmation/i);
    }
  });

  it("the household repository never queries registrations (so a household cannot be a path to them)", () => {
    // Fails if household membership is joined to a registration read.
    expect(source("modules/people/household-repository.ts")).not.toMatch(/\.(registration|registrationAttendee|payment)\b|include:\s*\{[^}]*registration/i);
  });
});

describe("invariants 2 and 4: a merge or shared identity does not merge two events' authorization", () => {
  // Person "primary" is staff-known at event A; "secondary" is the same human, registered only at event B. Merged.
  const registrations = [
    { id: "reg_a", eventId: "evt_a", accountHolderPersonId: "per_primary" },
    { id: "reg_b", eventId: "evt_b", accountHolderPersonId: "per_secondary" },
  ];
  const attendees = [
    { id: "att_a", eventId: "evt_a", personId: "per_primary" },
    { id: "att_b", eventId: "evt_b", personId: "per_secondary" },
  ];
  const mergeLink = { id: "m1", primaryPersonId: "per_primary", secondaryPersonId: "per_secondary", state: "ACTIVE" };

  function eventFake() {
    return {
      registration: {
        findFirst: vi.fn(async ({ where }: { where: { eventId: string; accountHolderPersonId: string } }) =>
          registrations.find((row) => row.eventId === where.eventId && row.accountHolderPersonId === where.accountHolderPersonId) ?? null),
      },
      registrationAttendee: {
        findFirst: vi.fn(async ({ where }: { where: { eventId: string; personId: string } }) =>
          attendees.find((row) => row.eventId === where.eventId && row.personId === where.personId) ?? null),
      },
      // Present so a merge-aware implementation would have something to read; the check must not touch it.
      personMerge: new Proxy({}, { get() { throw new Error("event scope must not read merges"); } }),
    };
  }

  it("event-scoped person access is by footprint in that event, and a merge does not extend it", async () => {
    mocks.getPrisma.mockReturnValue(eventFake());
    expect(mergeLink.state).toBe("ACTIVE");
    expect(await personBelongsToEvent("evt_a", "per_primary")).toBe(true);
    // The merged person (primary) has no footprint at B of their own, and event B staff gain none through the merge.
    expect(await personBelongsToEvent("evt_b", "per_primary")).toBe(false);
    // And event A staff cannot reach the secondary's event-B-only footprint by asking about the secondary at A.
    expect(await personBelongsToEvent("evt_a", "per_secondary")).toBe(false);
    expect(await personBelongsToEvent("evt_b", "per_secondary")).toBe(true);
  });

  it("event A staff have no event B access because of a merge", async () => {
    const lookup: MembershipLookup = async (userId, eventId) =>
      userId === "usr_a" && eventId === "evt_a" ? { eventId, userId, role: "EVENT_ADMIN" as never, status: "ACTIVE", permissions: [...eventPermissions] } : null;
    const eventAStaff: Session = { user: { id: "usr_a", email: "a@example.test", displayName: "A Staff", globalRole: null } };
    await expect(requirePermission(eventAStaff, "evt_a", "VIEW_EVENT", lookup)).resolves.toBeTruthy();
    await expect(requirePermission(eventAStaff, "evt_b", "VIEW_EVENT", lookup)).rejects.toMatchObject({ status: 403, code: "EVENT_ACCESS_DENIED" });
  });

  it("the primary's account does not claim the secondary's registration: attendee access stays on the verified address", async () => {
    const registrationsByEmail = [
      { id: "reg_a", eventId: "evt_a", contactEmail: "primary@example.test" },
      { id: "reg_b", eventId: "evt_b", contactEmail: "secondary@example.test" },
    ];
    const { prisma, queries } = attendeeFake(registrationsByEmail);
    mocks.getPrisma.mockReturnValue(prisma);
    expect(await matchingRegistrationIdsForVerifiedEmail("primary@example.test")).toEqual(["reg_a"]);
    expect(await authorizeAttendeeRegistration("primary@example.test", "reg_b")).toBeNull();
    for (const query of queries) expect(query.sql).not.toMatch(/PersonMerge|Household|PersonLink/i);
  });

  it("the only code that aggregates a merged person's registrations across events is gated and audited", async () => {
    // Fails if getMergedPersonView gains an ungated caller, or stops writing the cross-event audit entry.
    const callers = [...sourceFiles("app"), ...sourceFiles("modules"), ...sourceFiles("components")]
      .filter((file) => file !== "modules/people/person-merge-repository.ts" && /getMergedPersonView/.test(source(file)));
    expect(callers).toEqual([]);

    const loaded = {
      personMerge: {
        findMany: vi.fn(async ({ where }: { where: { secondaryPersonId?: { in: string[] }; primaryPersonId?: { in: string[] } } }) => {
          if (where.secondaryPersonId) return where.secondaryPersonId.in.includes("per_secondary") ? [{ secondaryPersonId: "per_secondary", primaryPersonId: "per_primary" }] : [];
          if (where.primaryPersonId) return where.primaryPersonId.in.includes("per_primary") ? [{ id: "m1", primaryPersonId: "per_primary", secondaryPersonId: "per_secondary" }] : [];
          return [];
        }),
      },
      registration: { findMany: vi.fn(async () => [{ id: "reg_a", eventId: "evt_a", confirmationCode: "A-1", status: "CONFIRMED", accountHolderPersonId: "per_primary" }]) },
      registrationAttendee: { findMany: vi.fn(async () => [{ personId: "per_secondary", registration: { id: "reg_b", eventId: "evt_b", confirmationCode: "B-1", status: "CONFIRMED" } }]) },
    };
    mocks.getPrisma.mockReturnValue(loaded);
    const view = await getMergedPersonView("per_secondary", "usr_admin");
    expect(view.registrations.map((row) => row.eventId).sort()).toEqual(["evt_a", "evt_b"]);
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
    expect(mocks.writeAuditLog.mock.calls[0][0]).toMatchObject({
      action: "PERSON_CROSS_EVENT_READ", actorUserId: "usr_admin",
      metadata: { surface: "MERGED_PERSON_VIEW", eventIds: ["evt_a", "evt_b"] },
    });
  });
});
