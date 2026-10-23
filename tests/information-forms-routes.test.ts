import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  findActiveMembership: vi.fn(),
  findEvent: vi.fn(),
  listInformationForms: vi.fn(),
  createInformationForm: vi.fn(),
  getInformationForm: vi.fn(),
  saveInformationFormDraft: vi.fn(),
  publishInformationForm: vi.fn(),
  setInformationFormStatus: vi.fn(),
  updateInformationFormSettings: vi.fn(),
  listInformationFormResponses: vi.fn(),
  getInformationFormResponse: vi.fn(),
  buildInformationFormResponsesCsv: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ event: { findUnique: mocks.findEvent } }) }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => null }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: mocks.findActiveMembership }));
vi.mock("@/modules/information-forms/repository", () => ({
  listInformationForms: mocks.listInformationForms,
  createInformationForm: mocks.createInformationForm,
  getInformationForm: mocks.getInformationForm,
  saveInformationFormDraft: mocks.saveInformationFormDraft,
  publishInformationForm: mocks.publishInformationForm,
  setInformationFormStatus: mocks.setInformationFormStatus,
  updateInformationFormSettings: mocks.updateInformationFormSettings,
}));
vi.mock("@/modules/information-forms/responses", () => ({
  listInformationFormResponses: mocks.listInformationFormResponses,
  getInformationFormResponse: mocks.getInformationFormResponse,
  buildInformationFormResponsesCsv: mocks.buildInformationFormResponsesCsv,
}));

import { GET as ADMIN_LIST, POST as ADMIN_CREATE } from "@/app/api/admin/information-forms/route";
import { PATCH as ADMIN_SAVE } from "@/app/api/admin/information-forms/[formId]/route";
import { GET as ADMIN_EXPORT } from "@/app/api/admin/information-forms/[formId]/responses/export/route";
import { GET as EVENT_LIST, POST as EVENT_CREATE } from "@/app/api/events/[eventId]/information-forms/route";
import { GET as EVENT_GET, PATCH as EVENT_SAVE } from "@/app/api/events/[eventId]/information-forms/[formId]/route";
import { POST as EVENT_PUBLISH } from "@/app/api/events/[eventId]/information-forms/[formId]/publish/route";
import { PATCH as EVENT_STATUS } from "@/app/api/events/[eventId]/information-forms/[formId]/status/route";
import { GET as EVENT_RESPONSES } from "@/app/api/events/[eventId]/information-forms/[formId]/responses/route";
import { GET as EVENT_RESPONSE } from "@/app/api/events/[eventId]/information-forms/[formId]/responses/[responseId]/route";
import { GET as EVENT_EXPORT } from "@/app/api/events/[eventId]/information-forms/[formId]/responses/export/route";

const systemAdmin = { user: { id: "admin-1", email: "admin@example.test", displayName: "Admin", globalRole: "SYSTEM_ADMIN" } };
const eventStaff = { user: { id: "staff-1", email: "staff@example.test", displayName: "Staff", globalRole: null } };

function membership(role: string, eventId = "event-1", permissions: string[] = []) {
  return { eventId, userId: "staff-1", role, status: "ACTIVE", permissions };
}

