// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  viewer: vi.fn(),
  searchPeople: vi.fn(),
  listEventOptions: vi.fn(),
  listClubOptions: vi.fn(),
  getPersonDetail: vi.fn(),
  listPendingInvitesPage: vi.fn(),
  listPendingInvites: vi.fn(),
  session: vi.fn(),
  listOpenMatchCandidates: vi.fn(),
  listActivePersonMerges: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/people",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); },
  notFound: () => { throw new Error("NOT_FOUND"); },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/modules/access/login-redirect", () => ({ staffLoginRedirectPath: async () => "/login" }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.session }));
vi.mock("@/modules/system-admin/people-access", () => ({ resolvePeopleViewer: mocks.viewer }));
vi.mock("@/modules/system-admin/people-directory", () => ({
  searchPeople: mocks.searchPeople,
  listEventOptions: mocks.listEventOptions,
  listClubOptions: mocks.listClubOptions,
  getPersonDetail: mocks.getPersonDetail,
}));
vi.mock("@/modules/system-admin/pending-invites", () => ({
  listPendingInvitesPage: mocks.listPendingInvitesPage,
  listPendingInvites: mocks.listPendingInvites,
}));
vi.mock("@/modules/organizations/area-coordinator-invites", () => ({ countPendingAreaCoordinatorInvites: async () => 0 }));
vi.mock("@/modules/account-merge/account-link", () => ({ isUnifiedSignInEnabled: async () => false }));
vi.mock("@/modules/profile-photos/repository", () => ({ getProfilePhotoState: async () => ({ hasPhoto: false, version: null, removedByStaffAt: null }) }));
vi.mock("@/modules/people/person-merge-repository", () => ({ listActivePersonMerges: mocks.listActivePersonMerges }));
vi.mock("@/modules/people/duplicate-match-repository", () => ({ listOpenMatchCandidates: mocks.listOpenMatchCandidates }));
// The section header looks the viewer's role up in the database; its own tests cover it.
vi.mock("@/components/admin-page-header", () => ({ AdminPageHeader: () => null }));

import AttendeeAccountsPage from "@/app/(workspace)/admin/accounts/page";
import TeamDirectoryPage from "@/app/(workspace)/admin/team/page";
import PeopleAccessPage from "@/app/(workspace)/admin/people/page";
import PersonAccessPage from "@/app/(workspace)/admin/people/[kind]/[id]/page";
import DuplicateMatchQueuePage from "@/app/(workspace)/people/matches/page";
import { pageOwnsHeader } from "@/components/page-header-routes";
import type { PendingInvite } from "@/modules/system-admin/pending-invites";
import type { PersonDetail } from "@/modules/system-admin/people-directory";

/** #1591: the System people, invitations and identity-review pages. Presentation and navigation only. Synthetic data only. */

const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");
const h1Count = (html: string) => (html.match(/<h1\b/g) ?? []).length;
const filledCount = (html: string) => (html.match(/class="[^"]*\bprimary-button\b/g) ?? []).length;
const admin = { id: "admin-1", email: "admin@imsda-events.test", globalRole: "SYSTEM_ADMIN" };

const emptyPage = { rows: [], page: 1, pageCount: 1, total: 0 };
const noInvites = { invites: [], emailConfigured: true, total: 0, page: 1, pageSize: 25 };

const invite = (over: Partial<PendingInvite>): PendingInvite => ({
  kind: "club", id: "i-1", name: "Pat Invitee", email: "pat@example.test", what: "Club director of Synthetic Club",
  sentAt: "2026-11-01T15:00:00.000Z", expired: false, ...over,
});

