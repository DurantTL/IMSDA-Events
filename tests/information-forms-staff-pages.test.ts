import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  resolveEventContext: vi.fn(),
  load: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); },
  notFound: () => { throw new Error("NOT_FOUND"); },
}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/login-redirect", () => ({ staffLoginRedirectPath: async () => "/login" }));
vi.mock("@/modules/events/selection", () => ({ resolveEventContext: mocks.resolveEventContext }));
vi.mock("@/modules/information-forms/responses-page", () => ({ loadInformationFormResponsesPage: mocks.load }));
vi.mock("@/components/information-form-responses-view", () => ({ InformationFormResponsesView: () => null }));
vi.mock("@/components/access-restricted", () => ({ AccessRestricted: () => null }));

import GeneralPage from "@/app/(workspace)/admin/information-forms/[formId]/responses/page";
import EventPage from "@/app/(workspace)/information-forms/responses/page";

const generalProps = { params: Promise.resolve({ formId: "form-1" }), searchParams: Promise.resolve({}) };
const eventProps = (query: Record<string, string>) => ({ searchParams: Promise.resolve(query) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue({ name: "Survey", total: 0, rows: [], nextCursor: null, selected: null });
});

describe("general responses page", () => {
  it("sends signed-out visitors to sign in and non-administrators away, before reading anything", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    await expect(GeneralPage(generalProps)).rejects.toThrow("REDIRECT:/login");
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "u", globalRole: null } });
    await expect(GeneralPage(generalProps)).rejects.toThrow("REDIRECT:/no-access");
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("reads through the GENERAL target for a system administrator, and 404s an unknown form", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "a", globalRole: "SYSTEM_ADMIN" } });
    await GeneralPage(generalProps);
    expect(mocks.load).toHaveBeenCalledWith({ scope: "GENERAL" }, "form-1", expect.anything());
    mocks.load.mockResolvedValue(null);
    await expect(GeneralPage(generalProps)).rejects.toThrow("NOT_FOUND");
  });
});

describe("event responses page", () => {
  it("shows the restricted notice, and reads nothing, without MANAGE_FORMS", async () => {
    mocks.resolveEventContext.mockResolvedValue({ event: { id: "event-1" }, permissions: ["VIEW_EVENT"] });
    await EventPage(eventProps({ event: "event-1", form: "form-1" }));
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("reads inside the resolved event only, so another event's form id is not found", async () => {
    mocks.resolveEventContext.mockResolvedValue({ event: { id: "event-1" }, permissions: ["MANAGE_FORMS"] });
    await EventPage(eventProps({ event: "event-1", form: "form-1" }));
    expect(mocks.load).toHaveBeenCalledWith({ scope: "EVENT", eventId: "event-1" }, "form-1", expect.anything());
    mocks.load.mockResolvedValue(null);
    await expect(EventPage(eventProps({ event: "event-1", form: "form-of-event-2" }))).rejects.toThrow("NOT_FOUND");
    await expect(EventPage(eventProps({ event: "event-1" }))).rejects.toThrow("NOT_FOUND");
  });
});
