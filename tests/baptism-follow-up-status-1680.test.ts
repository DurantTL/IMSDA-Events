import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  findActiveMembership: vi.fn(),
  writeAuditLog: vi.fn(),
  eventFindFirst: vi.fn(),
  moduleFindUnique: vi.fn(),
  moduleCreateMany: vi.fn(),
  moduleDeleteMany: vi.fn(),
  rowFindFirst: vi.fn(),
  rowUpdate: vi.fn(),
  settingFindUnique: vi.fn(),
  settingUpsert: vi.fn(),
  currentAreaCoordinator: vi.fn(),
  isAreaCoordinator: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => null }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: mocks.findActiveMembership }));
vi.mock("@/modules/organizations/area-coordinators", () => ({ currentAreaCoordinator: mocks.currentAreaCoordinator, isAreaCoordinator: mocks.isAreaCoordinator }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/lib/prisma", () => {
  const client = {
    event: { findFirst: mocks.eventFindFirst },
    eventModule: { findUnique: mocks.moduleFindUnique, createMany: mocks.moduleCreateMany, deleteMany: mocks.moduleDeleteMany },
    baptismFollowUp: { findFirst: mocks.rowFindFirst, update: mocks.rowUpdate },
    baptismFollowUpSetting: { findUnique: mocks.settingFindUnique, upsert: mocks.settingUpsert },
    $transaction: async (run: (tx: unknown) => unknown) => run(client),
  };
  return { getPrisma: () => client };
});

import type { MembershipLookup } from "@/modules/access/authorization";
import { PUT as areaPutLeads } from "@/app/api/attendee/area-clubs/events/[eventId]/baptism-follow-up/route";
import { PATCH as areaPatch } from "@/app/api/attendee/area-clubs/events/[eventId]/baptism-follow-up/[followUpId]/route";
import { PUT as areaPutSwitch } from "@/app/api/attendee/area-clubs/events/[eventId]/baptism-follow-up/settings/route";
import { PATCH as staffPatch } from "@/app/api/events/[eventId]/baptism-follow-up/[followUpId]/route";
import { PUT as staffPutSwitch } from "@/app/api/events/[eventId]/baptism-follow-up/settings/route";
import { BAPTISM_NOTE_MAX_LENGTH, followUpInputSchema, parseFollowUpNote } from "@/modules/baptism-follow-up/domain";
import { recordBaptismListViewed, updateBaptismFollowUp } from "@/modules/baptism-follow-up/follow-up";

const lookup = (role: string | null) => (async () => (role ? { eventId: "event-1", userId: "u", role, status: "ACTIVE" as const, permissions: [] } : null)) as unknown as MembershipLookup;
const session = (globalRole: "SYSTEM_ADMIN" | null = null) => ({ user: { id: "u", email: "u@example.org", displayName: "U", globalRole } });
const request = (method: string, body: unknown) => new Request("https://events.imsda.test/api/x", { method, headers: { origin: "https://events.imsda.test", "content-type": "application/json" }, body: JSON.stringify(body) });
const ctx = { params: Promise.resolve({ eventId: "event-1", followUpId: "row-1" }) };
const staff = { kind: "staff" as const, userId: "u" };
const coordinator = { kind: "area-coordinator" as const, accountId: "acct-1" };
const NAME = "Ava Sample";
const NOTE = "Called the family on Sunday";

const stored = (over: Record<string, unknown> = {}) => ({ id: "row-1", followedUpAt: null, followUpNote: null, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.eventFindFirst.mockResolvedValue({ id: "event-1", name: "Sample Fall Camporee" });
  mocks.moduleFindUnique.mockResolvedValue({ id: "m1" });
  mocks.moduleCreateMany.mockResolvedValue({ count: 1 });
  mocks.moduleDeleteMany.mockResolvedValue({ count: 1 });
  mocks.rowFindFirst.mockResolvedValue(stored());
  // Like the database: the updated row is the stored row with the changed fields applied.
  mocks.rowUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...(await mocks.rowFindFirst.mock.results.at(-1)?.value), ...data }));
  mocks.settingFindUnique.mockResolvedValue(null);
  mocks.settingUpsert.mockResolvedValue({});
  mocks.isAreaCoordinator.mockResolvedValue(true);
  mocks.currentAreaCoordinator.mockResolvedValue({ id: "acct-1" });
});