function person(over: Partial<PersonDetail> = {}): PersonDetail {
  return {
    name: "Sample Person",
    email: "sample@example.test",
    staffEmail: "sample@example.test",
    accountEmail: "sample@example.test",
    staffId: "u-target",
    accountId: "a-target",
    systemAdministrator: false,
    clubsAdministrator: false,
    youthAdministrator: false,
    siteContentEditor: false,
    areaCoordinator: false,
    staff: { status: "ACTIVE", signInDisabled: false, displayName: "Sample Person", jobTitle: "", phone: "", bio: "", twoStep: "On", lastSignedInAt: null },
    account: { status: "ACTIVE", signInDisabled: false, emailVerified: true, twoStep: "On", lastSignedInAt: null },
    events: [{ membershipId: "m-1", eventId: "e-1", eventName: "Synthetic Event One", role: "READ_ONLY_STAFF", active: true, healthInformation: true, finalizeInvoices: false }],
    clubs: [{ grantId: "g-1", organizationId: "o-1", clubName: "Synthetic Club", role: "DIRECTOR", status: "active", effectiveFrom: "2026-01-01T00:00:00.000Z" }],
    ...over,
  };
}

const restrictedPerson = (over: Partial<PersonDetail> = {}) => person({ events: null, staff: null, account: null, ...over });

const renderPeople = async (search: Record<string, string> = {}) =>
  renderToStaticMarkup(await PeopleAccessPage({ searchParams: Promise.resolve(search) }));
const renderPerson = async (kind = "staff", id = "u-target", search: Record<string, string> = {}) =>
  renderToStaticMarkup(await PersonAccessPage({ params: Promise.resolve({ kind, id }), searchParams: Promise.resolve(search) }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-11T18:00:00Z"));
  mocks.viewer.mockResolvedValue({ user: admin, scope: "full" });
  mocks.session.mockResolvedValue({ user: admin });
  mocks.searchPeople.mockResolvedValue(emptyPage);
  mocks.listEventOptions.mockResolvedValue([{ id: "e-1", name: "Synthetic Event One" }]);
  mocks.listClubOptions.mockResolvedValue([{ id: "o-1", name: "Synthetic Club" }]);
  mocks.listPendingInvitesPage.mockResolvedValue(noInvites);
  mocks.listPendingInvites.mockResolvedValue({ invites: [], emailConfigured: true });
  mocks.getPersonDetail.mockResolvedValue(person());
  mocks.listOpenMatchCandidates.mockResolvedValue([]);
  mocks.listActivePersonMerges.mockResolvedValue([]);
});

describe("header ownership (#1591)", () => {
  it("lists the three pages so the shell draws no second h1, and leaves the legacy redirects out", () => {
    expect(pageOwnsHeader("/admin/people")).toBe(true);
    expect(pageOwnsHeader("/admin/people/staff/u-1")).toBe(true);
    expect(pageOwnsHeader("/people/matches")).toBe(true);
    expect(pageOwnsHeader("/admin/accounts")).toBe(false);
    expect(pageOwnsHeader("/admin/team")).toBe(false);
  });

  it("keeps the old StaffPageHeader and the second back link off the people pages", () => {
    const list = read("app/(workspace)/admin/people/page.tsx");
    const detail = read("app/(workspace)/admin/people/[kind]/[id]/page.tsx");
    expect(list).not.toContain("StaffPageHeader");
    expect(list).toContain('title: "People & access"');
    // One back link on the person page: the header's, so the section header draws none.
    expect(detail).toContain("<AdminPageHeader back={null}");
    expect(detail.match(/Back to People & access/g)).toHaveLength(1);
  });
});

