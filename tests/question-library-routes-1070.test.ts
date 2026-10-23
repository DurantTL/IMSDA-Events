import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  findActiveMembership: vi.fn(),
  rejectCrossOriginRequest: vi.fn(),
  listLibraryItems: vi.fn(),
  createLibraryItem: vi.fn(),
  updateLibraryItem: vi.fn(),
  archiveLibraryItem: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
// The real permission gates run; only the session and the membership lookup behind them are faked.
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: mocks.findActiveMembership }));
vi.mock("@/modules/question-library/repository", () => ({
  listLibraryItems: mocks.listLibraryItems,
  createLibraryItem: mocks.createLibraryItem,
  updateLibraryItem: mocks.updateLibraryItem,
  archiveLibraryItem: mocks.archiveLibraryItem,
}));
vi.mock("@/modules/club-rosters/api-errors", () => ({
  RosterBodyError: class RosterBodyError extends Error { readonly code = "INVALID_JSON_BODY"; },
  readRosterJson: async (request: Request) => request.json(),
}));

import { GET as LIST, POST as SAVE } from "@/app/api/question-library/route";
import { DELETE, PATCH } from "@/app/api/question-library/[itemId]/route";

/** The question library routes enforce Caleb's #1070 decision on the server. Synthetic data only. */

const admin = { id: "admin-1", email: "admin@example.test", displayName: "Synthetic Admin", globalRole: "SYSTEM_ADMIN" };
const staff = { id: "staff-1", email: "staff@example.test", displayName: "Synthetic Staff", globalRole: null };
const itemRef = { params: Promise.resolve({ itemId: "item-1" }) };
const field = { id: "field_1", key: "shirt_size", label: "Shirt size", helpText: "", type: "TEXT", scope: "REGISTRATION", required: false, options: [] };
const base = "https://events.imsda.test/api/question-library";
const json = (body: unknown, method: string) => new Request(base, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

function membership(role: string, permissions: string[] = []) {
  mocks.findActiveMembership.mockImplementation(async (userId: string, eventId: string) => (eventId === "event-1" ? { eventId, userId, role, status: "ACTIVE", permissions } : null));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.listLibraryItems.mockResolvedValue([]);
  mocks.createLibraryItem.mockResolvedValue({ id: "item-1", replacedAcknowledgments: [] });
  mocks.updateLibraryItem.mockResolvedValue(undefined);
  mocks.archiveLibraryItem.mockResolvedValue(undefined);
  mocks.getCurrentSession.mockResolvedValue({ user: staff });
  membership("REGISTRATION_MANAGER");
});

const save = (eventId: string | null = "event-1") => SAVE(json({ eventId, name: "Shirt size", description: "", fields: [field] }, "POST"));

describe("saving to and adding from the library: anyone who can build forms", () => {
  it("lets event staff with MANAGE_FORMS on the event save a question", async () => {
    const response = await save();
    expect(response.status).toBe(201);
    expect(mocks.createLibraryItem).toHaveBeenCalledWith({ name: "Shirt size", description: "", fields: [field] }, { userId: "staff-1", eventId: "event-1" });
  });

  it("lets event staff with MANAGE_FORMS on the event list the library", async () => {
    const response = await LIST(new Request(`${base}?eventId=event-1`));
    expect(response.status).toBe(200);
    expect(mocks.listLibraryItems).toHaveBeenCalled();
  });

  it("lets a staff member with a custom MANAGE_FORMS grant on a role without it save", async () => {
    membership("READ_ONLY_STAFF", ["MANAGE_FORMS"]);
    expect((await save()).status).toBe(201);
  });

  it("lets a system administrator save and list, with or without an event", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: admin });
    expect((await save()).status).toBe(201);
    expect((await save(null)).status).toBe(201);
    expect((await LIST(new Request(base))).status).toBe(200);
  });

  it("refuses staff without MANAGE_FORMS, before saving or listing anything", async () => {
    membership("READ_ONLY_STAFF");
    const saved = await save();
    expect(saved.status).toBe(403);
    expect((await saved.json()).error).toBe("PERMISSION_DENIED");
    expect((await LIST(new Request(`${base}?eventId=event-1`))).status).toBe(403);
    expect(mocks.createLibraryItem).not.toHaveBeenCalled();
    expect(mocks.listLibraryItems).not.toHaveBeenCalled();
  });

  it("refuses staff who build forms for a different event than the one they name", async () => {
    expect((await save("event-2")).status).toBe(403);
    expect(mocks.createLibraryItem).not.toHaveBeenCalled();
  });

  it("refuses non-administrators when no event is named, and anonymous callers", async () => {
    expect((await save(null)).status).toBe(403);
    expect((await LIST(new Request(base))).status).toBe(403);
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    expect((await save()).status).toBe(401);
    expect(mocks.createLibraryItem).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin write before doing anything", async () => {
    mocks.rejectCrossOriginRequest.mockReturnValue(Response.json({ error: "CROSS_ORIGIN" }, { status: 403 }));
    expect((await save()).status).toBe(403);
    expect(mocks.createLibraryItem).not.toHaveBeenCalled();
  });

  it("rejects a malformed request", async () => {
    const response = await SAVE(json({ eventId: "event-1", name: "", fields: [field] }, "POST"));
    expect(response.status).toBe(400);
    expect(mocks.createLibraryItem).not.toHaveBeenCalled();
  });
});

describe("renaming, editing and deleting: system administrators only", () => {
  it("lets a system administrator rename, edit and delete", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: admin });
    expect((await PATCH(json({ name: "Renamed" }, "PATCH"), itemRef)).status).toBe(200);
    expect(mocks.updateLibraryItem).toHaveBeenCalledWith("item-1", { name: "Renamed" }, { userId: "admin-1", eventId: null });
    expect((await PATCH(json({ fields: [field] }, "PATCH"), itemRef)).status).toBe(200);
    expect((await DELETE(new Request(`${base}/item-1`, { method: "DELETE" }), itemRef)).status).toBe(200);
    expect(mocks.archiveLibraryItem).toHaveBeenCalledWith("item-1", { userId: "admin-1", eventId: null });
  });

  it("refuses event staff, even a full event administrator, for edit, rename and delete", async () => {
    for (const role of ["REGISTRATION_MANAGER", "EVENT_ADMIN"]) {
      membership(role);
      const renamed = await PATCH(json({ name: "Renamed" }, "PATCH"), itemRef);
      expect(renamed.status).toBe(403);
      expect((await renamed.json()).message).toContain("System administrator");
      expect((await PATCH(json({ fields: [field] }, "PATCH"), itemRef)).status).toBe(403);
      expect((await DELETE(new Request(`${base}/item-1`, { method: "DELETE" }), itemRef)).status).toBe(403);
    }
    expect(mocks.updateLibraryItem).not.toHaveBeenCalled();
    expect(mocks.archiveLibraryItem).not.toHaveBeenCalled();
  });

  it("refuses anonymous callers", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    expect((await DELETE(new Request(`${base}/item-1`, { method: "DELETE" }), itemRef)).status).toBe(401);
    expect(mocks.archiveLibraryItem).not.toHaveBeenCalled();
  });

  it("rejects an empty edit and unknown properties", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: admin });
    expect((await PATCH(json({}, "PATCH"), itemRef)).status).toBe(400);
    expect((await PATCH(json({ name: "x", createdByUserId: "someone" }, "PATCH"), itemRef)).status).toBe(400);
    expect(mocks.updateLibraryItem).not.toHaveBeenCalled();
  });
});
