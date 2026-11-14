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
  rowUpdateMany: vi.fn(),
  rowFindFirstOrThrow: vi.fn(),
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
    baptismFollowUp: { findFirst: mocks.rowFindFirst, updateMany: mocks.rowUpdateMany, findFirstOrThrow: mocks.rowFindFirstOrThrow },
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
const MARKED_AT = new Date("2027-01-02T10:00:00Z");
/** What a form that loaded a fresh, unmarked name sends back, and what one that loaded the marked name with a note sends. */
const fresh = { expectedFollowedUpAt: null, expectedNote: null };
const marked = { expectedFollowedUpAt: MARKED_AT.toISOString(), expectedNote: NOTE };

const stored = (over: Record<string, unknown> = {}) => ({ id: "row-1", followedUpAt: null, followUpNote: null, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.eventFindFirst.mockResolvedValue({ id: "event-1", name: "Sample Fall Camporee" });
  mocks.moduleFindUnique.mockResolvedValue({ id: "m1" });
  mocks.moduleCreateMany.mockResolvedValue({ count: 1 });
  mocks.moduleDeleteMany.mockResolvedValue({ count: 1 });
  mocks.rowFindFirst.mockResolvedValue(stored());
  mocks.rowUpdateMany.mockResolvedValue({ count: 1 });
  // Like the database: the stored row with the changed fields applied.
  mocks.rowFindFirstOrThrow.mockImplementation(async () => ({ ...(await mocks.rowFindFirst.mock.results.at(-1)?.value), ...(mocks.rowUpdateMany.mock.calls.at(-1)?.[0].data ?? {}) }));
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
    expect(followUpInputSchema.safeParse({ ...fresh }).success).toBe(false);
    expect(followUpInputSchema.safeParse({ followedUp: true, ...fresh }).success).toBe(true);
    expect(followUpInputSchema.safeParse({ note: "", ...fresh }).success).toBe(true);
    expect(followUpInputSchema.safeParse({ followedUp: true, name: "x", ...fresh }).success).toBe(false);
    // The form must say what it saw, so a save can never silently overwrite someone else's change.
    expect(followUpInputSchema.safeParse({ followedUp: true }).success).toBe(false);
  });
});