describe("/admin/people (#1591)", () => {
  it("draws one h1, one filled action (Invite a person) and the Area Coordinator tools outlined, for a system administrator", async () => {
    const html = await renderPeople();
    expect(h1Count(html)).toBe(1);
    expect(html).toContain("People &amp; access");
    const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
    expect(filledCount(header)).toBe(1);
    expect(header).toContain("Invite a person");
    expect(header).toMatch(/secondary-button[^>]*>[\s\S]*Act as Area Coordinator/);
    expect(html).toContain("Import Area Coordinators");
    // Below the header only the existing Search and Apply filters submit buttons are filled; the filters are unchanged.
    expect(html.slice(html.indexOf("</header>")).match(/<[^>]*primary-button[^>]*>[^<]*/g)).toEqual(['<button class="primary-button" type="submit">Search', '<button class="primary-button" type="submit">Apply filters']);
  });

  it("keeps the filters, the count row and the paging as they were", async () => {
    mocks.searchPeople.mockResolvedValue({
      rows: [{ key: "u-1", staffId: "u-1", accountId: null, name: "Sam Staff", email: "sam@example.test", kinds: ["Staff login"], signIn: [{ side: "Staff login", label: "Active", tone: "green" }], access: ["System administrator"] }],
      page: 1, pageCount: 3, total: 60,
    });
    const html = await renderPeople();
    expect(html).toContain("Filters");
    expect(html).toContain("60 people.");
    expect(html).toContain('aria-label="Pages"');
    expect(html).toContain("/admin/people/staff/u-1");
  });

  it("shows a Clubs Administrator the club-people description, no import and no Account detail", async () => {
    mocks.viewer.mockResolvedValue({ user: { id: "c-1", globalRole: null }, scope: "clubs" });
    const html = await renderPeople();
    expect(h1Count(html)).toBe(1);
    expect(html).toContain("Club people: club directors and club staff");
    expect(html).not.toContain("Import Area Coordinators");
    expect(mocks.listEventOptions).not.toHaveBeenCalled();
    expect(mocks.searchPeople).toHaveBeenCalledWith("", 1, "clubs", expect.anything());
  });

  it("says Pending invites, and keeps pending and expired apart", async () => {
    mocks.listPendingInvitesPage.mockResolvedValue({
      invites: [invite({ id: "i-1", name: "Pat Waiting" }), invite({ id: "i-2", name: "Ex Pired", email: "ex@example.test", expired: true })],
      emailConfigured: true, total: 2, page: 1, pageSize: 25,
    });
    const html = await renderPeople();
    expect(html).toContain("Pending invites");
    expect(html).toContain("Pat Waiting");
    expect(html).toContain("Sent ");
    expect(html).toContain("Expired");
    expect(html).toContain("Ex Pired");
  });

  it("sends a signed-out visitor to sign-in and a viewer with no scope to /no-access", async () => {
    mocks.viewer.mockResolvedValue({ user: null, scope: null });
    await expect(renderPeople()).rejects.toThrow("REDIRECT:/login");
    mocks.viewer.mockResolvedValue({ user: { id: "u3", globalRole: null }, scope: null });
    await expect(renderPeople()).rejects.toThrow("REDIRECT:/no-access");
  });

  it("makes the Send invites button outlined, so Invite a person is the only filled action", () => {
    expect(read("components/area-coordinator-import.tsx")).not.toContain('className="primary-button" disabled={busy}');
  });
});

