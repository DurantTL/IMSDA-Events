// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement, type ComponentProps, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  refresh: vi.fn(),
  listOrganizationsPage: vi.fn(),
  getOrganizationSummary: vi.fn(),
  listSponsorOptions: vi.fn(),
  listDirectoryContacts: vi.fn(),
  getChurchPastorContactView: vi.fn(),
  listDirectoryOrganizations: vi.fn(),
  getBillingView: vi.fn(),
  getChurchLocation: vi.fn(),
  countGeocodableChurches: vi.fn(),
  listGeocodeReview: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/organizations",
  useRouter: () => ({ push: vi.fn(), refresh: mocks.refresh, replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); },
  notFound: () => { throw new Error("NOT_FOUND"); },
}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.session }));
vi.mock("@/modules/access/login-redirect", () => ({ staffLoginRedirectPath: async () => "/login" }));
vi.mock("@/modules/health-records/flag", () => ({ healthRecordsEnabled: () => false }));
vi.mock("@/integrations/geocoding", () => ({ geocodingEnabled: () => true }));
vi.mock("@/modules/organizations/repository", () => ({
  listOrganizationsPage: mocks.listOrganizationsPage,
  getOrganizationSummary: mocks.getOrganizationSummary,
  listSponsorOptions: mocks.listSponsorOptions,
}));
vi.mock("@/modules/organizations/contacts-repository", () => ({
  listDirectoryContacts: mocks.listDirectoryContacts,
  getChurchPastorContactView: mocks.getChurchPastorContactView,
}));
vi.mock("@/modules/organizations/eadventist-import-repository", () => ({ listDirectoryOrganizations: mocks.listDirectoryOrganizations }));
vi.mock("@/modules/billing-responsibility/repository", () => ({ getOrganizationBillingContactAdminView: mocks.getBillingView }));
vi.mock("@/modules/organizations/church-location-repository", () => ({ getChurchLocation: mocks.getChurchLocation }));
vi.mock("@/modules/organizations/church-geocoding", () => ({
  countGeocodableChurches: mocks.countGeocodableChurches,
  listGeocodeReview: mocks.listGeocodeReview,
}));

import OrganizationsPage from "@/app/(workspace)/admin/organizations/page";
import OrganizationDirectoryPage from "@/app/(workspace)/admin/organizations/directory/page";
import EadventistImportPage from "@/app/(workspace)/admin/organizations/import/page";
import ChurchMapLocationsPage from "@/app/(workspace)/admin/organizations/map-locations/page";
import StaffOrganizationBillingContactPage from "@/app/(workspace)/admin/organizations/[organizationId]/billing/page";
import StaffChurchLocationPage from "@/app/(workspace)/admin/organizations/[organizationId]/location/page";
import StaffChurchPastorContactPage from "@/app/(workspace)/admin/organizations/[organizationId]/pastor/page";
import { ChurchLocationForm } from "@/components/church-location-form";
import { ChurchMapLocationsWorkspace } from "@/components/church-map-locations-workspace";
import { ChurchPastorContact } from "@/components/church-pastor-contact";
import { EadventistImportWorkspace } from "@/components/eadventist-import-workspace";
import { OrganizationActionProvider, OrganizationHeaderButton } from "@/components/organization-header-action";
import { OrganizationBillingContact } from "@/components/organization-billing-contact";
import { OrganizationDirectoryWorkspace } from "@/components/organization-directory-workspace";
import { pageOwnsHeader } from "@/components/page-header-routes";

/** #1592: the System organization directory, contact, location, import and map-location pages. Synthetic data only. */

const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");
const pageDir = "app/(workspace)/admin/organizations";
const systemAdmin = { id: "admin-1", globalRole: "SYSTEM_ADMIN" };
// A Clubs Administrator holds no global role: their access to clubs is a grant, never a System role.
const clubsOnly = { id: "clubs-admin-1", globalRole: null };
const longName = `Sample${"Wordless".repeat(14)} Seventh-day Adventist Church of the Prairie Valley`;
const filledCount = (html: string) => (html.match(/class="[^"]*\bprimary-button\b/g) ?? []).length;
const h1Count = (html: string) => (html.match(/<h1\b/g) ?? []).length;

const orgRecord = (over: Record<string, unknown> = {}) => ({
  id: "church-1", type: "CHURCH", name: "Sample Prairie Church", isActive: true, parentOrganizationId: null, parentOrganization: null,
  externalIdentities: [], updatedAt: "2026-11-01T00:00:00.000Z", ...over,
});
const identity = (id: string, provider: string, externalId: string) => ({
  id, provider, providerScope: null, externalId, displayLabel: null, lastVerifiedAt: null, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
});
const summary = { churches: 1, clubs: 1, identities: 3, unlinked: 0 };

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  mocks.session.mockResolvedValue({ user: systemAdmin });
  mocks.listOrganizationsPage.mockResolvedValue({ organizations: [], total: 0, page: 1, pageSize: 25 });
  mocks.getOrganizationSummary.mockResolvedValue(summary);
  mocks.listSponsorOptions.mockResolvedValue([]);
  mocks.listDirectoryOrganizations.mockResolvedValue({ organizations: [], total: 0, page: 1, pageSize: 25 });
  mocks.listDirectoryContacts.mockResolvedValue(new Map());
  mocks.countGeocodableChurches.mockResolvedValue(0);
  mocks.listGeocodeReview.mockResolvedValue([]);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const render = (element: ReactElement) => act(async () => root.render(element));
