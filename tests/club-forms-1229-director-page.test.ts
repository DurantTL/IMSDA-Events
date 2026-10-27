import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** #1229: the director's Forms page in two groups, with open applications under club forms. Synthetic data only. */
const mocks = vi.hoisted(() => ({
  getAccess: vi.fn(),
  listTemplates: vi.fn(),
  listRoster: vi.fn(),
  listSubmissions: vi.fn(),
  listLinks: vi.fn(),
  getRequired: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), redirect: vi.fn(), notFound: vi.fn() }));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ APP_BASE_URL: "https://events.imsda.test" }) }));
vi.mock("@/modules/club-rosters/access", () => ({ getRosterAccessStateForPage: mocks.getAccess }));
vi.mock("@/modules/club-forms/access", () => ({ clubLeaderViewerFromAccess: () => ({ kind: "CLUB_LEADER", organizationId: "club-a", actor: { kind: "ATTENDEE", accountId: "acct-1" } }) }));
vi.mock("@/modules/club-forms/templates", () => ({ listEnabledClubFormTemplates: mocks.listTemplates }));
vi.mock("@/modules/club-forms/submissions", () => ({ listRosterChoices: mocks.listRoster, listSubmissionsForViewer: mocks.listSubmissions }));
vi.mock("@/modules/club-forms/required", () => ({ getRequiredFormsStatus: mocks.getRequired }));
vi.mock("@/modules/club-forms/links", () => ({ listClubFormLinks: mocks.listLinks }));

import ClubFormsPage from "@/app/(public)/account/(portal)/clubs/[organizationId]/forms/page";

const template = (key: string, name: string, fillMode: "FAMILY" | "CLUB" | "OPEN_APPLICATION") => ({ key, name, description: `${name} description`, fillMode });
const render = async () => renderToStaticMarkup(await ClubFormsPage({ params: Promise.resolve({ organizationId: "club-a" }), searchParams: Promise.resolve({}) }) as React.ReactElement);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAccess.mockResolvedValue({ state: "OPEN", club: { role: "DIRECTOR" } });
  mocks.listRoster.mockResolvedValue([]);
  mocks.listSubmissions.mockResolvedValue([]);
  mocks.listLinks.mockResolvedValue([]);
  mocks.getRequired.mockResolvedValue([{ id: "club-a", name: "Alpha", church: "", items: [] }]);
  mocks.listTemplates.mockResolvedValue([
    template("permission", "Permission Slip", "FAMILY"),
    template("can", "Can Collecting Report", "CLUB"),
    template("tlt_apply", "TLT Application", "OPEN_APPLICATION"),
  ]);
});