describe("/admin/people/[kind]/[id] (#1591)", () => {
  it("titles the page with the person's name, with the email and both kinds of login under it and one back link", async () => {
    const html = await renderPerson();
    expect(h1Count(html)).toBe(1);
    expect(html).toMatch(/<h1[^>]*translate="no"[^>]*>Sample Person<\/h1>/);
    const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
    expect(header).toContain("sample@example.test");
    expect(header).toContain("Staff login");
    expect(header).toContain("Website account");
    expect(header).toContain('href="/admin/people"');
    expect(html.match(/Back to People &amp; access/g)).toHaveLength(1);
  });

  it("returns to the search the person was opened from", async () => {
    const html = await renderPerson("staff", "u-target", { from: "sam" });
    expect(html).toContain('href="/admin/people?q=sam"');
  });

  it("keeps the four kinds of access in their own sections, each saying what it is", async () => {
    const html = await renderPerson();
    for (const [id, words] of [
      ["people-system-wide", "System-wide roles apply everywhere"],
      ["people-events", "Event staff membership"],
      ["people-clubs", "Club roles"],
      ["people-account", "Login identity"],
    ] as const) {
      expect(html, id).toContain(`id="${id}"`);
      expect(html, id).toContain(words);
    }
    expect(html).toContain("Health information");
    expect(html).toContain("Finalize invoices");
    // Pending invites are their own box, never one of the four.
    expect(html).not.toContain("Pending invites for this person");
  });

  it("shows the grant panel and the invites for this person above the access sections, as separate boxes", async () => {
    mocks.listPendingInvites.mockResolvedValue({ invites: [invite({ kind: "area", name: "Sample Person", email: "sample@example.test", what: "Area Coordinator" })], emailConfigured: true });
    const html = await renderPerson("staff", "u-target", { grant: "ac" });
    const grant = html.indexOf('aria-labelledby="people-chosen"');
    expect(grant).toBeGreaterThan(-1);
    expect(html.indexOf('id="people-system-wide"')).toBeGreaterThan(-1);
    expect(html).toContain("Pending invites for this person");
    expect(html.indexOf("Pending invites for this person")).toBeLessThan(html.indexOf('id="people-system-wide"'));
    expect(grant).toBeLessThan(html.indexOf('id="people-system-wide"'));
  });

  it("holds a person with many grants on one page, with every role listed and no sideways-scroll fixed widths", async () => {
    const clubs = Array.from({ length: 30 }, (_, index) => ({
      grantId: `g-${index}`, organizationId: `o-${index}`, clubName: `Synthetic Club ${index + 1}`, role: "DIRECTOR", status: "active" as const, effectiveFrom: "2026-01-01T00:00:00.000Z",
    }));
    const events = Array.from({ length: 12 }, (_, index) => ({
      membershipId: `m-${index}`, eventId: `e-${index}`, eventName: `Synthetic Event ${index + 1}`, role: "READ_ONLY_STAFF", active: true, healthInformation: index % 2 === 0, finalizeInvoices: index % 3 === 0,
    }));
    mocks.getPersonDetail.mockResolvedValue(person({ clubs, events }));
    const html = await renderPerson();
    expect(html).toContain("Synthetic Club 30");
    expect(html).toContain("Synthetic Event 12");
    expect(h1Count(html)).toBe(1);
    const css = read("components/people-directory.module.css");
    expect(css).toMatch(/\.facts \{[^}]*display: grid/);
    expect(css).toMatch(/\.fact \{[^}]*flex-wrap: wrap/);
    expect(css).toMatch(/\.wrap \{[^}]*min-width: 0/);
  });

  it("shows a removed role as Revoked and offers no second revoke", async () => {
    mocks.getPersonDetail.mockResolvedValue(person({
      clubs: [
        { grantId: "g-1", organizationId: "o-1", clubName: "Synthetic Club", role: "DIRECTOR", status: "revoked", effectiveFrom: "2025-01-01T00:00:00.000Z" },
        { grantId: "g-2", organizationId: "o-1", clubName: "Synthetic Club", role: "REPORTER", status: "ended", effectiveFrom: "2025-01-01T00:00:00.000Z" },
      ],
    }));
    const html = await renderPerson();
    expect(html).toContain("Revoked");
    expect(html).toContain("Ended");
    expect(html).not.toContain('aria-label="Revoke ');
  });

  it("answers not found for a person the viewer may not open, a bad kind and an over-long id", async () => {
    mocks.getPersonDetail.mockResolvedValue(null);
    await expect(renderPerson("staff", "u-other")).rejects.toThrow("NOT_FOUND");
    await expect(renderPerson("organization", "x")).rejects.toThrow("NOT_FOUND");
    await expect(renderPerson("staff", "x".repeat(65))).rejects.toThrow("NOT_FOUND");
    expect(mocks.getPersonDetail).toHaveBeenCalledTimes(1);
  });

  it("shows a Clubs Administrator no Events, no Account, no sign-in details and no system-wide edits", async () => {
    mocks.viewer.mockResolvedValue({ user: { id: "c-1", globalRole: null }, scope: "clubs" });
    mocks.getPersonDetail.mockResolvedValue(restrictedPerson({ staffId: null, staffEmail: null, accountEmail: "sample@example.test" }));
    const html = await renderPerson("account", "a-target");
    expect(h1Count(html)).toBe(1);
    expect(html).toContain("Website account");
    expect(html).not.toContain("Staff login");
    expect(mocks.getPersonDetail).toHaveBeenCalledWith("account", "a-target", "clubs");
    expect(mocks.listEventOptions).not.toHaveBeenCalled();
    for (const absent of [
      'id="people-events"', 'id="people-account"', "Add to event", "Health information", "Finalize invoices", "Login identity",
      "Disable sign-in", "Allow sign-in", "Sign out everywhere", "Send password reset", "Reset staff two-step", "Reset website two-step",
      "Change staff email", "Change website email", "Edit profile", "Last sign-in", "two-step sign-in",
      "Make system administrator", "Remove system administrator", "Make Clubs Administrator", "Remove Clubs Administrator",
    ]) expect(html, absent).not.toContain(absent);
    expect(html).toContain("Make Area Coordinator");
    expect(html).toContain("Give club role");
  });
});

