import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  findActiveMembership: vi.fn(),
  writeAuditLog: vi.fn(),
  eventFindFirst: vi.fn(),
  moduleFindUnique: vi.fn(),
  settingFindUnique: vi.fn(),
  settingUpsert: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => null }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: mocks.findActiveMembership }));
vi.mock("@/modules/organizations/area-coordinators", () => ({ currentAreaCoordinator: vi.fn(), isAreaCoordinator: vi.fn() }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/lib/prisma", () => {
  const client = {
    event: { findFirst: mocks.eventFindFirst },
    eventModule: { findUnique: mocks.moduleFindUnique },
    baptismFollowUpSetting: { findUnique: mocks.settingFindUnique, upsert: mocks.settingUpsert },
    $transaction: async (run: (tx: unknown) => unknown) => run(client),
  };
  return { getPrisma: () => client };
});

import type { MembershipLookup } from "@/modules/access/authorization";
import { PUT } from "@/app/api/events/[eventId]/baptism-follow-up/route";
import { BaptismFollowUpError, requireBaptismFollowUpStaff, saveBaptismLeadEmails } from "@/modules/baptism-follow-up/settings";
import { defaultModuleKeys, creationModuleKeys, eventModuleDefinition, scopedToggleModuleKeys } from "@/modules/event-modules/catalog";

const lookup = (role: string | null) => (async () => (role ? { eventId: "event-1", userId: "u", role, status: "ACTIVE" as const, permissions: [] } : null)) as unknown as MembershipLookup;
const session = (globalRole: "SYSTEM_ADMIN" | null = null) => ({ user: { id: "u", email: "u@example.org", displayName: "U", globalRole } });
const put = (body: unknown) => new Request("https://events.imsda.test/api/events/event-1/baptism-follow-up", { method: "PUT", headers: { origin: "https://events.imsda.test", "content-type": "application/json" }, body: JSON.stringify(body) });
const ctx = { params: Promise.resolve({ eventId: "event-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.eventFindFirst.mockResolvedValue({ id: "event-1", name: "Sample Fall Camporee" });
  mocks.moduleFindUnique.mockResolvedValue({ id: "m1" });
  mocks.settingFindUnique.mockResolvedValue(null);
  mocks.settingUpsert.mockResolvedValue({});
});

describe("Baptism follow-up is an optional, off-by-default event module (#1680)", () => {
  it("applies to club events, is never in a creation default, and is a scoped switch (staff and an Area Coordinator)", () => {
    expect(eventModuleDefinition("baptism-follow-up")).toMatchObject({ title: "Baptism follow-up", appliesTo: "club-audience", offByDefault: true, alwaysOn: false, routes: ["/more/baptism-follow-up", "/account/area-clubs/events"] });
    expect(defaultModuleKeys("CLUB")).not.toContain("baptism-follow-up");
    expect(defaultModuleKeys("GENERAL")).not.toContain("baptism-follow-up");
    expect(creationModuleKeys("CLUB")).not.toContain("baptism-follow-up");
    expect(creationModuleKeys("CLUB", [])).not.toContain("baptism-follow-up");
    expect(scopedToggleModuleKeys).toContain("baptism-follow-up");
  });

  it("the first migration writes no module row", () => {
    const migration = readFileSync("prisma/migrations/20270141100000_baptism_follow_up/migration.sql", "utf8").replace(/^--.*$/gm, "");
    expect(migration).not.toContain('"EventModule"');
    expect(migration).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|DROP)\b/im);
  });
});