describe("the note rule (#1680)", () => {
  it("trims, treats empty as no note and allows exactly 500 characters", () => {
    expect(parseFollowUpNote("  Called the family  ")).toEqual({ ok: true, note: "Called the family" });
    expect(parseFollowUpNote("   ")).toEqual({ ok: true, note: null });
    expect(parseFollowUpNote("a".repeat(BAPTISM_NOTE_MAX_LENGTH)).ok).toBe(true);
    expect(parseFollowUpNote(` ${"a".repeat(BAPTISM_NOTE_MAX_LENGTH)} `).ok).toBe(true);
  });

  it("refuses 501 characters with a friendly message that does not repeat the note", () => {
    const result = parseFollowUpNote("b".repeat(BAPTISM_NOTE_MAX_LENGTH + 1));
    expect(result).toEqual({ ok: false, message: "Keep the note to 500 characters or fewer." });
  });

  it("needs at least one thing to change and refuses unknown fields", () => {
    expect(followUpInputSchema.safeParse({}).success).toBe(false);
    expect(followUpInputSchema.safeParse({ followedUp: true }).success).toBe(true);
    expect(followUpInputSchema.safeParse({ note: "" }).success).toBe(true);
    expect(followUpInputSchema.safeParse({ followedUp: true, name: "x" }).success).toBe(false);
  });
});