describe("the legacy Accounts and Team pages (#1591)", () => {
  for (const [route, Page] of [["/admin/accounts", AttendeeAccountsPage], ["/admin/team", TeamDirectoryPage]] as const) {
    it(`${route} redirects to /admin/people and carries the search`, async () => {
      await expect(Page({ searchParams: Promise.resolve({ q: "sam smith" }) })).rejects.toThrow("REDIRECT:/admin/people?q=sam%20smith");
      await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT:/admin/people");
      await expect(Page({ searchParams: Promise.resolve({ q: "   " }) })).rejects.toThrow("REDIRECT:/admin/people");
    });
  }
});

describe("/people/matches (#1591)", () => {
  it("titles the page Possible duplicate people with one h1, Scan for new candidates outlined in the header, and no page-intro", async () => {
    const html = renderToStaticMarkup(await DuplicateMatchQueuePage());
    expect(h1Count(html)).toBe(1);
    expect(html).toContain(">Possible duplicate people</h1>");
    expect(html).not.toContain("page-intro");
    const header = html.slice(html.indexOf('data-page-header'), html.indexOf("</header>"));
    expect(header).toMatch(/class="secondary-button"[^>]*>[\s\S]*Scan for new candidates/);
    expect(filledCount(html)).toBe(0);
    // The empty state keeps its own Scan action.
    expect(html).toContain("Nothing open for review");
  });

  it("links to the registration duplicates as a separate task", async () => {
    const html = renderToStaticMarkup(await DuplicateMatchQueuePage());
    // The shell still places /people/* in the event shell, so the page draws no section header of its own.
    expect(html).not.toContain('data-testid="admin-section-header"');
    expect(read("app/(workspace)/people/matches/page.tsx")).not.toContain("AdminSectionHeader");
    expect(html).toContain("Identity review across the whole system");
    expect(html).toContain("separate from an event&#x27;s registration duplicates");
    expect(html).toContain('href="/people/duplicates"');
  });

  it("keeps the identity gate: signed out goes to sign-in, a non-administrator to /no-access", async () => {
    mocks.session.mockResolvedValue({ user: null });
    await expect(DuplicateMatchQueuePage()).rejects.toThrow("REDIRECT:/login");
    mocks.session.mockResolvedValue({ user: { id: "u-3", globalRole: null } });
    await expect(DuplicateMatchQueuePage()).rejects.toThrow("REDIRECT:/no-access");
  });

  it("keeps the dismiss, defer, merge and unmerge dialogs and the reasons in the workspace", () => {
    const source = read("components/duplicate-match-review-workspace.tsx");
    for (const kept of ['aria-labelledby="merge-match-title"', 'aria-labelledby="unmerge-title"', "Same phone number", "Merge people", "useUnsavedChangesGuard", "Nothing open for review"]) expect(source, kept).toContain(kept);
    expect(source).not.toMatch(/<h1\b/);
  });
});
