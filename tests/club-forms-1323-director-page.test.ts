import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** #1323: collapsible lists, Delete on unused links, Past years and Start the new year. Synthetic data only. */
const mocks = vi.hoisted(() => ({
  getAccess: vi.fn(),
  listTemplates: vi.fn(),
  listRoster: vi.fn(),
  listSubmissions: vi.fn(),
  listLinks: vi.fn(),
  getRequired: vi.fn(),
  yearState: vi.fn(),
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
vi.mock("@/modules/club-forms/year-start", () => ({ getClubFormsYearState: mocks.yearState }));

import ClubFormsPage from "@/app/(public)/account/(portal)/clubs/[organizationId]/forms/page";

const template = (key: string, name: string, fillMode: "FAMILY" | "CLUB") => ({ key, name, description: `${name} description`, fillMode });
const link = (overrides: Record<string, unknown>) => ({
  id: "link-1", delivery: "SENT", templateKey: "permission", templateName: "Permission Slip", recipientEmail: "parent@example.test", subjectName: "",
  state: "OPEN", expiresAt: "2026-11-15T00:00:00.000Z", usedAt: null, createdAt: "2026-10-20T00:00:00.000Z", clubYear: "2026-27", submissionId: null, ...overrides,
});
const filled = (overrides: Record<string, unknown>) => ({
  id: "sub-1", templateName: "Permission Slip", subjectName: "Jordan Sample", status: "SUBMITTED", enteredVia: "LINK",
  submittedAt: "2026-10-26T15:00:00.000Z", updatedAt: "2026-10-26T15:00:00.000Z", clubYear: "2026-27", ...overrides,
});
const render = async () => renderToStaticMarkup(await ClubFormsPage({ params: Promise.resolve({ organizationId: "club-a" }), searchParams: Promise.resolve({}) }) as React.ReactElement);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-29T15:00:00Z"));
  mocks.getAccess.mockResolvedValue({ state: "OPEN", club: { role: "DIRECTOR" } });
  mocks.listRoster.mockResolvedValue([]);
  mocks.listSubmissions.mockResolvedValue([]);
  mocks.listLinks.mockResolvedValue([]);
  mocks.getRequired.mockResolvedValue([{ id: "club-a", name: "Alpha", church: "", items: [] }]);
  mocks.yearState.mockResolvedValue({ yearStarted: false, hasEarlierYears: false });
  mocks.listTemplates.mockResolvedValue([template("permission", "Permission Slip", "FAMILY"), template("can", "Can Collecting Report", "CLUB")]);
});

describe("collapsible lists", () => {
  it("wraps the family list, the club list and Filled forms in open details with counts", async () => {
    mocks.listSubmissions.mockResolvedValue([filled({}), filled({ id: "sub-2" })]);
    const html = await render();
    expect(html).toMatch(/<details[^>]*open=""[^>]*><summary[^>]*>Family forms <span[^>]*>1 form<\/span>/);
    expect(html).toMatch(/<details[^>]*open=""[^>]*><summary[^>]*>Club forms <span[^>]*>1 form<\/span>/);
    expect(html).toMatch(/<summary[^>]*><h3>Filled forms<\/h3> <span[^>]*>2 forms<\/span>/);
    expect(html).toContain("Forms for families and individuals: send a link");
  });

  it("leaves Private links you sent as a plain section, outside any details", async () => {
    mocks.listLinks.mockResolvedValue([link({})]);
    const html = await render();
    const start = html.indexOf("Private links you sent");
    expect(start).toBeGreaterThan(-1);
    const before = html.slice(0, start);
    expect(before.lastIndexOf("<details")).toBeLessThanOrEqual(before.lastIndexOf("</details>"));
    expect(html.slice(start - 200, start)).not.toContain("<summary");
  });
});

describe("Delete on the links table", () => {
  it("shows Delete only on rows with no filled form", async () => {
    mocks.listLinks.mockResolvedValue([
      link({ id: "unused", templateName: "Unused Slip" }),
      link({ id: "answered", templateName: "Answered Slip", state: "USED", submissionId: "sub-9" }),
    ]);
    const html = await render();
    const rows = html.split("<tr").filter((row) => row.includes("Slip"));
    const unused = rows.find((row) => row.includes("Unused Slip"))!;
    const answered = rows.find((row) => row.includes("Answered Slip"))!;
    expect(unused).toContain("Delete");
    expect(unused).toContain(" the Unused Slip link");
    expect(answered).not.toContain("Delete");
    expect(answered).toContain("Open form");
  });
});

describe("Start the new year and Past years", () => {
  it("shows the button, with its help text, when earlier years exist and the year is not started", async () => {
    mocks.yearState.mockResolvedValue({ yearStarted: false, hasEarlierYears: true });
    mocks.listLinks.mockResolvedValue([link({ clubYear: "2025-26" })]);
    const html = await render();
    expect(html).toContain("Start the new year");
    expect(html).toContain("Move forms from earlier club years into Past years. Nothing is deleted.");
    expect(html).not.toContain("Past years</h3>");
    // Before the start, earlier forms still show in the current lists.
    expect(html).toContain("parent@example.test");
  });

  it("hides the button when there is nothing earlier, or the year is already started", async () => {
    expect(await render()).not.toContain("Start the new year");
    mocks.yearState.mockResolvedValue({ yearStarted: true, hasEarlierYears: true });
    expect(await render()).not.toContain("Start the new year");
  });

  it("moves earlier years into a closed Past years section, grouped newest first", async () => {
    mocks.yearState.mockResolvedValue({ yearStarted: true, hasEarlierYears: true });
    mocks.listLinks.mockResolvedValue([link({ id: "now" }), link({ id: "old", clubYear: "2025-26", recipientEmail: "old-parent@example.test" }), link({ id: "older", clubYear: "2024-25", recipientEmail: "older-parent@example.test" })]);
    mocks.listSubmissions.mockResolvedValue([filled({ id: "s-now" }), filled({ id: "s-old", clubYear: "2025-26", subjectName: "Old Sample" })]);
    const html = await render();
    const current = html.slice(0, html.indexOf('data-testid="past-years"'));
    const past = html.slice(html.indexOf('data-testid="past-years"'));
    expect(current).toContain("parent@example.test");
    expect(current).not.toContain("old-parent@example.test");
    expect(current).not.toContain("Old Sample");
    expect(past).toMatch(/<details class="[^"]*"><summary[^>]*><h3 id="club-forms-past">Past years<\/h3>/);
    expect(past.indexOf("2025-26")).toBeLessThan(past.indexOf("2024-25"));
    expect(past).toContain("old-parent@example.test");
    expect(past).toContain("Old Sample");
    expect(past).toContain("/account/clubs/club-a/forms/submissions/s-old");
    expect(past).toContain("View and print");
    // Each year is its own closed details.
    expect(past.match(/data-club-year="/g)).toHaveLength(2);
    expect(past).not.toMatch(/<details[^>]*open=""/);
  });
});
