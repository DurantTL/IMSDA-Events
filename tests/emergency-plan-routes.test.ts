import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The emergency plan routes (#114) behind the real event permission checks:
 * viewing and export need VIEW_EVENT, saving and publishing CONFIGURE_EVENT, and
 * every one answers 404 while the module is off. Session, membership lookup,
 * module state and the repository are stubbed.
 */
const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  findActiveMembership: vi.fn(),
  isModuleEnabled: vi.fn(),
  getEmergencyPlanDraft: vi.fn(),
  listEmergencyPlanVersions: vi.fn(),
  saveEmergencyPlanDraft: vi.fn(),
  publishEmergencyPlan: vi.fn(),
  getEmergencyPlanVersion: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => null }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: mocks.findActiveMembership }));
vi.mock("@/modules/event-modules/service", () => ({ isModuleEnabled: mocks.isModuleEnabled }));
vi.mock("@/modules/emergency-plans/repository", () => ({
  getEmergencyPlanDraft: mocks.getEmergencyPlanDraft,
  listEmergencyPlanVersions: mocks.listEmergencyPlanVersions,
  saveEmergencyPlanDraft: mocks.saveEmergencyPlanDraft,
  publishEmergencyPlan: mocks.publishEmergencyPlan,
  getEmergencyPlanVersion: mocks.getEmergencyPlanVersion,
}));

import { GET as getPlan, PUT as putPlan } from "@/app/api/events/[eventId]/emergency-plan/route";
import { POST as postPublish } from "@/app/api/events/[eventId]/emergency-plan/publish/route";
import { GET as getExport } from "@/app/api/events/[eventId]/emergency-plan/export/route";

const staff = { id: "staff-1", email: "staff@example.test", displayName: "Staff Member", globalRole: null };
const context = { params: Promise.resolve({ eventId: "event-1" }) };
const url = (path = "") => `https://events.imsda.test/api/events/event-1/emergency-plan${path}`;
const body = { locations: [], procedures: [], contacts: [{ role: "Director", name: "Sample", phone: "(515) 555-0100", escalationOrder: 1 }] };
const put = (payload: unknown = body) => putPlan(new Request(url(), { method: "PUT", body: JSON.stringify(payload) }), context);
const publish = () => postPublish(new Request(url("/publish"), { method: "POST" }), context);
const exportCsv = (query = "") => getExport(new Request(url(`/export${query}`)), context);

function signInAs(role: string | null, permissions: string[] = []) {
  mocks.findActiveMembership.mockResolvedValue(role ? { eventId: "event-1", userId: "staff-1", role, status: "ACTIVE", permissions } : null);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentSession.mockResolvedValue({ user: staff });
  mocks.isModuleEnabled.mockResolvedValue(true);
  mocks.getEmergencyPlanDraft.mockResolvedValue({ locations: [], procedures: [], contacts: [] });
  mocks.listEmergencyPlanVersions.mockResolvedValue([]);
  mocks.saveEmergencyPlanDraft.mockResolvedValue({ locations: [], procedures: [], contacts: [] });
  mocks.publishEmergencyPlan.mockResolvedValue({ versionNumber: 1, publishedAt: new Date("2026-07-01T15:00:00Z"), snapshot: {} });
  mocks.getEmergencyPlanVersion.mockResolvedValue({
    versionNumber: 2,
    publishedAt: new Date("2026-07-01T15:00:00Z"),
    snapshot: {
      schemaVersion: 1,
      event: { name: "Synthetic Camp Meeting", startsOn: "2026-07-15", endsOn: "2026-07-19", timezone: "America/Chicago" },
      locations: [], procedures: [],
      contacts: [{ escalationOrder: 1, role: "Director", name: "Sample", phone: "(515) 555-0100" }],
    },
  });
});