describe("marking a name followed up (#1680)", () => {
  it("marks it with the time and the staff user, and audits only the event, the status and whether the note changed", async () => {
    const result = await updateBaptismFollowUp(staff, "event-1", "row-1", { followedUp: true, note: NOTE });
    const data = mocks.rowUpdate.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.followedUpAt).toBeInstanceOf(Date);
    expect(data).toMatchObject({ followedUpByUserId: "u", followedUpByAttendeeAccountId: null, followUpNote: NOTE });
    expect(result.note).toBe(NOTE);
    const entry = mocks.writeAuditLog.mock.calls[0]![0] as { action: string; entityType: string; actorUserId?: string; metadata: unknown };
    expect(entry).toMatchObject({ action: "BAPTISM_FOLLOW_UP_STATUS_CHANGED", entityType: "BaptismFollowUp", actorUserId: "u" });
    expect(entry.metadata).toEqual({ eventId: "event-1", followedUp: true, noteChanged: true });
    expect(JSON.stringify(mocks.writeAuditLog.mock.calls)).not.toContain(NOTE);
    expect(JSON.stringify(mocks.writeAuditLog.mock.calls)).not.toContain(NAME);
  });

  it("records an Area Coordinator's account, never a staff user, and marks the audit as via coordinator", async () => {
    await updateBaptismFollowUp(coordinator, "event-1", "row-1", { followedUp: true });
    expect(mocks.rowUpdate.mock.calls[0]![0].data).toMatchObject({ followedUpByUserId: null, followedUpByAttendeeAccountId: "acct-1" });
    const entry = mocks.writeAuditLog.mock.calls[0]![0] as { actorUserId?: string; metadata: unknown };
    expect(entry.actorUserId).toBeUndefined();
    expect(entry.metadata).toEqual({ actorAttendeeAccountId: "acct-1", viaAreaCoordinator: true, eventId: "event-1", followedUp: true, noteChanged: false });
  });

  it("unmarking clears when and who, keeps the note and leaves the note untouched", async () => {
    mocks.rowFindFirst.mockResolvedValue(stored({ followedUpAt: new Date("2027-01-02T10:00:00Z"), followUpNote: NOTE }));
    await updateBaptismFollowUp(staff, "event-1", "row-1", { followedUp: false });
    const data = mocks.rowUpdate.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data).toEqual({ followedUpAt: null, followedUpByUserId: null, followedUpByAttendeeAccountId: null });
    expect(data).not.toHaveProperty("followUpNote");
    expect((mocks.writeAuditLog.mock.calls[0]![0] as { metadata: unknown }).metadata).toEqual({ eventId: "event-1", followedUp: false, noteChanged: false });
  });

  it("a note-only change keeps the status, and an emptied note clears the note", async () => {
    mocks.rowFindFirst.mockResolvedValue(stored({ followedUpAt: new Date("2027-01-02T10:00:00Z"), followUpNote: NOTE }));
    await updateBaptismFollowUp(staff, "event-1", "row-1", { note: "  " });
    expect(mocks.rowUpdate.mock.calls[0]![0].data).toEqual({ followUpNote: null });
    expect((mocks.writeAuditLog.mock.calls[0]![0] as { metadata: unknown }).metadata).toEqual({ eventId: "event-1", followedUp: true, noteChanged: true });
  });

  it("a repeat that changes nothing writes and audits nothing", async () => {
    mocks.rowFindFirst.mockResolvedValue(stored({ followedUpAt: new Date("2027-01-02T10:00:00Z"), followUpNote: NOTE }));
    await updateBaptismFollowUp(staff, "event-1", "row-1", { followedUp: true, note: `  ${NOTE} ` });
    expect(mocks.rowUpdate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("looks the row up by event and id together, so another event's row is not found", async () => {
    mocks.rowFindFirst.mockResolvedValue(null);
    await expect(updateBaptismFollowUp(staff, "event-1", "row-of-another-event", { followedUp: true })).rejects.toMatchObject({ code: "FOLLOW_UP_NOT_FOUND" });
    expect(mocks.rowFindFirst.mock.calls[0]![0].where).toEqual({ id: "row-of-another-event", eventId: "event-1" });
    expect(mocks.rowUpdate).not.toHaveBeenCalled();
  });

  it("is refused while the module is off, and for a note over 500 characters", async () => {
    await expect(updateBaptismFollowUp(staff, "event-1", "row-1", { note: "c".repeat(501) })).rejects.toMatchObject({ code: "INVALID_NOTE" });
    mocks.moduleFindUnique.mockResolvedValue(null);
    await expect(updateBaptismFollowUp(staff, "event-1", "row-1", { followedUp: true })).rejects.toMatchObject({ code: "MODULE_OFF" });
    expect(mocks.rowUpdate).not.toHaveBeenCalled();
  });
});

describe("who may change a name's status, over the staff routes (#1680)", () => {
  it("a system administrator, an Event Admin and the Clubs Administrator (an Event Admin on club events) may; a Registration Manager may not", async () => {
    mocks.getCurrentSession.mockResolvedValue(session("SYSTEM_ADMIN"));
    mocks.findActiveMembership.mockImplementation(lookup(null));
    expect((await staffPatch(request("PATCH", { followedUp: true }), ctx)).status).toBe(200);
    mocks.getCurrentSession.mockResolvedValue(session());
    mocks.findActiveMembership.mockImplementation(lookup("EVENT_ADMIN"));
    expect((await staffPatch(request("PATCH", { followedUp: true }), ctx)).status).toBe(200);
    mocks.rowUpdate.mockClear();
    mocks.findActiveMembership.mockImplementation(lookup("REGISTRATION_MANAGER"));
    expect((await staffPatch(request("PATCH", { followedUp: true }), ctx)).status).toBe(403);
    expect(mocks.rowUpdate).not.toHaveBeenCalled();
  });

  it("answers 401 signed out, 404 for another event's row, 422 when the module is off, 400 for an empty request, and never caches", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    expect((await staffPatch(request("PATCH", { followedUp: true }), ctx)).status).toBe(401);
    mocks.getCurrentSession.mockResolvedValue(session());
    mocks.findActiveMembership.mockImplementation(lookup("EVENT_ADMIN"));
    mocks.rowFindFirst.mockResolvedValue(null);
    const missing = await staffPatch(request("PATCH", { followedUp: true }), ctx);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("Cache-Control")).toBe("private, no-store");
    expect((await staffPatch(request("PATCH", {}), ctx)).status).toBe(400);
    mocks.moduleFindUnique.mockResolvedValue(null);
    const off = await staffPatch(request("PATCH", { followedUp: true }), ctx);
    expect(off.status).toBe(422);
    expect((await off.json()).error).toBe("MODULE_OFF");
  });

  it("the switch route lets an Event Admin turn it on and off, refuses a Registration Manager, and audits a real change", async () => {
    mocks.getCurrentSession.mockResolvedValue(session());
    mocks.findActiveMembership.mockImplementation(lookup("EVENT_ADMIN"));
    mocks.moduleFindUnique.mockResolvedValue(null);
    expect((await staffPutSwitch(request("PUT", { enabled: true }), ctx)).status).toBe(200);
    expect(mocks.moduleCreateMany).toHaveBeenCalled();
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({ action: "EVENT_MODULE_ENABLED", entityId: "baptism-follow-up" });
    mocks.moduleCreateMany.mockClear();
    mocks.findActiveMembership.mockImplementation(lookup("REGISTRATION_MANAGER"));
    expect((await staffPutSwitch(request("PUT", { enabled: true }), ctx)).status).toBe(403);
    expect(mocks.moduleCreateMany).not.toHaveBeenCalled();
  });
});