describe("who may set the event lead addresses (#1680)", () => {
  it("lets a system administrator and an Event Admin (the Clubs Administrator is one on club events)", async () => {
    await expect(requireBaptismFollowUpStaff(session("SYSTEM_ADMIN"), "event-1", lookup(null))).resolves.toEqual({ kind: "staff", userId: "u" });
    await expect(requireBaptismFollowUpStaff(session(), "event-1", lookup("EVENT_ADMIN"))).resolves.toEqual({ kind: "staff", userId: "u" });
  });

  it("refuses every other role and anyone not on the event", async () => {
    for (const role of ["REGISTRATION_MANAGER", "FINANCE_MANAGER", "COMMUNICATIONS_MANAGER", "CHECK_IN_STAFF", "READ_ONLY_STAFF"]) {
      await expect(requireBaptismFollowUpStaff(session(), "event-1", lookup(role))).rejects.toMatchObject({ status: 403 });
    }
    await expect(requireBaptismFollowUpStaff(session(), "event-1", lookup(null))).rejects.toMatchObject({ status: 403 });
  });

  it("the route answers 401 signed out and 403 for a Registration Manager, and saves nothing", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    expect((await PUT(put({ leadEmails: "lead@example.test" }), ctx)).status).toBe(401);
    mocks.getCurrentSession.mockResolvedValue(session());
    mocks.findActiveMembership.mockImplementation(lookup("REGISTRATION_MANAGER"));
    expect((await PUT(put({ leadEmails: "lead@example.test" }), ctx)).status).toBe(403);
    expect(mocks.settingUpsert).not.toHaveBeenCalled();
  });

  it("the route saves for an Event Admin and answers with the normalized addresses", async () => {
    mocks.getCurrentSession.mockResolvedValue(session());
    mocks.findActiveMembership.mockImplementation(lookup("EVENT_ADMIN"));
    const response = await PUT(put({ leadEmails: "Lead@Example.test\nsecond@example.test" }), ctx);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ leadEmails: ["lead@example.test", "second@example.test"] });
    expect(mocks.settingUpsert).toHaveBeenCalledWith(expect.objectContaining({ create: { eventId: "event-1", leadEmails: ["lead@example.test", "second@example.test"] } }));
  });

  it("the route refuses a bad address with 422 and more than three", async () => {
    mocks.getCurrentSession.mockResolvedValue(session("SYSTEM_ADMIN"));
    expect((await PUT(put({ leadEmails: "nope" }), ctx)).status).toBe(422);
    expect((await PUT(put({ leadEmails: "a@example.test, b@example.test, c@example.test, d@example.test" }), ctx)).status).toBe(422);
    expect((await PUT(put({ somethingElse: true }), ctx)).status).toBe(400);
    expect(mocks.settingUpsert).not.toHaveBeenCalled();
  });
});

describe("saving the event lead addresses (#1680)", () => {
  it("is refused while the module is off, or for an event that is not a club event", async () => {
    mocks.moduleFindUnique.mockResolvedValue(null);
    await expect(saveBaptismLeadEmails({ kind: "staff", userId: "u" }, "event-1", "lead@example.test")).rejects.toMatchObject({ code: "MODULE_OFF" });
    mocks.moduleFindUnique.mockResolvedValue({ id: "m1" });
    mocks.eventFindFirst.mockResolvedValue(null);
    await expect(saveBaptismLeadEmails({ kind: "staff", userId: "u" }, "event-1", "lead@example.test")).rejects.toBeInstanceOf(BaptismFollowUpError);
  });

  it("audits a change with counts and the addresses added and removed, and a repeat changes and audits nothing", async () => {
    await saveBaptismLeadEmails({ kind: "staff", userId: "u" }, "event-1", "lead@example.test");
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
    const entry = mocks.writeAuditLog.mock.calls[0]![0] as { metadata: unknown };
    expect(entry.metadata).toEqual({ eventId: "event-1", previousCount: 0, newCount: 1, addedEmails: ["lead@example.test"], removedEmails: [] });
    mocks.writeAuditLog.mockClear();
    mocks.settingUpsert.mockClear();
    mocks.settingFindUnique.mockResolvedValue({ leadEmails: ["lead@example.test"] });
    await saveBaptismLeadEmails({ kind: "staff", userId: "u" }, "event-1", "lead@example.test");
    expect(mocks.settingUpsert).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("clears the lead addresses with an empty list", async () => {
    mocks.settingFindUnique.mockResolvedValue({ leadEmails: ["lead@example.test"] });
    await expect(saveBaptismLeadEmails({ kind: "staff", userId: "u" }, "event-1", "")).resolves.toEqual({ leadEmails: [] });
    expect((mocks.writeAuditLog.mock.calls[0]![0] as { metadata: unknown }).metadata).toMatchObject({ addedEmails: [], removedEmails: ["lead@example.test"] });
    expect(mocks.settingUpsert).toHaveBeenCalledWith(expect.objectContaining({ update: { leadEmails: [] } }));
  });
});

describe("the pastor's address stays on the server (#1680)", () => {
  it("is read only by the notice, never by the page", () => {
    const notice = readFileSync("modules/baptism-follow-up/notice.ts", "utf8");
    const settings = readFileSync("modules/baptism-follow-up/settings.ts", "utf8");
    expect(notice).toContain('import "server-only"');
    expect(notice).toContain("select: { email: true }");
    // The page applies the send path's own validity test and returns only a yes or no, never the address.
    expect(settings).toContain("usablePastorEmail(pastor.email)");
    expect(notice).toContain("usablePastorEmail(pastor?.email)");
    expect(settings).not.toMatch(/pastorEmail|email: pastor/);
    for (const file of ["components/baptism-follow-up-list.tsx", "components/baptism-follow-up-panel.tsx", "app/(workspace)/more/baptism-follow-up/page.tsx"]) {
      expect(readFileSync(file, "utf8")).not.toMatch(/pastorEmail|organizationContact/);
    }
  });
});