const request = (method = "GET", body?: unknown) => new Request("https://events.example.test/api", { method, ...(body ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}) });
const eventParams = (extra: Record<string, string> = {}) => ({ params: Promise.resolve({ eventId: "event-1", formId: "form-1", responseId: "response-1", ...extra }) });
const adminParams = { params: Promise.resolve({ formId: "form-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findEvent.mockResolvedValue({ id: "event-1" });
  mocks.listInformationForms.mockResolvedValue([]);
  mocks.getInformationForm.mockResolvedValue({ id: "form-1" });
  mocks.createInformationForm.mockResolvedValue({ id: "form-1" });
  mocks.saveInformationFormDraft.mockResolvedValue({ id: "form-1" });
  mocks.publishInformationForm.mockResolvedValue({ id: "form-1" });
  mocks.setInformationFormStatus.mockResolvedValue({ id: "form-1" });
  mocks.listInformationFormResponses.mockResolvedValue({ responses: [], nextCursor: null, total: 0 });
  mocks.getInformationFormResponse.mockResolvedValue({ id: "response-1" });
  mocks.buildInformationFormResponsesCsv.mockResolvedValue({ csv: "\"A\"\r\n", filename: "survey-responses.csv", rowCount: 0 });
});

describe("GENERAL information form routes (system administrator only)", () => {
  it("serve a system administrator against the GENERAL target", async () => {
    mocks.getCurrentSession.mockResolvedValue(systemAdmin);
    expect((await ADMIN_LIST(request())).status).toBe(200);
    expect(mocks.listInformationForms).toHaveBeenCalledWith({ scope: "GENERAL" });
    expect((await ADMIN_CREATE(request("POST", { name: "Interest survey" }))).status).toBe(201);
    expect(mocks.createInformationForm).toHaveBeenCalledWith({ scope: "GENERAL" }, "admin-1", expect.objectContaining({ name: "Interest survey" }));
  });

  it("refuse event staff, even one holding MANAGE_FORMS on an event", async () => {
    mocks.getCurrentSession.mockResolvedValue(eventStaff);
    mocks.findActiveMembership.mockResolvedValue(membership("REGISTRATION_MANAGER"));
    for (const response of [
      await ADMIN_LIST(request()),
      await ADMIN_CREATE(request("POST", { name: "Interest survey" })),
      await ADMIN_SAVE(request("PATCH", { definition: {}, expectedUpdatedAt: "2026-08-01T00:00:00.000Z" }), adminParams),
      await ADMIN_EXPORT(request(), adminParams),
    ]) {
      expect(response.status).toBe(403);
    }
    expect(mocks.listInformationForms).not.toHaveBeenCalled();
    expect(mocks.createInformationForm).not.toHaveBeenCalled();
    expect(mocks.buildInformationFormResponsesCsv).not.toHaveBeenCalled();
  });

  it("refuse a signed-out caller", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    expect((await ADMIN_LIST(request())).status).toBe(401);
  });
});

