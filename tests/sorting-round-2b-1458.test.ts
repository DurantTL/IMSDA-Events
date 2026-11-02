import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Rule B1, round 2 part B (#1458): the admin, events and staff tables sort from their column headers. Synthetic data only.
 */
const mocks = vi.hoisted(() => ({ getCurrentSession: vi.fn(), load: vi.fn(), listTemplates: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); },
  usePathname: () => "/x",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/login-redirect", () => ({ staffLoginRedirectPath: async () => "/login" }));
vi.mock("@/modules/forms-hub/load", () => ({ loadFormsHub: mocks.load }));
vi.mock("@/modules/forms/form-template-library", () => ({ listFormTemplateLibrary: mocks.listTemplates }));
vi.mock("@/components/form-template-copy", () => ({ FormTemplateCopy: () => null }));

import AdminFormsPage from "@/app/(workspace)/admin/forms/page";
import AdminFormTemplatesPage from "@/app/(workspace)/admin/form-templates/page";
import { BackgroundCheckList } from "@/components/background-check-flags";
import { REQUEST_SORT_PLAIN, REQUEST_SORT_SENSITIVE } from "@/components/lodging-requests-workspace";
import { searchPageHref } from "@/lib/search-page-href";
import type { FormsHubRow } from "@/modules/forms-hub/rows";
import type { BackgroundFlag } from "@/modules/background-checks/repository";

const hubRow = (index: number): FormsHubRow => ({
  id: `f${index}`, kind: "GENERAL", name: `Form ${String(index).padStart(2, "0")}`, eventName: null, status: "OPEN", statusLabel: "Open",
  responseCount: index, lastResponseAt: null, editHref: "/e", responsesHref: "/r",
});
const formNames = (html: string) => [...html.matchAll(/<th[^>]*scope="row"[^>]*>(Form \d+)</g)].map((match) => match[1]);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentSession.mockResolvedValue({ user: { id: "u", globalRole: "SYSTEM_ADMIN" } });
});

describe("All forms: whitelisted server sort and the shared pager", () => {
  const render = async (query: Record<string, string>) => {
    mocks.load.mockResolvedValue([hubRow(1), hubRow(2), hubRow(3)]);
    return renderToStaticMarkup(await AdminFormsPage({ searchParams: Promise.resolve(query) }));
  };

  it("keeps the hub's own order when nobody has clicked, and for a junk or prototype sort key", async () => {
    for (const query of [{} as Record<string, string>, { sort: "__proto__" }, { sort: "constructor", dir: "desc" }, { sort: "name;drop table" }]) {
      expect(formNames(await render(query))).toEqual(["Form 01", "Form 02", "Form 03"]);
    }
  });

  it("sorts every row by a whitelisted column and says so", async () => {
    const html = await render({ sort: "responses", dir: "desc" });
    expect(formNames(html)).toEqual(["Form 03", "Form 02", "Form 01"]);
    expect(html).toContain("Sorted by responses, highest first.");
    expect(html).toContain('aria-sort="descending"');
    expect(html).toContain("sort=form");
  });

  it("pages the sorted list with the shared count line", async () => {
    mocks.load.mockResolvedValue(Array.from({ length: 60 }, (_, index) => hubRow(index + 1)));
    const html = renderToStaticMarkup(await AdminFormsPage({ searchParams: Promise.resolve({ sort: "responses", dir: "desc" }) }));
    expect(html).toContain("Showing 1–50 of 60 forms");
    expect(formNames(html)[0]).toBe("Form 60");
    expect(html).toContain("sort=responses&amp;dir=desc&amp;page=2");
  });
});

describe("Form templates: whitelisted server sort", () => {
  const template = (key: string, name: string, usedByForms: number) => ({ key, name, audience: "Events", version: 1, source: "CODE", usedByForms, unreadable: false, appCreated: false, updatedAt: null, updatedBy: null });
  it("orders by the whitelisted column and ignores anything else", async () => {
    mocks.listTemplates.mockResolvedValue([template("a", "Alpha", 1), template("b", "Beta", 5), template("c", "Gamma", 3)]);
    const names = (html: string) => [...html.matchAll(/scope="row">(Alpha|Beta|Gamma)/g)].map((match) => match[1]);
    const sorted = renderToStaticMarkup(await AdminFormTemplatesPage({ searchParams: Promise.resolve({ sort: "used", dir: "desc" }) }));
    expect(names(sorted)).toEqual(["Beta", "Gamma", "Alpha"]);
    const junk = renderToStaticMarkup(await AdminFormTemplatesPage({ searchParams: Promise.resolve({ sort: "__proto__" }) }));
    expect(names(junk)).toEqual(["Alpha", "Beta", "Gamma"]);
  });
});

describe("a converted client table", () => {
  const flag = (id: string, lastName: string): BackgroundFlag => ({
    attendeeId: id, personId: `p-${id}`, firstName: "Sam", lastName, attendeeType: "ADULT", clubName: "Test Club", organizationId: "c1",
    confirmationCode: `TEST-${id}`, registrationId: `r-${id}`, state: "MISSING", expiresOn: null, contactEmail: null, issuesNote: null, issueReasons: [],
  });

  it("renders sortable headers with the order unchanged until a click", () => {
    const html = renderToStaticMarkup(createElement(BackgroundCheckList, { people: [flag("1", "Zimmer"), flag("2", "Adams")] }));
    expect(html.indexOf("Zimmer")).toBeLessThan(html.indexOf("Adams"));
    expect(html).toContain('aria-sort="none"');
    expect(html).toContain("table-sort-button");
    expect(html).not.toContain("Sorted by");
  });
});

describe("sort keys are a fixed whitelist", () => {
  it("lists the accessibility columns of the lodging requests only for staff who may see them", () => {
    expect(Object.keys(REQUEST_SORT_PLAIN)).not.toContain("ground");
    expect(Object.keys(REQUEST_SORT_PLAIN)).not.toContain("accessible");
    expect(Object.keys(REQUEST_SORT_SENSITIVE)).toEqual(expect.arrayContaining(["ground", "accessible"]));
  });
});

describe("searchPageHref", () => {
  it("keeps every other param, leaves page 1 out and gives a second table its own page param", () => {
    expect(searchPageHref("/x", { q: "a", sort: "name", page: "3" }, 2)).toBe("/x?q=a&sort=name&page=2");
    expect(searchPageHref("/x", { q: "a", page: "3" }, 1)).toBe("/x?q=a");
    expect(searchPageHref("/x", { page: "4", balancesPage: "5" }, 2, { prefix: "balances" })).toBe("/x?page=4&balancesPage=2");
  });
});