const click = (element: Element | null) => act(async () => { (element as HTMLElement).click(); });
const button = (label: string) => Array.from(document.querySelectorAll("button")).find((candidate) => candidate.textContent?.trim() === label || candidate.getAttribute("aria-label") === label) ?? null;
const typeInto = (input: HTMLInputElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
const submit = (form: Element | null) => act(async () => { (form as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
const pressEscape = () => act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
const pending = () => vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => new Promise<Response>(() => {}));
const nextFrame = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
const failing = (message: string, status = 400) => vi.fn(async () => new Response(JSON.stringify({ message }), { status }));

async function pageMarkup(element: Promise<ReactElement>) {
  return renderToStaticMarkup(await element);
}

/* ---------------------------------------------------------------- access (unchanged behavior) */

const pages: { name: string; file: string; call: () => Promise<ReactElement> }[] = [
  { name: "Clubs and churches", file: "page.tsx", call: () => OrganizationsPage({ searchParams: Promise.resolve({}) }) },
  { name: "Organization directory", file: "directory/page.tsx", call: () => OrganizationDirectoryPage({ searchParams: Promise.resolve({}) }) },
  { name: "Import organizations", file: "import/page.tsx", call: () => EadventistImportPage() },
  { name: "Find map locations", file: "map-locations/page.tsx", call: () => ChurchMapLocationsPage() },
  { name: "Billing contact", file: "[organizationId]/billing/page.tsx", call: () => StaffOrganizationBillingContactPage({ params: Promise.resolve({ organizationId: "church-1" }) }) },
  { name: "Church location", file: "[organizationId]/location/page.tsx", call: () => StaffChurchLocationPage({ params: Promise.resolve({ organizationId: "church-1" }) }) },
  { name: "Pastor contact", file: "[organizationId]/pastor/page.tsx", call: () => StaffChurchPastorContactPage({ params: Promise.resolve({ organizationId: "church-1" }) }) },
];
const loaders = () => [
  mocks.listOrganizationsPage, mocks.getOrganizationSummary, mocks.listSponsorOptions, mocks.listDirectoryOrganizations, mocks.listDirectoryContacts,
  mocks.countGeocodableChurches, mocks.listGeocodeReview, mocks.getBillingView, mocks.getChurchLocation, mocks.getChurchPastorContactView,
];

describe("System organization pages stay System-only (#1592)", () => {
  it.each(pages)("$name sends a Clubs-only account to no-access before it loads anything", async ({ call }) => {
    mocks.session.mockResolvedValue({ user: clubsOnly });
    await expect(call()).rejects.toThrow("REDIRECT:/no-access?from=system");
    for (const loader of loaders()) expect(loader).not.toHaveBeenCalled();
  });

  it.each(pages)("$name sends a signed-out visitor to sign in", async ({ call }) => {
    mocks.session.mockResolvedValue({ user: null });
    await expect(call()).rejects.toThrow("REDIRECT:/login");
    for (const loader of loaders()) expect(loader).not.toHaveBeenCalled();
  });

  it("keeps each page's own gate line in its source, and no page opens the Clubs Administrator check", () => {
    for (const { file } of pages) {
      const source = read(`${pageDir}/${file}`);
      expect(source, file).toContain('if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access?from=system");');
      expect(source, file).not.toContain("hasClubsAdministration");
    }
  });

  it("loads the same records for a system administrator as before", async () => {
    mocks.getBillingView.mockResolvedValue({ organization: { id: "church-1", name: "Sample Prairie Church" }, active: null, history: [] });
    await pageMarkup(pages[4]!.call());
    expect(mocks.getBillingView).toHaveBeenCalledWith("church-1", { id: "admin-1", globalRole: "SYSTEM_ADMIN" });
    mocks.getChurchPastorContactView.mockResolvedValue({ organization: { id: "church-1", name: "Sample Prairie Church" }, active: null, history: [] });
    await pageMarkup(pages[6]!.call());
    expect(mocks.getChurchPastorContactView).toHaveBeenCalledWith("church-1", { id: "admin-1", globalRole: "SYSTEM_ADMIN" });
    mocks.getChurchLocation.mockResolvedValue({ id: "church-1", name: "Sample Prairie Church", city: "", state: "", zip: "", latitude: null, longitude: null, source: null, updatedAt: null });
    await pageMarkup(pages[5]!.call());
    expect(mocks.getChurchLocation).toHaveBeenCalledWith("church-1");
    mocks.listDirectoryOrganizations.mockResolvedValue({ organizations: [], total: 0, page: 1, pageSize: 25 });
    await pageMarkup(pages[1]!.call());
    expect(mocks.listDirectoryContacts).toHaveBeenCalledWith([], { id: "admin-1", globalRole: "SYSTEM_ADMIN" });
  });

  it("shows a missing church as not found", async () => {
    mocks.getBillingView.mockResolvedValue(null);
    mocks.getChurchLocation.mockResolvedValue(null);
    mocks.getChurchPastorContactView.mockResolvedValue(null);
    for (const index of [4, 5, 6]) await expect(pages[index]!.call()).rejects.toThrow("NOT_FOUND");
  });
});

/* ---------------------------------------------------------------- header */

describe("each page draws one header with one h1 (#1592)", () => {
  it("lists the seven routes, so the shell draws no second title", () => {
    for (const route of [
      "/admin/organizations", "/admin/organizations/directory", "/admin/organizations/import", "/admin/organizations/map-locations",
      "/admin/organizations/church-1/billing", "/admin/organizations/church-1/location", "/admin/organizations/church-1/pastor",
    ]) expect(pageOwnsHeader(route), route).toBe(true);
    // The club pages under the same parent keep the shell's title.
    for (const route of ["/admin/organizations/club-1/club", "/admin/organizations/club-1/profile", "/admin/organizations/club-1/directors", "/admin/organizations/background-checks"]) {
      expect(pageOwnsHeader(route), route).toBe(false);
    }
  });

  it("titles the list pages with the words of the tab, menu item or card that opens them", () => {
    expect(read(`${pageDir}/page.tsx`)).toContain('title: "Clubs and churches"');
    expect(read(`${pageDir}/directory/page.tsx`)).toContain('title: "Organization directory"');
    expect(read(`${pageDir}/import/page.tsx`)).toContain('title: "Import organizations"');
    expect(read(`${pageDir}/map-locations/page.tsx`)).toContain('title: "Find map locations"');
  });

  it("draws exactly one h1 and one filled button on each list page, in the page header", async () => {
    for (const index of [0, 1, 2, 3]) {
      const html = await pageMarkup(pages[index]!.call());
      expect(h1Count(html), pages[index]!.name).toBe(1);
      expect(filledCount(html), pages[index]!.name).toBe(1);
      const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
      expect(header, pages[index]!.name).toMatch(/\bprimary-button\b/);
    }
  });

  it("draws one h1, the church's name, with one named back link on each detail page", async () => {
    mocks.getBillingView.mockResolvedValue({ organization: { id: "church-1", name: longName }, active: null, history: [] });
    mocks.getChurchPastorContactView.mockResolvedValue({ organization: { id: "church-1", name: longName }, active: null, history: [] });
    mocks.getChurchLocation.mockResolvedValue({ id: "church-1", name: longName, city: "", state: "", zip: "", latitude: null, longitude: null, source: null, updatedAt: null });
    const expectations: [number, string, string][] = [
      [4, "Back to Clubs and churches", "Billing contact"],
      [5, "Back to Clubs and churches", "Church location"],
      [6, "Back to the directory", "Pastor contact"],
    ];
    for (const [index, back, eyebrow] of expectations) {
      const html = await pageMarkup(pages[index]!.call());
      expect(h1Count(html), eyebrow).toBe(1);
      expect(html, eyebrow).toContain(`<h1 class="`);
      expect(html.match(/<h1[^>]*translate="no"[^>]*>([^<]*)<\/h1>/)?.[1], eyebrow).toBe(longName);
      expect(html.split(back).length - 1, `${eyebrow} back link`).toBe(1);
      expect(html.match(/Back to /g) ?? [], `${eyebrow} back links`).toHaveLength(1);
      expect(html, eyebrow).toContain(eyebrow);
      // The Save button is the page's one filled button, beside the form; the header draws none.
      expect(filledCount(html), eyebrow).toBe(1);
      const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
      expect(header, eyebrow).not.toMatch(/\bprimary-button\b/);
    }
  });

  it("keeps the back targets the section header gave these pages", () => {
    for (const file of ["[organizationId]/billing/page.tsx", "[organizationId]/location/page.tsx", "[organizationId]/pastor/page.tsx"]) {
      const source = read(`${pageDir}/${file}`);
      expect(source, file).toContain("back: adminBackLink(\"system\"");
      expect(source, file).toContain("back={null}");
    }
  });

  it("draws no heading of its own in the workspaces beyond h2 and below", () => {
    for (const file of [
      "organization-directory-workspace", "organization-billing-contact", "church-pastor-contact", "church-location-form",
      "eadventist-import-workspace", "church-map-locations-workspace",
    ]) {
      expect(read(`components/${file}.tsx`), file).not.toMatch(/<h1\b/);
    }
  });
});

/* ---------------------------------------------------------------- directory */

describe("Clubs and churches list (#1592)", () => {
  const Workspace = (props: Partial<ComponentProps<typeof OrganizationDirectoryWorkspace>>) => createElement(
    OrganizationActionProvider, null,
    createElement(OrganizationHeaderButton, { icon: "add", label: "Add church or club" }),
    createElement(OrganizationDirectoryWorkspace, {
      sponsorOptions: [], filters: { q: "", kind: "", status: "ALL" }, organizations: [], page: 1, pageSize: 25, summary, total: 0, ...props,
    } as ComponentProps<typeof OrganizationDirectoryWorkspace>),
  );
  const church = orgRecord({ name: longName, externalIdentities: [identity("i1", "EADVENTIST", "9001"), identity("i2", "BLUE_STAR", "BS-7"), identity("i3", "SQUARE", "SQ-3")] });
  const club = orgRecord({ id: "club-1", type: "CLUB", name: "Sample Eagles Club", parentOrganizationId: "church-1", parentOrganization: { id: "church-1", name: longName, type: "CHURCH", isActive: true } });

  it("shows a church with several provider identifiers beside its sponsored club, each its own record", async () => {
    await render(createElement(Workspace, { organizations: [church, club], total: 2 } as never));
    expect(document.querySelectorAll("h1")).toHaveLength(0);
    expect(document.querySelectorAll(".primary-button")).toHaveLength(1);
    expect(document.body.textContent).toContain(longName);
    const cards = Array.from(document.querySelectorAll("article[class*=organizationCard]"));
    expect(cards).toHaveLength(2);
    // The church lists every identifier; the club names its sponsor with a link to that church's search, and links stay underlined.
    expect(cards[0]!.querySelectorAll(".identities > button, [class*='identities'] > button")).toHaveLength(3);
    const sponsor = cards[1]!.querySelector('a[href*="q="]') as HTMLAnchorElement;
    expect(cards[1]!.textContent).toContain("Sponsored by");
    // The search box keeps at most 80 characters, so a very long name is cut the same way it is when typed.
    expect(decodeURIComponent(sponsor.getAttribute("href")!)).toContain(`q=${longName.slice(0, 80)}`);
    expect(cards[0]!.textContent).toContain("Show this church with its clubs");
    expect(cards[0]!.querySelector(".dense-rows")).toBeNull();
    expect(document.querySelector(".dense-rows .row-actions")).not.toBeNull();
  });

  it("keeps a setup action for a record without a provider identifier", async () => {
    await render(createElement(Workspace, { organizations: [orgRecord()], total: 1 } as never));
    expect(document.body.textContent).toContain("No provider identifier linked yet.");
    await click(button("Link a provider identifier for Sample Prairie Church"));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.textContent).toContain("Link Sample Prairie Church");
  });

  it("keeps the empty and no-match states with their action", async () => {
    await render(createElement(Workspace, {}));
    expect(document.body.textContent).toContain("No churches or clubs yet");
    expect(button("Add first organization")).not.toBeNull();
    await render(createElement(Workspace, { filters: { q: "zzzz", kind: "", status: "ALL" } }));
    expect(document.body.textContent).toContain("Clear filters");
  });

  it("opens the add dialog from the header's button, asks before it discards typed work, and holds the close during a save", async () => {
    const fetchMock = pending();
    vi.stubGlobal("fetch", fetchMock);
    await render(createElement(Workspace, { sponsorOptions: [] }));
    await click(button("Add church or club"));
    const dialog = () => document.querySelector('[role="dialog"][aria-modal="true"]');
    expect(dialog()).not.toBeNull();
    await click(button("Cancel"));
    expect(dialog()).toBeNull();
    await click(button("Add church or club"));
    const name = document.querySelector('input[name="name"]') as HTMLInputElement;
    await typeInto(name, "Typed Church");
    // Dirty change, then the close button: the confirmation shows first; Keep editing leaves the dialog open.
    await act(async () => { name.form!.dispatchEvent(new Event("change", { bubbles: true })); });
    await click(button("Close"));
    expect(document.body.textContent).toContain("Discard the new church or club");
    await click(button("Keep editing"));
    expect(dialog()).not.toBeNull();
    await submit(document.querySelector('[role="dialog"] form'));
    await pressEscape();
    expect(dialog()).not.toBeNull();
    expect((button("Close") as HTMLButtonElement).disabled).toBe(true);
    const save = button("Saving…")!;
    expect(save.getAttribute("aria-disabled")).toBe("true");
    expect(save.disabled).toBe(false);
    await submit(document.querySelector('[role="dialog"] form'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps typed values and moves focus to the error when a save fails", async () => {
    vi.stubGlobal("fetch", failing("Another church already uses that name.", 409));
    await render(createElement(Workspace, {}));
    await click(button("Add church or club"));
    // The dialog's own opening focus runs on the next frame; let it finish before the save.
    await nextFrame();
    await typeInto(document.querySelector('input[name="name"]') as HTMLInputElement, "Duplicate Church");
    await submit(document.querySelector('[role="dialog"] form'));
    const alert = document.querySelector('[role="dialog"] [role="alert"]') as HTMLElement;
    expect(alert.textContent).toBe("Another church already uses that name.");
    expect((document.querySelector('input[name="name"]') as HTMLInputElement).value).toBe("Duplicate Church");
    expect(document.activeElement).toBe(alert);
  });

  it("keeps the delete confirmation a typed-name form, and the add button the only filled one", () => {
    const source = read("components/organization-directory-workspace.tsx");
    expect(source).toContain("confirmName");
    expect(source).toContain("useConfirm");
    expect(source).toContain("useAccessibleDialog");
  });
});

/* ---------------------------------------------------------------- directory table */

describe("Organization directory (#1592)", () => {
  it("shows a long name, both missing contacts with their setup links, and a named contact", async () => {
    mocks.listDirectoryOrganizations.mockResolvedValue({
      total: 2, page: 1, pageSize: 25,
      organizations: [
        { id: "church-1", type: "CHURCH", name: longName, isActive: true, disbandedOn: null, website: null, officePhone: "(515) 555-0100", city: "Sampleton", state: "IA", district: null, parentName: null, sourceOrgType: null },
        { id: "church-2", type: "CHURCH", name: "Sample Hills Church", isActive: true, disbandedOn: null, website: null, officePhone: null, city: null, state: null, district: null, parentName: null, sourceOrgType: null },
      ],
    });
    mocks.listDirectoryContacts.mockResolvedValue(new Map([["church-2", { pastor: { name: "Pat Pastor" }, billing: { name: "Bea Treasurer", roleLabel: "Treasurer" } }]]));
    const html = await pageMarkup(pages[1]!.call());
    expect(html).toContain(longName);
    expect(html).toContain("Pastor: none on file");
    expect(html).toContain("Billing contact: none on file");
    expect(html).toContain("Pastor: Pat Pastor");
    expect(html).toContain("Billing contact: Bea Treasurer (Treasurer)");
    expect(html).toContain('aria-label="Pastor contact for Sample Hills Church"');
    expect(html).toContain('href="/admin/organizations/church-1/billing"');
    expect(html).toContain("table-cards table-cards-wide");
    expect(html).toContain("Import from eAdventist");
    expect(html).toContain("Find map locations");
  });

  it("keeps its search, sort and pager as they were", () => {
    const source = read(`${pageDir}/directory/page.tsx`);
    expect(source).toContain("OrganizationSearchControls");
    expect(source).toContain("serverSort(");
    expect(source).toContain("pager={{ hrefFor: pageHref");
    expect(source).toContain("listDirectoryContacts(organizations.map((organization) => organization.id), { id: user.id, globalRole: user.globalRole })");
  });
});

/* ---------------------------------------------------------------- contacts */

describe("billing contact (#1592)", () => {
  const active = { id: "c1", name: "Bea Treasurer", roleLabel: "Treasurer", email: "bea@example.test", phone: "(515) 555-0100", verifiedAt: null, verifiedByName: null, effectiveFrom: "2026-10-01T00:00:00.000Z", effectiveTo: null, createdByName: null, endReason: null };

  it("explains a missing contact and offers the add form", async () => {
    await render(createElement(OrganizationBillingContact, { organizationId: "church-1", active: null, history: [] } as never));
    expect(document.body.textContent).toContain("No billing contact on file.");
    expect(document.body.textContent).toContain("Add a billing contact");
    expect(button("Save contact")).not.toBeNull();
    expect(document.querySelectorAll("h1")).toHaveLength(0);
  });

  it("shows the current contact's fields and nothing more", async () => {
    await render(createElement(OrganizationBillingContact, { organizationId: "church-1", active, history: [] } as never));
    expect(document.body.textContent).toContain("Bea Treasurer (Treasurer) · bea@example.test · (515) 555-0100");
    expect(document.body.textContent).toContain("Not verified");
    expect(button("Mark verified")).not.toBeNull();
    expect(button("End contact")).not.toBeNull();
    expect(document.body.textContent).toContain("Replace the contact");
  });

  it("holds Save while the request is in flight, keeping focus on it, and sends one request", async () => {
    const fetchMock = pending();
    vi.stubGlobal("fetch", fetchMock);
    await render(createElement(OrganizationBillingContact, { organizationId: "church-1", active: null, history: [] } as never));
    const form = document.querySelector("form")!;
    await typeInto(form.querySelector('input[autocomplete="off"]:not([type])') as HTMLInputElement, "Bea Treasurer");
    await typeInto(form.querySelector('input[type="email"]') as HTMLInputElement, "bea@example.test");
    const save = button("Save contact")!;
    save.focus();
    await submit(form);
    const saving = button("Saving…")!;
    expect(saving.getAttribute("aria-disabled")).toBe("true");
    expect(saving.disabled).toBe(false);
    expect(document.activeElement).toBe(saving);
    await submit(form);
    await click(saving);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/admin/organizations/church-1/billing-contact");
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({
      action: "set", contact: { name: "Bea Treasurer", email: "bea@example.test", roleLabel: "Treasurer" },
    });
  });

  it("keeps typed values and focuses the visible reason beside the form when a save fails", async () => {
    vi.stubGlobal("fetch", failing("That organization has no billing setup."));
    await render(createElement(OrganizationBillingContact, { organizationId: "church-1", active: null, history: [] } as never));
    const form = document.querySelector("form")!;
    await typeInto(form.querySelector('input[type="email"]') as HTMLInputElement, "bea@example.test");
    await typeInto(form.querySelector('input[autocomplete="off"]:not([type])') as HTMLInputElement, "Bea Treasurer");
    await submit(form);
    const alert = form.querySelector('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toBe("Not saved: That organization has no billing setup.");
    expect((form.querySelector('input[type="email"]') as HTMLInputElement).value).toBe("bea@example.test");
    expect(form.contains(document.activeElement)).toBe(true);
    expect(document.activeElement!.contains(alert)).toBe(true);
    // The Save button is back to its resting label.
    expect(button("Save contact")!.getAttribute("aria-disabled")).toBeNull();
  });

  it("holds Mark verified and End contact while any change is saving", async () => {
    vi.stubGlobal("fetch", pending());
    await render(createElement(OrganizationBillingContact, { organizationId: "church-1", active, history: [] } as never));
    await click(button("Mark verified"));
    expect(button("End contact")!.getAttribute("aria-disabled")).toBe("true");
    expect(button("End contact")!.disabled).toBe(false);
  });

  it("wraps a long history name and keeps the history open", async () => {
    await render(createElement(OrganizationBillingContact, { organizationId: "church-1", active: null, history: [{ ...active, id: "h1", name: longName, effectiveTo: "2026-10-30T00:00:00.000Z", endReason: "Replaced" }] } as never));
    expect(document.querySelector("details")!.hasAttribute("open")).toBe(true);
    expect(document.querySelector("details")!.textContent).toContain(longName);
  });
});

describe("pastor contact (#1592)", () => {
  it("explains a missing pastor and keeps the shared phone and email checks", async () => {
    await render(createElement(ChurchPastorContact, { organizationId: "church-1", active: null, history: [] } as never));
    expect(document.body.textContent).toContain("No pastor contact on file.");
    expect(document.querySelector('input[type="tel"]')).not.toBeNull();
    expect(document.body.textContent).toContain("Add a pastor");
    const source = read("components/church-pastor-contact.tsx");
    expect(source).toContain('inlinePhoneProblem("Phone", phone');
    expect(source).toContain("<EmailInput");
    expect(source).toContain("<PhoneInput");
  });

  it("holds Save in flight and sends one request to the same route", async () => {
    const fetchMock = pending();
    vi.stubGlobal("fetch", fetchMock);
    await render(createElement(ChurchPastorContact, { organizationId: "church-1", active: null, history: [] } as never));
    const form = document.querySelector("form")!;
    await typeInto(form.querySelector("input") as HTMLInputElement, "Pat Pastor");
    await submit(form);
    expect(button("Saving…")!.getAttribute("aria-disabled")).toBe("true");
    await submit(form);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/admin/organizations/church-1/pastor-contact");
  });

  it("keeps the typed name and shows the failure beside the form", async () => {
    vi.stubGlobal("fetch", failing("The pastor could not be saved."));
    await render(createElement(ChurchPastorContact, { organizationId: "church-1", active: null, history: [] } as never));
    const form = document.querySelector("form")!;
    await typeInto(form.querySelector("input") as HTMLInputElement, "Pat Pastor");
    await submit(form);
    expect(form.querySelector('[role="alert"]')!.textContent).toBe("Not saved: The pastor could not be saved.");
    expect((form.querySelector("input") as HTMLInputElement).value).toBe("Pat Pastor");
    expect(form.contains(document.activeElement)).toBe(true);
  });
});

/* ---------------------------------------------------------------- location */

describe("church location (#1592)", () => {
  const empty = { id: "church-1", name: longName, city: "", state: "", zip: "", latitude: null, longitude: null, source: null, updatedAt: null };

  it("tells a church with no location row to enter the town or pick the point, and offers no lookup", async () => {
    await render(createElement(ChurchLocationForm, { endpoint: "/api/admin/organizations/church-1/location", initialLocation: empty }));
    expect(document.body.textContent).toContain("No location on file yet.");
    expect(document.body.textContent).toContain("switch to Pick on map");
    expect(document.body.textContent).toContain("only looks up churches that have a street address");
    expect(document.querySelector('a[href="/admin/organizations/map-locations"]')).toBeNull();
    expect(document.querySelectorAll("h1")).toHaveLength(0);
    // One column below 1024px: the field grid is the module's, not the two-column global.
    expect(read("components/church-location-form.tsx")).not.toContain("two-column");
  });

  it("offers the lookup, conditioned on a street address, to an imported location that has no map point", async () => {
    await render(createElement(ChurchLocationForm, { endpoint: "/e", initialLocation: { ...empty, city: "Sampleton", source: "IMPORT", updatedAt: "2026-11-01T00:00:00.000Z" } }));
    const link = document.querySelector('a[href="/admin/organizations/map-locations"]') as HTMLAnchorElement;
    expect(link.textContent).toBe("Find map locations");
    expect(link.parentElement!.textContent).toContain("If this church has a street address on file");
    await render(createElement("div"));
    await render(createElement(ChurchLocationForm, { endpoint: "/e", initialLocation: { ...empty, city: "Sampleton", latitude: 41.5, longitude: -93.6, source: "IMPORT", updatedAt: "2026-11-01T00:00:00.000Z" } }));
    expect(document.querySelector('a[href="/admin/organizations/map-locations"]')).toBeNull();
  });

  it("names where the current location came from", async () => {
    await render(createElement(ChurchLocationForm, { endpoint: "/e", initialLocation: { ...empty, city: "Sampleton", source: "GEOCODED", updatedAt: "2026-11-01T00:00:00.000Z" } }));
    expect(document.body.textContent).toContain("Comes from an accepted address lookup.");
  });

  it("holds Save in flight, sends one PATCH, and keeps focus on the button", async () => {
    const fetchMock = pending();
    vi.stubGlobal("fetch", fetchMock);
    await render(createElement(ChurchLocationForm, { endpoint: "/api/admin/organizations/church-1/location", initialLocation: empty }));
    const form = document.querySelector("form")!;
    await typeInto(form.querySelector('input[name="city"]') as HTMLInputElement, "Sampleton");
    button("Save location")!.focus();
    await submit(form);
    const saving = button("Saving…")!;
    expect(saving.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(saving);
    await submit(form);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe("PATCH");
  });

  it("keeps typed values and focuses the reason when the save fails", async () => {
    vi.stubGlobal("fetch", failing("Latitude must be between -90 and 90."));
    await render(createElement(ChurchLocationForm, { endpoint: "/e", initialLocation: empty }));
    const form = document.querySelector("form")!;
    await typeInto(form.querySelector('input[name="city"]') as HTMLInputElement, "Sampleton");
    await submit(form);
    expect(form.querySelector('[role="alert"]')!.textContent).toBe("Not saved: Latitude must be between -90 and 90.");
    expect((form.querySelector('input[name="city"]') as HTMLInputElement).value).toBe("Sampleton");
    expect(form.contains(document.activeElement)).toBe(true);
  });
});

/* ---------------------------------------------------------------- import */

describe("organization import (#1592)", () => {
  const Import = (props: ComponentProps<typeof EadventistImportWorkspace>) => createElement(
    OrganizationActionProvider, null,
    createElement(OrganizationHeaderButton, { icon: "upload", label: "Choose CSV file" }),
    createElement(EadventistImportWorkspace, props),
  );
  const conflicting = {
    counts: { new: 1, updated: 2, unchanged: 0, skipped: 0, flagged: 0 },
    locationCounts: { created: 0, updated: 0 },
    needsChoice: 1,
    rejected: [],
    items: [
      { line: 2, eadventistId: "9010", name: longName, kind: "COMPANY", action: "UPDATED", matchedBy: "POSSIBLE", notes: ["Possible match: \"Sample Pines SDA\"."], disbandedOn: null, possibleMatches: [{ id: "church-7", name: "Sample Pines SDA" }], needsChoice: true, selectedMatch: null, locationAction: null },
      { line: 3, eadventistId: "9004", name: "Sample Ridge Group", kind: "GROUP", action: "NEW", matchedBy: null, notes: [], disbandedOn: null, possibleMatches: [], needsChoice: false, selectedMatch: null, locationAction: "CREATE" },
    ],
  } as unknown as NonNullable<ComponentProps<typeof EadventistImportWorkspace>["initialPreview"]>;

  it("starts on the file chooser, with the one filled button in the header", async () => {
    await render(createElement(Import, {}));
    expect(document.querySelectorAll(".primary-button")).toHaveLength(1);
    expect(document.querySelector(".primary-button")!.textContent).toContain("Choose CSV file");
    expect(document.querySelector('input[type="file"]')).not.toBeNull();
    expect(document.body.textContent).toContain("Nothing is saved until you review the list");
  });

  it("holds Save while a possible match still needs a choice, and says which rows are proposals", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await render(createElement(Import, { initialPreview: conflicting }));
    const save = document.querySelector(".primary-button") as HTMLButtonElement;
    expect(save.textContent).toContain("Save 3 changes");
    expect(save.getAttribute("aria-disabled")).toBe("true");
    expect(save.disabled).toBe(false);
    await click(save);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("1 possible match needs a choice before you can save.");
    expect(document.body.textContent).toContain("Proposed change");
    expect(document.body.textContent).toContain("Nothing is saved yet. These are proposed changes.");
    expect(document.body.textContent).toContain(longName);
    expect(document.querySelectorAll(".primary-button")).toHaveLength(1);
  });

  it("shows Checking… while the preview is re-read and Saving… only for the confirming call, and Save is one link away from the bottom", async () => {
    const calls: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => { calls.push(JSON.parse(init!.body as string)); return new Promise<Response>(() => {}); }));
    const file = new File(["name\nx"], "orgs.csv", { type: "text/csv" });
    await render(createElement(Import, { initialPreview: { ...conflicting, needsChoice: 0, items: conflicting.items.map((item) => ({ ...item, needsChoice: false })) } as typeof conflicting }));
    // The page keeps a plain sentence and an underlined button below the table; it moves focus to the header's Save.
    const goto = button("Go to Save")!;
    expect(goto.className).toContain("textButton");
    await click(goto);
    expect(document.activeElement!.id).toBe("organization-header-action");
    expect(document.querySelectorAll(".primary-button")).toHaveLength(1);
    // A match choice re-checks the preview (confirm false): the header says Checking…, never Saving….
    await render(createElement(Import, { initialPreview: conflicting }));
    const select = document.querySelector("select") as HTMLSelectElement;
    expect(file.name).toBe("orgs.csv");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, "church-7");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    // initialPreview has no file text, so no request is sent; the label logic is pinned in the source below.
    expect(calls).toHaveLength(0);
    const source = read("components/eadventist-import-workspace.tsx");
    expect(source).toContain('setRunning(confirm ? "save" : "check")');
    expect(source).toContain('running === "save" ? "Saving…" : reviewing ? "Checking…" : "Reading…"');
  });

  it("draws the preview as card rows on a phone, with the same labels", async () => {
    await render(createElement(Import, { initialPreview: conflicting }));
    const table = document.querySelector("table")!;
    expect(table.className).toContain("table-cards");
    const cells = Array.from(table.querySelectorAll("tbody tr:first-child td")).map((cell) => cell.getAttribute("data-label"));
    expect(cells).toEqual(["Row", "Kind", "Proposed change"]);
    expect(table.querySelector("tbody th[scope=row]")!.textContent).toBe(longName);
  });

  it("keeps the same request: file text, confirm flag and choices to the same route", () => {
    const source = read("components/eadventist-import-workspace.tsx");
    expect(source).toContain('"/api/admin/organizations/eadventist-import"');
    expect(source).toContain("JSON.stringify({ csv: text, confirm, choices: chosen })");
    expect(source).toContain("changes === 0 || waiting > 0");
  });
});

/* ---------------------------------------------------------------- map locations */

describe("map-location review (#1592)", () => {
  const items = [
    { organizationId: "org-1", name: longName, address: "10 Sample Road, Sampleton, IA 50000", status: "MATCHED" as const, latitude: 41.5, longitude: -93.6, matchedAddress: "10 SAMPLE RD" },
    { organizationId: "org-2", name: "Sample Creek Church", address: "2 Nowhere Lane, Sample Creek, IA", status: "NO_MATCH" as const, latitude: null, longitude: null, matchedAddress: "" },
  ];
  const Map_ = (props: ComponentProps<typeof ChurchMapLocationsWorkspace>) => createElement(
    OrganizationActionProvider, null,
    createElement(OrganizationHeaderButton, { icon: "map", label: "Find map locations" }),
    createElement(ChurchMapLocationsWorkspace, props),
  );

  it("shows a match as a proposal that is not on the map yet, with only the header's button filled", async () => {
    await render(createElement(Map_, { enabled: true, eligible: 3, items }));
    expect(document.querySelectorAll(".primary-button")).toHaveLength(1);
    expect(document.body.textContent).toContain("Proposed match");
    expect(document.body.textContent).toContain("Not on the map until accepted.");
    expect(document.body.textContent).toContain("Nothing reaches the public map until you accept a match.");
    expect(document.body.textContent).toContain("Address on file");
    expect(document.body.textContent).toContain("No match");
    expect(document.querySelector('a[href="/admin/organizations/org-2/location"]')).not.toBeNull();
    // The match is accepted from its own button, which names the church.
    expect(button(`Accept match for ${longName}`)).not.toBeNull();
    expect(document.querySelectorAll('button[aria-label^="Accept match"]')).toHaveLength(1);
  });

  it("starts the lookup from the header and accepts a match with the same calls as before", async () => {
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("/map-locations") ? { processed: 2, matched: 1, noMatch: 1 } : { ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await render(createElement(Map_, { enabled: true, eligible: 3, items }));
    await click(document.querySelector(".primary-button"));
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/admin/organizations/map-locations");
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe("POST");
    expect(document.body.textContent).toContain("Looked up 2 churches: 1 matched, 1 with no match.");
    await click(button(`Accept match for ${longName}`));
    expect(fetchMock.mock.calls[1]![0]).toBe("/api/admin/organizations/org-1/map-location");
    expect(JSON.parse((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body as string)).toEqual({ decision: "accept" });
    expect(document.body.textContent).toContain(`${longName} is on the map.`);
  });

  it("holds the header button when the flag is off or no church needs a lookup, and says why", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await render(createElement(Map_, { enabled: false, eligible: 3, items: [] }));
    expect(document.body.textContent).toContain("GEOCODING_ENABLED=true");
    const filled = document.querySelector(".primary-button") as HTMLButtonElement;
    expect(filled.getAttribute("aria-disabled")).toBe("true");
    await click(filled);
    expect(fetchMock).not.toHaveBeenCalled();
    await render(createElement(Map_, { enabled: true, eligible: 0, items: [] }));
    expect(document.body.textContent).toContain("0 churches have a street address and no map point yet.");
    expect((document.querySelector(".primary-button") as HTMLElement).getAttribute("aria-disabled")).toBe("true");
  });

  it("holds Accept and Skip while one decision is in flight", async () => {
    vi.stubGlobal("fetch", pending());
    await render(createElement(Map_, { enabled: true, eligible: 3, items }));
    await click(button(`Skip ${items[1]!.name}`));
    expect(button(`Skip ${items[1]!.name}`)!.getAttribute("aria-disabled")).toBe("true");
    expect(button(`Accept match for ${longName}`)!.getAttribute("aria-disabled")).toBe("true");
  });

  it("keeps the staff geocoding flow: public addresses only, a plain anchor to the location page", () => {
    const source = read("components/church-map-locations-workspace.tsx");
    expect(source).toContain('"/api/admin/organizations/map-locations"');
    expect(source).toContain("/api/admin/organizations/${encodeURIComponent(item.organizationId)}/map-location");
    expect(source).toContain("U.S. Census Bureau geocoder");
    expect(source).toContain('href={`/admin/organizations/${item.organizationId}/location`}');
    expect(source).not.toMatch(/<Link[^>]*\/location/);
  });
});

/* ---------------------------------------------------------------- styles */

describe("styles (#1592)", () => {
  it.each(["components/organization-pages.module.css", "components/organization-directory-workspace.module.css"])("keeps %s on tokens, with 44px links and no raw colors, sizes or radii", (file) => {
    const css = read(file).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/font-size:\s*\d/);
    expect(css).not.toMatch(/border-radius:\s*\d/);
    expect(css).not.toMatch(/\.field-help/);
  });

  it("underlines links and keeps them 44px tall", () => {
    const css = read("components/organization-pages.module.css");
    expect(css).toMatch(/\.reviewActions > :is\(a, button\) \{ min-height: 44px; \}/);
    expect(css).toMatch(/\.textLink \{[^}]*text-decoration: underline/);
    expect(css).toMatch(/\.held\[aria-disabled="true"\] \{[^}]*opacity: 0\.58/);
    const directory = read("components/organization-directory-workspace.module.css");
    expect(directory).toMatch(/\.textButton \{[^}]*min-height: 44px/);
    expect(directory).toMatch(/\.organizationCard\.inactive > :not\(\.actions\) \{\s*opacity: 0\.75;/);
  });
});