describe("EVENT information form routes (MANAGE_FORMS on the event)", () => {
  it("serve a system administrator without a membership", async () => {
    mocks.getCurrentSession.mockResolvedValue(systemAdmin);
    expect((await EVENT_LIST(request(), eventParams())).status).toBe(200);
    expect(mocks.listInformationForms).toHaveBeenCalledWith({ scope: "EVENT", eventId: "event-1" });
  });

  it("serve event staff who hold MANAGE_FORMS, scoped to that event", async () => {
    mocks.getCurrentSession.mockResolvedValue(eventStaff);
    mocks.findActiveMembership.mockResolvedValue(membership("REGISTRATION_MANAGER"));
    expect((await EVENT_CREATE(request("POST", { name: "Post-event survey" }), eventParams())).status).toBe(201);
    expect(mocks.createInformationForm).toHaveBeenCalledWith({ scope: "EVENT", eventId: "event-1" }, "staff-1", expect.anything());
    expect((await EVENT_GET(request(), eventParams())).status).toBe(200);
    expect(mocks.getInformationForm).toHaveBeenCalledWith({ scope: "EVENT", eventId: "event-1" }, "form-1");
    expect((await EVENT_PUBLISH(request("POST", {}), eventParams())).status).toBe(200);
    expect((await EVENT_STATUS(request("PATCH", { status: "OPEN" }), eventParams())).status).toBe(200);
    expect((await EVENT_RESPONSES(request(), eventParams())).status).toBe(200);
    expect((await EVENT_RESPONSE(request(), eventParams({ responseId: "response-1" }))).status).toBe(200);
  });

  it("answers an event id that does not exist as 404 for a system administrator, and 403 for anyone else", async () => {
    mocks.findEvent.mockResolvedValue(null);
    mocks.getCurrentSession.mockResolvedValue(systemAdmin);
    expect((await EVENT_LIST(request(), eventParams())).status).toBe(404);
    mocks.getCurrentSession.mockResolvedValue(eventStaff);
    mocks.findActiveMembership.mockResolvedValue(null);
    expect((await EVENT_LIST(request(), eventParams())).status).toBe(403);
    expect(mocks.listInformationForms).not.toHaveBeenCalled();
  });

  it("publishes with no body, or with the expected draft timestamp", async () => {
    mocks.getCurrentSession.mockResolvedValue(systemAdmin);
    expect((await EVENT_PUBLISH(new Request("https://events.example.test/api", { method: "POST" }), eventParams())).status).toBe(200);
    expect(mocks.publishInformationForm).toHaveBeenLastCalledWith({ scope: "EVENT", eventId: "event-1" }, "form-1", "admin-1", undefined);
    expect((await EVENT_PUBLISH(request("POST", { expectedUpdatedAt: "2026-08-01T00:00:00.000Z" }), eventParams())).status).toBe(200);
    expect(mocks.publishInformationForm).toHaveBeenLastCalledWith({ scope: "EVENT", eventId: "event-1" }, "form-1", "admin-1", "2026-08-01T00:00:00.000Z");
  });

  it("serve staff given MANAGE_FORMS as an extra permission", async () => {
    mocks.getCurrentSession.mockResolvedValue(eventStaff);
    mocks.findActiveMembership.mockResolvedValue(membership("READ_ONLY_STAFF", "event-1", ["MANAGE_FORMS"]));
    expect((await EVENT_LIST(request(), eventParams())).status).toBe(200);
  });

  it("refuse event staff without MANAGE_FORMS", async () => {
    mocks.getCurrentSession.mockResolvedValue(eventStaff);
    mocks.findActiveMembership.mockResolvedValue(membership("READ_ONLY_STAFF"));
    for (const response of [
      await EVENT_LIST(request(), eventParams()),
      await EVENT_CREATE(request("POST", { name: "Post-event survey" }), eventParams()),
      await EVENT_SAVE(request("PATCH", { definition: {}, expectedUpdatedAt: "2026-08-01T00:00:00.000Z" }), eventParams()),
      await EVENT_RESPONSES(request(), eventParams()),
      await EVENT_EXPORT(request(), eventParams()),
    ]) {
      expect(response.status).toBe(403);
    }
    expect(mocks.listInformationForms).not.toHaveBeenCalled();
    expect(mocks.listInformationFormResponses).not.toHaveBeenCalled();
  });

  it("refuse staff assigned only to another event", async () => {
    mocks.getCurrentSession.mockResolvedValue(eventStaff);
    mocks.findActiveMembership.mockImplementation(async (_userId: string, eventId: string) => (eventId === "event-2" ? membership("REGISTRATION_MANAGER", "event-2") : null));
    const response = await EVENT_LIST(request(), eventParams());
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("EVENT_ACCESS_DENIED");
    expect(mocks.listInformationForms).not.toHaveBeenCalled();
  });

  it("answers a form id from another scope as not found, never as its data", async () => {
    mocks.getCurrentSession.mockResolvedValue(eventStaff);
    mocks.findActiveMembership.mockResolvedValue(membership("REGISTRATION_MANAGER"));
    const { InformationFormError } = await import("@/modules/information-forms/errors");
    mocks.getInformationForm.mockRejectedValue(new InformationFormError("FORM_NOT_FOUND", "That information form was not found."));
    const response = await EVENT_GET(request(), eventParams({ formId: "general-form" }));
    expect(response.status).toBe(404);
  });

  it("reports an edit conflict as 409 and an invalid definition as 400", async () => {
    mocks.getCurrentSession.mockResolvedValue(systemAdmin);
    const { InformationFormError } = await import("@/modules/information-forms/errors");
    mocks.saveInformationFormDraft.mockRejectedValueOnce(new InformationFormError("EDIT_CONFLICT", "This draft changed in another session."));
    const conflict = await EVENT_SAVE(request("PATCH", { definition: {}, expectedUpdatedAt: "2026-08-01T00:00:00.000Z" }), eventParams());
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error).toBe("EDIT_CONFLICT");
    const invalid = await EVENT_SAVE(request("PATCH", { definition: {} }), eventParams());
    expect(invalid.status).toBe(400);
  });

  it("downloads the CSV as an attachment", async () => {
    mocks.getCurrentSession.mockResolvedValue(systemAdmin);
    const response = await EVENT_EXPORT(request(), eventParams());
    expect(response.headers.get("Content-Type")).toContain("text/csv");
    expect(response.headers.get("Content-Disposition")).toContain("survey-responses.csv");
    expect(await response.text()).toBe("\"A\"\r\n");
  });
});