describe("the Area Coordinator routes (#1680)", () => {
  it("an active coordinator may switch it, save the lead addresses and change a status", async () => {
    expect((await areaPutSwitch(request("PUT", { enabled: false }), ctx)).status).toBe(200);
    expect(mocks.moduleDeleteMany).toHaveBeenCalled();
    expect((await areaPutLeads(request("PUT", { leadEmails: "lead@example.test" }), ctx)).status).toBe(200);
    const lead = mocks.writeAuditLog.mock.calls.map((call) => call[0] as { action: string; metadata: Record<string, unknown> }).find((entry) => entry.action === "BAPTISM_FOLLOW_UP_LEADS_CHANGED")!;
    expect(lead.metadata).toMatchObject({ actorAttendeeAccountId: "acct-1", viaAreaCoordinator: true });
    expect((await areaPatch(request("PATCH", { followedUp: true }), ctx)).status).toBe(200);
  });

  it("a non-coordinator, and staff acting as one, get a not-found answer and nothing changes", async () => {
    mocks.currentAreaCoordinator.mockResolvedValue(null);
    for (const response of [await areaPutSwitch(request("PUT", { enabled: true }), ctx), await areaPutLeads(request("PUT", { leadEmails: "" }), ctx), await areaPatch(request("PATCH", { followedUp: true }), ctx)]) {
      expect(response.status).toBe(404);
    }
    expect(mocks.moduleCreateMany).not.toHaveBeenCalled();
    expect(mocks.settingUpsert).not.toHaveBeenCalled();
    expect(mocks.rowUpdate).not.toHaveBeenCalled();
  });

  it("a grant that is no longer active is re-checked and refused", async () => {
    mocks.isAreaCoordinator.mockResolvedValue(false);
    expect((await areaPatch(request("PATCH", { followedUp: true }), ctx)).status).toBe(404);
    expect((await areaPutSwitch(request("PUT", { enabled: true }), ctx)).status).toBe(404);
    expect(mocks.rowUpdate).not.toHaveBeenCalled();
  });

  it("an unpublished event is not found for a coordinator", async () => {
    mocks.eventFindFirst.mockResolvedValue(null);
    expect((await areaPatch(request("PATCH", { followedUp: true }), ctx)).status).toBe(404);
    expect(mocks.eventFindFirst.mock.calls[0]![0].where).toMatchObject({ isPublished: true, audience: "CLUB", archivedAt: null });
  });

  it("another event's row is not found and module off is refused", async () => {
    mocks.rowFindFirst.mockResolvedValue(null);
    expect((await areaPatch(request("PATCH", { followedUp: true }), ctx)).status).toBe(404);
    mocks.rowFindFirst.mockResolvedValue(stored());
    mocks.moduleFindUnique.mockResolvedValue(null);
    expect((await areaPatch(request("PATCH", { followedUp: true }), ctx)).status).toBe(422);
  });
});

describe("opening the names list is audited for an Area Coordinator (#1680)", () => {
  it("writes the count and the account, never a name or a note", async () => {
    await recordBaptismListViewed(coordinator, "event-1", 3);
    const entry = mocks.writeAuditLog.mock.calls[0]![0] as { action: string; actorUserId?: string; metadata: unknown };
    expect(entry.action).toBe("BAPTISM_FOLLOW_UP_LIST_VIEWED");
    expect(entry.actorUserId).toBeUndefined();
    expect(entry.metadata).toEqual({ actorAttendeeAccountId: "acct-1", viaAreaCoordinator: true, eventId: "event-1", nameCount: 3 });
    expect(JSON.stringify(entry)).not.toContain(NAME);
  });
});