describe("the director's Forms page groups (#1229)", () => {
  it("has the two groups, with Send link first for families and Fill in first for club forms", async () => {
    const html = await render();
    expect(html).toContain("Forms for families and individuals: send a link");
    expect(html).toContain("Club forms: the club fills these in");
    const families = html.slice(html.indexOf("club-forms-families"), html.indexOf("club-forms-club"));
    const club = html.slice(html.indexOf("club-forms-club"));
    expect(families).toContain("Permission Slip");
    expect(families).not.toContain("Can Collecting Report");
    expect(families.indexOf("Send link")).toBeGreaterThan(-1);
    expect(families.indexOf('class="primary-button"')).toBeLessThan(families.indexOf('class="secondary-button"'));
    expect(families).toContain("Fill in");
    expect(club).toContain("Can Collecting Report");
    expect(club.indexOf("primary-button")).toBeLessThan(club.indexOf("Send a private link"));
  });

  it("shows an open application under club forms with Copy application link and no send or fill buttons", async () => {
    const html = await render();
    const club = html.slice(html.indexOf("club-forms-club"));
    const tlt = club.slice(club.indexOf("TLT Application"));
    expect(tlt).toContain("Copy application link");
    expect(tlt).toContain("https://events.imsda.test/clubs/forms/apply/tlt_apply");
    expect(tlt).not.toContain("/tlt_apply/new");
    expect(tlt).not.toContain("Send a private link");
    expect(html).not.toContain("tlt_apply/new");
  });

  it("hides an empty group", async () => {
    mocks.listTemplates.mockResolvedValue([template("can", "Can Collecting Report", "CLUB")]);
    const onlyClub = await render();
    expect(onlyClub).not.toContain("Forms for families and individuals");
    expect(onlyClub).toContain("Club forms: the club fills these in");
    mocks.listTemplates.mockResolvedValue([template("permission", "Permission Slip", "FAMILY")]);
    const onlyFamilies = await render();
    expect(onlyFamilies).toContain("Forms for families and individuals");
    expect(onlyFamilies).not.toContain("Club forms: the club fills these in");
  });

  it("keeps the filled-forms table, and shows applications received for the club", async () => {
    mocks.listSubmissions.mockResolvedValue([
      { id: "sub-1", templateName: "TLT Application", subjectName: "Jordan Sample", status: "SUBMITTED", enteredVia: "OPEN_APPLICATION", submittedAt: "2026-10-26T15:00:00.000Z", updatedAt: "2026-10-26T15:00:00.000Z" },
    ]);
    const html = await render();
    expect(html).toContain("Filled forms");
    expect(html).toContain("Jordan Sample");
    expect(html).toContain("open application");
  });

  it("keeps the private links table in the families group", async () => {
    mocks.listLinks.mockResolvedValue([
      { id: "link-1", delivery: "SENT", templateKey: "permission", templateName: "Permission Slip", recipientEmail: "parent@example.test", subjectName: "", state: "OPEN", expiresAt: "2026-11-01T00:00:00.000Z", usedAt: null, createdAt: "2026-10-20T00:00:00.000Z", submissionId: null },
    ]);
    const html = await render();
    const families = html.slice(html.indexOf("club-forms-families"), html.indexOf("club-forms-club"));
    expect(families).toContain("Private links you sent");
    expect(families).toContain("parent@example.test");
  });
});

describe("required forms on the director's Forms page (#1246)", () => {
  const item = (overrides: Record<string, unknown>) => ({ templateKey: "permission", name: "Permission Slip", requirement: "PER_ROLE_MEMBER_YEAR", roles: ["YOUTH"], status: "MISSING", missingMembers: [], memberCount: 0, ...overrides });

  it("shows nothing when no form is required", async () => {
    expect(await render()).not.toContain("Required forms for");
  });

  it("shows Missing and lists the members without one, each with a send-link action", async () => {
    mocks.listRoster.mockResolvedValue([{ id: "m1", name: "Amy Youth" }, { id: "m2", name: "Bo Youth" }]);
    mocks.getRequired.mockResolvedValue([{ id: "club-a", name: "Alpha", church: "", items: [item({ missingMembers: [{ id: "m2", name: "Bo Youth" }], memberCount: 2 })] }]);
    const html = await render();
    const required = html.slice(html.indexOf("club-forms-required"), html.indexOf("club-forms-families"));
    expect(required).toContain("Missing");
    expect(required).toContain("1 of 2 members are missing this form");
    expect(required).toContain("Bo Youth");
    expect(required).not.toContain("Amy Youth");
    expect(required).toContain("Send link");
  });

  it("shows Done when everyone has one, and Missing with Fill in for a club-level form", async () => {
    mocks.getRequired.mockResolvedValue([{ id: "club-a", name: "Alpha", church: "", items: [
      item({ status: "DONE", memberCount: 3 }),
      item({ templateKey: "can", name: "Can Collecting Report", requirement: "ONCE_PER_CLUB_YEAR", roles: [], status: "MISSING" }),
    ] }]);
    const html = await render();
    expect(html).toContain("Done");
    expect(html).toContain("All 3 members have one.");
    expect(html).toContain("/account/clubs/club-a/forms/can/new");
  });
});
