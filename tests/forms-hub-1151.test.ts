import { beforeEach, describe, expect, it, vi } from "vitest";

/** The All forms hub (#1151). Synthetic data only. */
const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  load: vi.fn(),
  templateFindMany: vi.fn(),
  submissionGroupBy: vi.fn(),
  formFindMany: vi.fn(),
  responseGroupBy: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/login-redirect", () => ({ staffLoginRedirectPath: async () => "/login" }));
vi.mock("@/modules/forms-hub/load", () => ({ loadFormsHub: mocks.load }));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    clubFormTemplate: { findMany: mocks.templateFindMany },
    clubFormSubmission: { groupBy: mocks.submissionGroupBy },
    informationForm: { findMany: mocks.formFindMany },
    informationFormResponse: { groupBy: mocks.responseGroupBy },
  }),
}));

import AdminFormsPage from "@/app/(workspace)/admin/forms/page";
import { listClubFormsForHub } from "@/modules/club-forms/hub";
import { listInformationFormsForHub } from "@/modules/information-forms/hub";
import { filterFormsHubRows, parseFormsHubFilters, sortFormsHubRows, type FormsHubRow } from "@/modules/forms-hub/rows";

function row(overrides: Partial<FormsHubRow>): FormsHubRow {
  return { id: "x", kind: "GENERAL", name: "Form", eventName: null, status: "OPEN", statusLabel: "Open", responseCount: 0, lastResponseAt: null, editHref: "/e", responsesHref: "/r", ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue([]);
});

describe("All forms page access", () => {
  it("sends signed-out visitors to sign in and non-administrators away before loading anything", async () => {
    const props = { searchParams: Promise.resolve({}) };
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    await expect(AdminFormsPage(props)).rejects.toThrow("REDIRECT:/login");
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "u", globalRole: null } });
    await expect(AdminFormsPage(props)).rejects.toThrow("REDIRECT:/no-access");
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("loads for a system administrator", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "u", globalRole: "SYSTEM_ADMIN" } });
    await AdminFormsPage({ searchParams: Promise.resolve({ kind: "CLUB" }) });
    expect(mocks.load).toHaveBeenCalledTimes(1);
  });
});

describe("filters", () => {
  const rows = [
    row({ id: "a", kind: "CLUB", name: "Medical Release", status: "NOT_OPEN" }),
    row({ id: "b", kind: "GENERAL", name: "Interest Survey" }),
    row({ id: "c", kind: "EVENT", name: "Post-event Survey", eventName: "Synthetic Camporee", status: "CLOSED" }),
  ];

  it("ignores unknown filter values", () => {
    expect(parseFormsHubFilters({ kind: "BOGUS", status: "x", q: "  a   b " })).toEqual({ kind: null, status: null, q: "a b" });
  });

  it("filters by kind, status and name or event name", () => {
    expect(filterFormsHubRows(rows, { kind: "EVENT", status: null, q: "" }).map((r) => r.id)).toEqual(["c"]);
    expect(filterFormsHubRows(rows, { kind: null, status: "OPEN", q: "" }).map((r) => r.id)).toEqual(["b"]);
    expect(filterFormsHubRows(rows, { kind: null, status: null, q: "SURVEY" }).map((r) => r.id)).toEqual(["b", "c"]);
    expect(filterFormsHubRows(rows, { kind: null, status: null, q: "camporee" }).map((r) => r.id)).toEqual(["c"]);
  });

  it("orders club, then general, then event forms", () => {
    expect(sortFormsHubRows([rows[2]!, rows[1]!, rows[0]!]).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});

describe("loaders", () => {
  it("lists club forms with one groupBy for submitted counts and no answers", async () => {
    mocks.templateFindMany.mockResolvedValue([{ id: "t1", key: "medical", name: "Medical", enabled: true }, { id: "t2", key: "trip", name: "Trip", enabled: false }]);
    mocks.submissionGroupBy.mockResolvedValue([{ templateId: "t1", _count: { _all: 3 }, _max: { submittedAt: new Date("2026-05-01T12:00:00Z") } }]);
    const rows = await listClubFormsForHub();
    expect(rows.map((r) => [r.name, r.statusLabel, r.responseCount, r.lastResponseAt])).toEqual([["Medical", "On", 3, "2026-05-01T12:00:00.000Z"], ["Trip", "Off", 0, null]]);
    expect(rows[0]).toMatchObject({ editHref: "/admin/club-forms/medical", responsesHref: "/more/club-forms?form=medical" });
    expect(mocks.submissionGroupBy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mocks.templateFindMany.mock.calls)).not.toContain("answers");
  });

  it("lists general and event information forms with their destinations and one groupBy", async () => {
    mocks.formFindMany.mockResolvedValue([
      { id: "f1", scope: "GENERAL", eventId: null, name: "Survey", status: "OPEN", event: null },
      { id: "f2", scope: "EVENT", eventId: "ev1", name: "Feedback", status: "DRAFT", event: { name: "Synthetic Camp" } },
    ]);
    mocks.responseGroupBy.mockResolvedValue([{ formId: "f2", _count: { _all: 2 }, _max: { submittedAt: new Date("2026-06-01T00:00:00Z") } }]);
    const rows = await listInformationFormsForHub();
    expect(rows[0]).toMatchObject({ kind: "GENERAL", eventName: null, editHref: "/admin/information-forms/f1", responsesHref: "/admin/information-forms/f1/responses", responseCount: 0 });
    expect(rows[1]).toMatchObject({ kind: "EVENT", eventName: "Synthetic Camp", status: "NOT_OPEN", responseCount: 2, editHref: "/information-forms?event=ev1&form=f2", responsesHref: "/information-forms/responses?event=ev1&form=f2" });
    expect(mocks.responseGroupBy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mocks.formFindMany.mock.calls)).not.toContain("answers");
  });
});
