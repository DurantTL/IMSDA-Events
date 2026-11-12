import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/** The All forms hub: return paths, the owner filter and shared status words (#1571). Synthetic data only. */
const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  load: vi.fn(),
  listEvents: vi.fn(),
  templateFindMany: vi.fn(),
  submissionGroupBy: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); },
  usePathname: () => "/admin/forms",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/login-redirect", () => ({ staffLoginRedirectPath: async () => "/login" }));
vi.mock("@/modules/events/repository", () => ({ listEventsForUser: mocks.listEvents }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));
vi.mock("@/modules/forms-hub/load", () => ({ loadFormsHub: mocks.load }));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({ clubFormTemplate: { findMany: mocks.templateFindMany }, clubFormSubmission: { groupBy: mocks.submissionGroupBy } }),
}));

import AdminFormsPage from "@/app/(workspace)/admin/forms/page";
import { listClubFormsForHub } from "@/modules/club-forms/hub";
import { formsHubAddress, parseFormsHubReturn, withFormsHubReturn } from "@/modules/forms-hub/return";
import { filterFormsHubRows, formsHubEventOwners, parseFormsHubFilters, type FormsHubRow } from "@/modules/forms-hub/rows";

function row(overrides: Partial<FormsHubRow>): FormsHubRow {
  return { id: "x", kind: "GENERAL", name: "Form", eventName: null, eventId: null, status: "OPEN", statusLabel: "Open", responseCount: 0, lastResponseAt: null, editHref: "/e", responsesHref: "/r", ...overrides };
}

const rows: FormsHubRow[] = [
  row({ id: "club:1", kind: "CLUB", name: "Medical", status: "OPEN", statusLabel: "Open", editHref: "/admin/club-forms/medical", responsesHref: "/more/club-forms?form=medical" }),
  row({ id: "club:2", kind: "CLUB", name: "Trip", status: "CLOSED", statusLabel: "Closed", editHref: "/admin/club-forms/trip", responsesHref: "/more/club-forms?form=trip" }),
  row({ id: "information:g", kind: "GENERAL", name: "Survey", editHref: "/admin/information-forms/g", responsesHref: "/admin/information-forms/g/responses" }),
  row({ id: "information:e1", kind: "EVENT", name: "Feedback", eventName: "Synthetic Camp", eventId: "ev1", status: "NOT_OPEN", statusLabel: "Not open yet", editHref: "/information-forms?event=ev1&form=e1", responsesHref: "/information-forms/responses?event=ev1&form=e1" }),
  row({ id: "information:e2", kind: "EVENT", name: "Interest", eventName: "Alpha Retreat", eventId: "ev2", editHref: "/information-forms?event=ev2&form=e2", responsesHref: "/information-forms/responses?event=ev2&form=e2" }),
  row({ id: "information:e3", kind: "EVENT", name: "Meals", eventName: "Synthetic Camp", eventId: "ev1", editHref: "/information-forms?event=ev1&form=e3", responsesHref: "/information-forms/responses?event=ev1&form=e3" }),
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentSession.mockResolvedValue({ user: { id: "u", globalRole: "SYSTEM_ADMIN" } });
  mocks.load.mockResolvedValue(rows);
  mocks.listEvents.mockResolvedValue([]);
});