describe("marking a name followed up (#1680)", () => {
  it("marks it with the time and the staff user, and audits only the event, the status and whether the note changed", async () => {
    const result = await updateBaptismFollowUp(staff, "event-1", "row-1", { followedUp: true, note: NOTE, ...fresh });
    const data = mocks.rowUpdateMany.mock.calls[0]![0].data as Record<string, unknown>;
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
    await updateBaptismFollowUp(coordinator, "event-1", "row-1", { followedUp: true, ...fresh });
    expect(mocks.rowUpdateMany.mock.calls[0]![0].data).toMatchObject({ followedUpByUserId: null, followedUpByAttendeeAccountId: "acct-1" });
    const entry = mocks.writeAuditLog.mock.calls[0]![0] as { actorUserId?: string; metadata: unknown };
    expect(entry.actorUserId).toBeUndefined();
    expect(entry.metadata).toEqual({ actorAttendeeAccountId: "acct-1", viaAreaCoordinator: true, eventId: "event-1", followedUp: true, noteChanged: false });
  });

  it("unmarking clears when and who, keeps the note and leaves the note untouched", async () => {
    mocks.rowFindFirst.mockResolvedValue(stored({ followedUpAt: MARKED_AT, followUpNote: NOTE }));
    await updateBaptismFollowUp(staff, "event-1", "row-1", { followedUp: false, ...marked });
    const data = mocks.rowUpdateMany.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data).toEqual({ followedUpAt: null, followedUpByUserId: null, followedUpByAttendeeAccountId: null });
    expect(data).not.toHaveProperty("followUpNote");
    expect((mocks.writeAuditLog.mock.calls[0]![0] as { metadata: unknown }).metadata).toEqual({ eventId: "event-1", followedUp: false, noteChanged: false });
  });

  it("a note-only change keeps the status, and an emptied note clears the note", async () => {
    mocks.rowFindFirst.mockResolvedValue(stored({ followedUpAt: MARKED_AT, followUpNote: NOTE }));
    await updateBaptismFollowUp(staff, "event-1", "row-1", { note: "  ", ...marked });
    expect(mocks.rowUpdateMany.mock.calls[0]![0].data).toEqual({ followUpNote: null });
    expect((mocks.writeAuditLog.mock.calls[0]![0] as { metadata: unknown }).metadata).toEqual({ eventId: "event-1", followedUp: true, noteChanged: true });
  });

  it("a repeat that changes nothing writes and audits nothing", async () => {
    mocks.rowFindFirst.mockResolvedValue(stored({ followedUpAt: MARKED_AT, followUpNote: NOTE }));
    await updateBaptismFollowUp(staff, "event-1", "row-1", { followedUp: true, note: `  ${NOTE} `, ...marked });
    expect(mocks.rowUpdateMany).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("looks the row up by event and id together, so another event's row is not found", async () => {
    mocks.rowFindFirst.mockResolvedValue(null);
    await expect(updateBaptismFollowUp(staff, "event-1", "row-of-another-event", { followedUp: true, ...fresh })).rejects.toMatchObject({ code: "FOLLOW_UP_NOT_FOUND" });
    expect(mocks.rowFindFirst.mock.calls[0]![0].where).toEqual({ id: "row-of-another-event", eventId: "event-1" });
    expect(mocks.rowUpdateMany).not.toHaveBeenCalled();
  });

  it("refuses a stale form instead of overwriting: staff saving over a coordinator's mark, and the coordinator over staff's", async () => {
    // The form loaded "not followed up"; a coordinator marked it in between.
    mocks.rowFindFirst.mockResolvedValue(stored({ followedUpAt: MARKED_AT, followUpNote: null, followedUpByAttendeeAccountId: "acct-1" }));
    await expect(updateBaptismFollowUp(staff, "event-1", "row-1", { note: NOTE, ...fresh })).rejects.toMatchObject({ code: "CONFLICT", message: "This name was changed by someone else since you opened the page. Reload to see it." });
    // The form loaded the coordinator-marked row; staff unmarked and changed the note in between.
    mocks.rowFindFirst.mockResolvedValue(stored({ followedUpAt: null, followUpNote: "Staff note" }));
    await expect(updateBaptismFollowUp(coordinator, "event-1", "row-1", { followedUp: true, ...marked })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.rowUpdateMany).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("loses a race that slips past the first read: the conditional write matches nothing", async () => {
    mocks.rowUpdateMany.mockResolvedValue({ count: 0 });
    await expect(updateBaptismFollowUp(staff, "event-1", "row-1", { followedUp: true, ...fresh })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.rowUpdateMany.mock.calls[0]![0].where).toMatchObject({ id: "row-1", eventId: "event-1", followedUpAt: null, followUpNote: null });
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("is refused while the module is off, and for a note over 500 characters", async () => {
    await expect(updateBaptismFollowUp(staff, "event-1", "row-1", { note: "c".repeat(501), ...fresh })).rejects.toMatchObject({ code: "INVALID_NOTE" });
    mocks.moduleFindUnique.mockResolvedValue(null);
    await expect(updateBaptismFollowUp(staff, "event-1", "row-1", { followedUp: true, ...fresh })).rejects.toMatchObject({ code: "MODULE_OFF" });
    expect(mocks.rowUpdateMany).not.toHaveBeenCalled();
  });
});

describe("who may change a name's status, over the staff routes (#1680)", () => {
  it("a system administrator, an Event Admin and the Clubs Administrator (an Event Admin on club events) may; a Registration Manager may not", async () => {
    mocks.getCurrentSession.mockResolvedValue(session("SYSTEM_ADMIN"));
    mocks.findActiveMembership.mockImplementation(lookup(null));
    expect((await staffPatch(request("PATCH", { followedUp: true, ...fresh }), ctx)).status).toBe(200);
    mocks.getCurrentSession.mockResolvedValue(session());
    mocks.findActiveMembership.mockImplementation(lookup("EVENT_ADMIN"));
    expect((await staffPatch(request("PATCH", { followedUp: true, ...fresh }), ctx)).status).toBe(200);
    mocks.rowUpdateMany.mockClear();
    mocks.findActiveMembership.mockImplementation(lookup("REGISTRATION_MANAGER"));
    expect((await staffPatch(request("PATCH", { followedUp: true, ...fresh }), ctx)).status).toBe(403);
    expect(mocks.rowUpdateMany).not.toHaveBeenCalled();
  });

  it("answers 401 signed out, 404 for another event's row, 422 when the module is off, 400 for an empty request, and never caches", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    expect((await staffPatch(request("PATCH", { followedUp: true, ...fresh }), ctx)).status).toBe(401);
    mocks.getCurrentSession.mockResolvedValue(session());
    mocks.findActiveMembership.mockImplementation(lookup("EVENT_ADMIN"));
    mocks.rowFindFirst.mockResolvedValue(null);
    const missing = await staffPatch(request("PATCH", { followedUp: true, ...fresh }), ctx);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("Cache-Control")).toBe("private, no-store");
    expect((await staffPatch(request("PATCH", {}), ctx)).status).toBe(400);
    mocks.moduleFindUnique.mockResolvedValue(null);
    const off = await staffPatch(request("PATCH", { followedUp: true, ...fresh }), ctx);
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

describe("a stale form answers 409 on both route sets (#1680)", () => {
  const stale = { followedUp: true, ...fresh };
  it("staff route", async () => {
    mocks.getCurrentSession.mockResolvedValue(session());
    mocks.findActiveMembership.mockImplementation(lookup("EVENT_ADMIN"));
    mocks.rowFindFirst.mockResolvedValue(stored({ followedUpAt: MARKED_AT }));
    const response = await staffPatch(request("PATCH", stale), ctx);
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toEqual({ error: "CONFLICT", message: "This name was changed by someone else since you opened the page. Reload to see it." });
    expect(mocks.rowUpdateMany).not.toHaveBeenCalled();
  });

  it("coordinator route", async () => {
    mocks.rowFindFirst.mockResolvedValue(stored({ followUpNote: "Staff note" }));
    const response = await areaPatch(request("PATCH", stale), ctx);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("CONFLICT");
    expect(mocks.rowUpdateMany).not.toHaveBeenCalled();
  });
});

describe("the Area Coordinator routes (#1680)", () => {
  it("an active coordinator may switch it, save the lead addresses and change a status", async () => {
    expect((await areaPutSwitch(request("PUT", { enabled: false }), ctx)).status).toBe(200);
    expect(mocks.moduleDeleteMany).toHaveBeenCalled();
    expect((await areaPutLeads(request("PUT", { leadEmails: "lead@example.test" }), ctx)).status).toBe(200);
    const lead = mocks.writeAuditLog.mock.calls.map((call) => call[0] as { action: string; metadata: Record<string, unknown> }).find((entry) => entry.action === "BAPTISM_FOLLOW_UP_LEADS_CHANGED")!;
    expect(lead.metadata).toMatchObject({ actorAttendeeAccountId: "acct-1", viaAreaCoordinator: true });
    expect((await areaPatch(request("PATCH", { followedUp: true, ...fresh }), ctx)).status).toBe(200);
  });

  it("a non-coordinator, and staff acting as one, get a not-found answer and nothing changes", async () => {
    mocks.currentAreaCoordinator.mockResolvedValue(null);
    for (const response of [await areaPutSwitch(request("PUT", { enabled: true }), ctx), await areaPutLeads(request("PUT", { leadEmails: "" }), ctx), await areaPatch(request("PATCH", { followedUp: true, ...fresh }), ctx)]) {
      expect(response.status).toBe(404);
    }
    expect(mocks.moduleCreateMany).not.toHaveBeenCalled();
    expect(mocks.settingUpsert).not.toHaveBeenCalled();
    expect(mocks.rowUpdateMany).not.toHaveBeenCalled();
  });

  it("a grant that is no longer active is re-checked and refused", async () => {
    mocks.isAreaCoordinator.mockResolvedValue(false);
    expect((await areaPatch(request("PATCH", { followedUp: true, ...fresh }), ctx)).status).toBe(404);
    expect((await areaPutSwitch(request("PUT", { enabled: true }), ctx)).status).toBe(404);
    expect(mocks.rowUpdateMany).not.toHaveBeenCalled();
  });

  it("an unpublished event is not found for a coordinator", async () => {
    mocks.eventFindFirst.mockResolvedValue(null);
    expect((await areaPatch(request("PATCH", { followedUp: true, ...fresh }), ctx)).status).toBe(404);
    expect(mocks.eventFindFirst.mock.calls[0]![0].where).toMatchObject({ isPublished: true, audience: "CLUB", archivedAt: null });
  });

  it("another event's row is not found and module off is refused", async () => {
    mocks.rowFindFirst.mockResolvedValue(null);
    expect((await areaPatch(request("PATCH", { followedUp: true, ...fresh }), ctx)).status).toBe(404);
    mocks.rowFindFirst.mockResolvedValue(stored());
    mocks.moduleFindUnique.mockResolvedValue(null);
    expect((await areaPatch(request("PATCH", { followedUp: true, ...fresh }), ctx)).status).toBe(422);
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