describe("emergency plan permissions", () => {
  it("lets read-only staff view and export but not save or publish", async () => {
    signInAs("READ_ONLY_STAFF");
    expect((await getPlan(new Request(url()), context)).status).toBe(200);
    expect((await exportCsv()).status).toBe(200);
    const saved = await put();
    expect(saved.status).toBe(403);
    expect((await saved.json()).error).toBe("PERMISSION_DENIED");
    expect((await publish()).status).toBe(403);
    expect(mocks.saveEmergencyPlanDraft).not.toHaveBeenCalled();
    expect(mocks.publishEmergencyPlan).not.toHaveBeenCalled();
  });

  it("lets an event administrator save and publish", async () => {
    signInAs("EVENT_ADMIN");
    expect((await put()).status).toBe(200);
    expect(mocks.saveEmergencyPlanDraft).toHaveBeenCalledWith("event-1", expect.objectContaining({ contacts: expect.any(Array) }), "staff-1");
    const published = await publish();
    expect(published.status).toBe(201);
    expect(await published.json()).toMatchObject({ versionNumber: 1 });
  });

  it("rejects kitchen-only staff, who lack VIEW_EVENT, from every route", async () => {
    signInAs("KITCHEN_STAFF");
    expect((await getPlan(new Request(url()), context)).status).toBe(403);
    expect((await exportCsv()).status).toBe(403);
    expect((await put()).status).toBe(403);
    expect((await publish()).status).toBe(403);
    expect(mocks.getEmergencyPlanDraft).not.toHaveBeenCalled();
    expect(mocks.getEmergencyPlanVersion).not.toHaveBeenCalled();
  });

  it("rejects someone not assigned to the event, and a signed-out request", async () => {
    signInAs(null);
    expect((await getPlan(new Request(url()), context)).status).toBe(403);
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    expect((await exportCsv()).status).toBe(401);
  });

  it("answers 404 and reads nothing while the module is off, even for an administrator", async () => {
    signInAs("EVENT_ADMIN");
    mocks.isModuleEnabled.mockResolvedValue(false);
    for (const response of [await getPlan(new Request(url()), context), await put(), await publish(), await exportCsv()]) {
      expect(response.status).toBe(404);
      expect((await response.json()).error).toBe("MODULE_DISABLED");
    }
    expect(mocks.isModuleEnabled).toHaveBeenCalledWith("event-1", "emergency-plans");
    expect(mocks.getEmergencyPlanDraft).not.toHaveBeenCalled();
    expect(mocks.saveEmergencyPlanDraft).not.toHaveBeenCalled();
    expect(mocks.publishEmergencyPlan).not.toHaveBeenCalled();
    expect(mocks.getEmergencyPlanVersion).not.toHaveBeenCalled();
  });

  it("checks the permission before revealing whether the module is on", async () => {
    signInAs("KITCHEN_STAFF");
    mocks.isModuleEnabled.mockResolvedValue(false);
    expect((await exportCsv()).status).toBe(403);
  });
});

describe("emergency plan drafts are administrators' only", () => {
  it("returns the published versions but no draft to read-only staff, and does not read the draft", async () => {
    signInAs("READ_ONLY_STAFF");
    mocks.listEmergencyPlanVersions.mockResolvedValue([{ versionNumber: 1, publishedAt: new Date("2026-07-01T15:00:00Z") }]);
    const body = await (await getPlan(new Request(url()), context)).json();
    expect(body).not.toHaveProperty("draft");
    expect(body.versions).toHaveLength(1);
    expect(mocks.getEmergencyPlanDraft).not.toHaveBeenCalled();
  });

  it("returns the draft too for CONFIGURE_EVENT, whether by role or by an extra grant", async () => {
    signInAs("EVENT_ADMIN");
    expect(await (await getPlan(new Request(url()), context)).json()).toHaveProperty("draft");
    signInAs("READ_ONLY_STAFF", ["CONFIGURE_EVENT"]);
    expect(await (await getPlan(new Request(url()), context)).json()).toHaveProperty("draft");
  });
});

describe("emergency plan input and export", () => {
  it("answers 400 INVALID_EMERGENCY_PLAN for a body that is not JSON", async () => {
    signInAs("EVENT_ADMIN");
    const response = await putPlan(new Request(url(), { method: "PUT", body: "{not json" }), context);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("INVALID_EMERGENCY_PLAN");
    expect(mocks.saveEmergencyPlanDraft).not.toHaveBeenCalled();
  });

  it("reports every invalid row at once, with paths the editor maps to fields", async () => {
    signInAs("EVENT_ADMIN");
    const bad = { role: "Director", name: "Sample", phone: "(555) 010-0100", escalationOrder: 1 };
    const response = await put({ locations: [], procedures: [], contacts: [bad, { ...bad, phone: "" }, { ...bad, phone: "(515) 555-0100", escalationOrder: "" }] });
    expect(response.status).toBe(400);
    const issues = (await response.json()).issues as Array<{ path: Array<string | number>; message: string }>;
    expect(issues.map((issue) => issue.path.join("."))).toEqual(["contacts.0.phone", "contacts.1.phone", "contacts.2.escalationOrder"]);
    expect(issues[2].message).toContain("escalation order");
  });

  it("rejects an invalid draft with a 400 and saves nothing", async () => {
    signInAs("EVENT_ADMIN");
    const response = await put({ ...body, contacts: [{ role: "Director", name: "Sample", phone: "(555) 010-0100", escalationOrder: 1 }] });
    expect(response.status).toBe(400);
    expect(mocks.saveEmergencyPlanDraft).not.toHaveBeenCalled();
  });

  it("exports the latest version by default and a numbered one on request", async () => {
    signInAs("READ_ONLY_STAFF");
    const response = await exportCsv();
    expect(response.headers.get("Content-Type")).toContain("text/csv");
    expect(response.headers.get("Content-Disposition")).toContain("emergency-plan-v2.csv");
    expect(mocks.getEmergencyPlanVersion).toHaveBeenLastCalledWith("event-1", undefined);
    expect(await response.text()).toContain("(515) 555-0100");
    await exportCsv("?version=2");
    expect(mocks.getEmergencyPlanVersion).toHaveBeenLastCalledWith("event-1", 2);
  });

  it("answers 400 for a bad version and 404 when nothing is published", async () => {
    signInAs("READ_ONLY_STAFF");
    expect((await exportCsv("?version=abc")).status).toBe(400);
    expect((await exportCsv("?version=0")).status).toBe(400);
    mocks.getEmergencyPlanVersion.mockResolvedValue(null);
    expect((await exportCsv()).status).toBe(404);
  });
});