describe("return path parsing", () => {
  it("keeps a valid address and rebuilds it from the allowed parameters", () => {
    expect(parseFormsHubReturn("/admin/forms")).toEqual({ href: "/admin/forms", label: "Back to All forms" });
    expect(parseFormsHubReturn("/admin/forms?kind=EVENT&status=OPEN&owner=event%3Aev1&q=camp&sort=form&dir=desc&page=3")?.href)
      .toBe("/admin/forms?kind=EVENT&status=OPEN&owner=event%3Aev1&q=camp&sort=form&dir=desc&page=3");
  });

  it("drops unknown parameters and values of the wrong shape, including a nested returnTo", () => {
    expect(parseFormsHubReturn("/admin/forms?kind=EVENT&returnTo=%2Fadmin%2Fforms&evil=1&page=abc&dir=sideways&sort=drop")?.href).toBe("/admin/forms?kind=EVENT");
    expect(parseFormsHubReturn("/admin/forms?owner=event%3A%3Cscript%3E&status=bogus&page=0")?.href).toBe("/admin/forms");
  });

  it.each([
    "https://evil.example/admin/forms",
    "//evil.example/admin/forms",
    "/admin/forms//x",
    "/admin\\forms",
    "/\\evil.example",
    "/api/admin/forms",
    "/admin/clubs",
    "/admin/forms/extra",
    "/admin/forms#top",
    "%2Fadmin%2Fforms",
    "/admin%2Fforms",
    "/admin/forms%2F%2Fevil",
    "/admin/forms%5Cevil",
    "javascript:alert(1)",
    "",
  ])("drops %s", (value) => {
    expect(parseFormsHubReturn(value)).toBeNull();
  });

  it("drops a missing or repeated value", () => {
    expect(parseFormsHubReturn(undefined)).toBeNull();
    expect(parseFormsHubReturn(["/admin/forms", "/admin/forms"])).toBeNull();
  });

  it("builds the address for the current filters, sort and page, and round-trips it", () => {
    const address = formsHubAddress({ kind: "EVENT", status: "CLOSED", owner: "event:ev1", q: "a b", sort: "status", dir: "desc", page: 2 });
    expect(parseFormsHubReturn(address)?.href).toBe(address);
    expect(formsHubAddress({})).toBe("/admin/forms");
    expect(formsHubAddress({ page: 1 })).toBe("/admin/forms");
  });

  it("adds returnTo to a link, with ? or & as needed", () => {
    expect(withFormsHubReturn("/admin/club-forms/medical", "/admin/forms?kind=CLUB")).toBe("/admin/club-forms/medical?returnTo=%2Fadmin%2Fforms%3Fkind%3DCLUB");
    expect(withFormsHubReturn("/information-forms?event=ev1&form=e1", "/admin/forms")).toBe("/information-forms?event=ev1&form=e1&returnTo=%2Fadmin%2Fforms");
  });
});

describe("rows carry the way back", () => {
  it("puts the current address on every row's Edit and Responses links", async () => {
    const html = renderToStaticMarkup(await AdminFormsPage({ searchParams: Promise.resolve({ kind: "EVENT", sort: "form", dir: "desc", junk: "1" }) }));
    const back = encodeURIComponent("/admin/forms?kind=EVENT&sort=form&dir=desc");
    expect(html).toContain(`href="/information-forms?event=ev1&amp;form=e1&amp;returnTo=${back}"`);
    expect(html).toContain(`href="/information-forms/responses?event=ev2&amp;form=e2&amp;returnTo=${back}"`);
  });

  it("covers club and general rows too, and keeps the owner filter in the address", async () => {
    const html = renderToStaticMarkup(await AdminFormsPage({ searchParams: Promise.resolve({}) }));
    const back = encodeURIComponent("/admin/forms");
    for (const href of ["/admin/club-forms/medical", "/more/club-forms?form=medical", "/admin/information-forms/g", "/admin/information-forms/g/responses"]) {
      expect(html).toContain(`href="${href}${href.includes("?") ? "&amp;" : "?"}returnTo=${back}"`);
    }
    const owned = renderToStaticMarkup(await AdminFormsPage({ searchParams: Promise.resolve({ owner: "CLUB" }) }));
    expect(owned).toContain(`returnTo=${encodeURIComponent("/admin/forms?owner=CLUB")}`);
  });
});

