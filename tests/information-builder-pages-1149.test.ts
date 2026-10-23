import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  staffLoginRedirectPath: vi.fn(),
  resolveEventContext: vi.fn(),
  loadInformationFormsHome: vi.fn(),
  loadInformationFormView: vi.fn(),
}));

class Redirect extends Error {
  constructor(public readonly to: string) { super(`REDIRECT:${to}`); }
}

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => { throw new Redirect(to); },
  notFound: () => { throw new Error("NOT_FOUND"); },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/login-redirect", () => ({ staffLoginRedirectPath: mocks.staffLoginRedirectPath }));
vi.mock("@/modules/events/selection", () => ({ resolveEventContext: mocks.resolveEventContext }));
vi.mock("@/components/information-forms-page-data", () => ({ loadInformationFormsHome: mocks.loadInformationFormsHome, loadInformationFormView: mocks.loadInformationFormView }));
vi.mock("@/components/registration-builder-workspace", () => ({ RegistrationBuilderWorkspace: () => null }));
vi.mock("@/components/information-forms-home", () => ({ InformationFormsHome: () => null }));

import AdminListPage from "@/app/(workspace)/admin/information-forms/page";
import AdminFormPage from "@/app/(workspace)/admin/information-forms/[formId]/page";
import EventPage from "@/app/(workspace)/information-forms/page";

const event = { id: "evt_1", slug: "synthetic-camp", name: "Synthetic Camp" };
const params = (formId: string) => ({ params: Promise.resolve({ formId }) });
const search = (value: { event?: string; form?: string }) => ({ searchParams: Promise.resolve(value) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.staffLoginRedirectPath.mockResolvedValue("/login");
  mocks.loadInformationFormsHome.mockResolvedValue({ forms: [], templates: [] });
});

describe("information form pages (#1149)", () => {
  it("sends a signed-out visit to sign in and a non-administrator away from the admin pages", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    await expect(AdminListPage()).rejects.toMatchObject({ to: "/login" });
    await expect(AdminFormPage(params("f1"))).rejects.toMatchObject({ to: "/login" });
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "u1", globalRole: "STAFF" } });
    await expect(AdminListPage()).rejects.toMatchObject({ to: "/no-access" });
    await expect(AdminFormPage(params("f1"))).rejects.toMatchObject({ to: "/no-access" });
    expect(mocks.loadInformationFormView).not.toHaveBeenCalled();
  });

  it("looks a general form up only among general forms; an event form id is not found", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "a1", globalRole: "SYSTEM_ADMIN" } });
    mocks.loadInformationFormView.mockResolvedValue(null);
    await expect(AdminFormPage(params("event_form"))).rejects.toThrow("NOT_FOUND");
    expect(mocks.loadInformationFormView).toHaveBeenCalledWith({ scope: "GENERAL" }, "event_form");
    await expect(AdminListPage()).resolves.toBeTruthy();
    expect(mocks.loadInformationFormsHome).toHaveBeenCalledWith({ scope: "GENERAL" });
  });

  it("restricts the event page to MANAGE_FORMS and never loads without it", async () => {
    mocks.resolveEventContext.mockResolvedValue({ event, permissions: ["VIEW_EVENT"], user: {} });
    const page = await EventPage(search({ event: "evt_1", form: "f1" }));
    expect(JSON.stringify(page)).toContain("Information form access is restricted");
    expect(mocks.loadInformationFormView).not.toHaveBeenCalled();
    expect(mocks.loadInformationFormsHome).not.toHaveBeenCalled();
  });

  it("looks an event form up only inside that event; another event's or a general form id is not found", async () => {
    mocks.resolveEventContext.mockResolvedValue({ event, permissions: ["MANAGE_FORMS"], user: {} });
    mocks.loadInformationFormView.mockResolvedValue(null);
    await expect(EventPage(search({ event: "evt_1", form: "other_form" }))).rejects.toThrow("NOT_FOUND");
    expect(mocks.loadInformationFormView).toHaveBeenCalledWith({ scope: "EVENT", eventId: "evt_1" }, "other_form");
    await expect(EventPage(search({ event: "evt_1" }))).resolves.toBeTruthy();
    expect(mocks.loadInformationFormsHome).toHaveBeenCalledWith({ scope: "EVENT", eventId: "evt_1" });
  });
});