describe("owner filter", () => {
  const names = (filters: Parameters<typeof parseFormsHubFilters>[0]) => filterFormsHubRows(rows, parseFormsHubFilters(filters)).map((r) => r.name);

  it("filters clubs, conference and one event", () => {
    expect(names({ owner: "CLUB" })).toEqual(["Medical", "Trip"]);
    expect(names({ owner: "GENERAL" })).toEqual(["Survey"]);
    expect(names({ owner: "event:ev1" })).toEqual(["Feedback", "Meals"]);
    expect(names({})).toHaveLength(6);
  });

  it("shows no match for a stale event id and ignores a malformed one", () => {
    expect(names({ owner: "event:gone" })).toEqual([]);
    expect(parseFormsHubFilters({ owner: "event:" }).owner).toBeNull();
    expect(parseFormsHubFilters({ owner: "event:a b" }).owner).toBeNull();
    expect(parseFormsHubFilters({ owner: "nonsense" }).owner).toBeNull();
  });

  it("lists one option per event that owns a form, by name", () => {
    expect(formsHubEventOwners(rows)).toEqual([{ value: "event:ev2", label: "Alpha Retreat" }, { value: "event:ev1", label: "Synthetic Camp" }]);
  });

  it("renders the options, and the empty state with Clear filters for a stale event", async () => {
    const html = renderToStaticMarkup(await AdminFormsPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("All owners");
    expect(html).toContain('<option value="event:ev1">Synthetic Camp</option>');
    expect(html).toContain("Conference (general information forms)");
    const stale = renderToStaticMarkup(await AdminFormsPage({ searchParams: Promise.resolve({ owner: "event:gone" }) }));
    expect(stale).toContain("No forms match");
    expect(stale).toContain('href="/admin/forms">Clear filters');
  });
});

describe("shared status words", () => {
  it("shows a club form that is on as Open and one that is off as Closed", async () => {
    mocks.templateFindMany.mockResolvedValue([{ id: "t1", key: "medical", name: "Medical", enabled: true }, { id: "t2", key: "trip", name: "Trip", enabled: false }]);
    mocks.submissionGroupBy.mockResolvedValue([]);
    const club = await listClubFormsForHub();
    expect(club.map((r) => [r.status, r.statusLabel, r.eventId])).toEqual([["OPEN", "Open", null], ["CLOSED", "Closed", null]]);
  });

  it("groups club and information forms under the same status filter", () => {
    expect(filterFormsHubRows(rows, parseFormsHubFilters({ status: "OPEN" })).map((r) => r.name)).toEqual(["Medical", "Survey", "Interest", "Meals"]);
    expect(filterFormsHubRows(rows, parseFormsHubFilters({ status: "CLOSED" })).map((r) => r.name)).toEqual(["Trip"]);
  });

  it("names the status options Open, Not open yet and Closed", async () => {
    const html = renderToStaticMarkup(await AdminFormsPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('<option value="OPEN">Open</option>');
    expect(html).toContain('<option value="NOT_OPEN">Not open yet</option>');
    expect(html).toContain('<option value="CLOSED">Closed</option>');
    expect(html).not.toMatch(/On or open|Off or not open yet/);
  });
});

describe("target pages wire the back link", () => {
  const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");
  const pages: [string, RegExp][] = [
    ["app/(workspace)/admin/club-forms/[templateKey]/page.tsx", /<AdminPageHeader back=\{hubBack \?\? undefined\}/],
    ["app/(workspace)/more/club-forms/page.tsx", /\.\.\.\(hubBack \? \{ back: hubBack \} : \{\}\)/],
    ["app/(workspace)/information-forms/page.tsx", /<PageHeader title="Information forms" \{\.\.\.\(hubBack \? \{ back: hubBack \} : \{\}\)\} \/>/],
    ["app/(workspace)/information-forms/responses/page.tsx", /back=\{hubBack \?\? \{ href: informationListHref\(config\)/],
    ["app/(workspace)/admin/information-forms/[formId]/page.tsx", /<AdminSectionHeaderFor back=\{hubBack \?\? undefined\}/],
    ["app/(workspace)/admin/information-forms/[formId]/responses/page.tsx", /<AdminSectionHeaderFor back=\{hubBack \?\? undefined\}/],
  ];
  it.each(pages)("%s reads returnTo through the one helper", (path, wiring) => {
    const source = read(path);
    expect(source).toContain("parseFormsHubReturn(");
    expect(source).toMatch(wiring);
    // The raw value is never used as a link.
    expect(source).not.toMatch(/href=\{returnTo\}|back=\{\{ href: returnTo/);
  });

  it("leaves the access checks where they were", () => {
    expect(read("app/(workspace)/admin/information-forms/[formId]/page.tsx")).toContain('redirect("/no-access?from=system")');
    expect(read("app/(workspace)/information-forms/page.tsx")).toContain('permissions.includes("MANAGE_FORMS")');
    expect(read("app/(workspace)/information-forms/responses/page.tsx")).toContain('permissions.includes("MANAGE_FORMS")');
  });
});
