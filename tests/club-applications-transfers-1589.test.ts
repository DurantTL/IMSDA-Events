/* eslint-disable @typescript-eslint/no-explicit-any -- the fake database receives loosely typed Prisma arguments */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1589 part B: the staff new club applications queue (status views, compact cards, one application on its own with the
 * Decision section) and the member transfers queue (its view in the address, card ids, per-view empty text). Synthetic
 * data only; the clock is pinned.
 */

vi.mock("server-only", () => ({}));
const nav = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  redirect: vi.fn((to: string) => { throw new Error(`REDIRECT ${to}`); }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh, replace: vi.fn() }),
  usePathname: () => "/admin/clubs/applications",
  useSearchParams: () => new URLSearchParams(),
  redirect: nav.redirect,
}));
const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  getCurrentSession: vi.fn(),
  hasClubsAdministration: vi.fn(),
  directorStates: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ APP_BASE_URL: "https://events.imsda.test" }) }));
vi.mock("@/modules/background-checks/repository", () => ({ directorBackgroundStatesByEmail: mocks.directorStates }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/admin-roles", () => ({ hasClubsAdministration: mocks.hasClubsAdministration }));
vi.mock("@/modules/access/login-redirect", () => ({ staffLoginRedirectPath: async () => "/staff/sign-in" }));
vi.mock("@/modules/communications/account-email", () => ({ isAccountEmailConfigured: () => true }));
vi.mock("@/components/admin-page-header", () => ({ AdminPageHeader: () => null }));

import ApplicationsPage from "@/app/(workspace)/admin/clubs/applications/page";
import TransfersPage from "@/app/(workspace)/admin/clubs/transfers/page";
import { ClubTransferQueue, StaffTransferCard } from "@/components/club-transfer-queue";
import { NewClubApplicationsQueue } from "@/components/new-club-applications-queue";
import { StaffApplicationCard, StaffApplicationRecord } from "@/components/staff-club-applications";
import { parseStaffQueueView, staffQueueFilters, staffQueueHref } from "@/modules/club-transfers/domain";
import { applicationHref, applicationsHref, parseApplicationId, parseApplicationView } from "@/modules/club-applications/queue-model";
import type { NewClubApplicationRecord } from "@/modules/club-applications/repository";
import type { StaffTransferRecord } from "@/modules/club-transfers/repository";

import * as actualRepository from "@/modules/club-applications/repository";

const NOW = new Date("2026-11-11T15:00:00Z");

function application(overrides: Record<string, unknown> = {}) {
  return {
    id: "app-1", clubName: "Sample Valley Pathfinders", clubType: "PATHFINDER", status: "PENDING", source: "PUBLIC",
    church: { id: "church-1", name: "Sample Valley Church", type: "CHURCH", isOther: false, unavailable: false, needsChoice: false },
    sterling: "CLEAR", sterlingAmbiguous: false, sterlingNameMismatch: false, invitedEmail: null, invitedEmailDiffers: false,
    duplicates: [], director: { name: "Dana Sample", email: "dana@example.test", address: "1 Example Road", homePhone: "(515) 555-0100", workPhone: null },
    pastorName: "Pat Pastor", signatures: { pastor: "Pat Pastor", headElder: "Hal Elder", clerk: "Cleo Clerk", director: "Dana Sample" },
    otherBoardMembers: [], note: null, submittedAt: "2026-11-01T12:00:00.000Z", applicationDate: "2026-11-01", attachment: null,
    declineReason: null, decidedAt: null, decidedByName: null, createdOrganizationId: null,
    ...overrides,
  } as unknown as NewClubApplicationRecord;
}

const churches = [{ id: "church-2", name: "Other Church", type: "CHURCH" }];

/** A stored application row, as the repository selects it. */
function row(status: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `row-${status}`, status, source: "PUBLIC", clubName: "Sample Valley Pathfinders", clubType: "PATHFINDER", sponsoringChurchId: "church-1", sponsoringChurchOther: null,
    pastorName: "Pat Pastor", directorName: "Dana Sample", directorAddress: "1 Example Road", directorEmail: "dana@example.test", directorHomePhone: "(515) 555-0100", directorWorkPhone: null,
    pastorSignature: "Pat Pastor", headElderSignature: "Hal Elder", clerkSignature: "Cleo Clerk", directorSignature: "Dana Sample", otherBoardMembers: [],
    applicationDate: new Date("2026-11-01T00:00:00Z"), note: null, attachmentName: null, attachmentContentType: null, attachmentByteSize: null,
    createdAt: new Date("2026-11-01T12:00:00Z"), decidedAt: null, declineReason: null, createdOrganizationId: null, invitedEmail: null,
    sponsoringChurch: { name: "Sample Valley Church", type: "CHURCH", isActive: true }, decidedBy: null,
    ...overrides,
  };
}

const state = {
  rows: [] as Array<ReturnType<typeof row>>,
  clubs: [] as Array<{ name: string; normalizedName: string; parentOrganizationId: string }>,
  waitingCount: 3,
};

function fakeDb() {
  const db = {
    newClubApplication: {
      findMany: vi.fn(async (args: any) => (args.where.status === "PENDING"
        ? state.rows.filter((r) => r.status === "PENDING")
        : state.rows.filter((r) => r.status !== "PENDING"))),
      findUnique: vi.fn(async (args: any) => state.rows.find((r) => r.id === args.where.id) ?? null),
      count: vi.fn(async () => state.waitingCount),
    },
    newClubApplicationInvite: { findMany: vi.fn(async () => []) },
    organization: { findMany: vi.fn(async (args: any) => (args.where.type === "CLUB" ? state.clubs : churches)) },
  };
  mocks.getPrisma.mockReturnValue(db);
  mocks.directorStates.mockResolvedValue(new Map());
  return db;
}

let db: ReturnType<typeof fakeDb>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  state.rows = [];
  state.clubs = [];
  state.waitingCount = 3;
  mocks.getCurrentSession.mockResolvedValue({ user: { id: "u1", globalRole: "SYSTEM_ADMIN" } });
  mocks.hasClubsAdministration.mockResolvedValue(true);
  db = fakeDb();
});
afterEach(() => vi.useRealTimers());

describe("status views in the address", () => {
  it("reads waiting, decided and links, and anything else is waiting", () => {
    expect(parseApplicationView("decided")).toBe("decided");
    expect(parseApplicationView(" Links ")).toBe("links");
    expect(parseApplicationView(["decided", "links"])).toBe("decided");
    for (const value of [undefined, "", "approved", "pending", "all", 4, ["nope"]]) expect(parseApplicationView(value)).toBe("waiting");
  });

  it("builds addresses, leaving the default out and encoding the id", () => {
    expect(applicationsHref("waiting")).toBe("/admin/clubs/applications");
    expect(applicationsHref("decided")).toBe("/admin/clubs/applications?status=decided");
    expect(applicationHref("a b/1")).toBe("/admin/clubs/applications?application=a%20b%2F1");
    expect(parseApplicationId(" app-1 ")).toBe("app-1");
    expect(parseApplicationId("")).toBeNull();
    expect(parseApplicationId(undefined)).toBeNull();
  });
});

describe("each view reads only what it shows", () => {
  const render = async (query: Record<string, string>) => renderToStaticMarkup(await ApplicationsPage({ searchParams: Promise.resolve(query) }));
  // The list reads carry a page size; the duplicate check's own read of waiting twins does not.
  const whereOf = () => db.newClubApplication.findMany.mock.calls.filter((call) => call[0].take !== undefined).map((call) => call[0].where);

  it("waiting (and an unknown value) reads the waiting applications only, with the count", async () => {
    state.rows = [row("PENDING"), row("APPROVED")];
    for (const query of [{} as Record<string, string>, { status: "bogus" }]) {
      db.newClubApplication.findMany.mockClear();
      db.newClubApplicationInvite.findMany.mockClear();
      const html = await render(query);
      expect(whereOf()).toEqual([{ status: "PENDING" }]);
      expect(db.newClubApplicationInvite.findMany).not.toHaveBeenCalled();
      expect(html).toContain("Waiting (3)");
      expect(html).toMatch(/aria-current="page"[^>]*>Waiting \(3\)/);
      expect(html).toContain('id="application-row-PENDING"');
      expect(html).not.toContain('id="application-row-APPROVED"');
    }
  });

  it("decided reads the decided applications only, and the duplicate query is not needed", async () => {
    state.rows = [row("PENDING"), row("APPROVED")];
    const html = await render({ status: "decided" });
    expect(whereOf()).toEqual([{ status: { not: "PENDING" } }]);
    expect(db.newClubApplicationInvite.findMany).not.toHaveBeenCalled();
    expect(html).toMatch(/aria-current="page"[^>]*>Decided</);
    expect(html).toContain('id="application-row-APPROVED"');
    expect(html).not.toContain('id="application-row-PENDING"');
  });

  it("links reads the invites and no applications, and shows the private link form", async () => {
    const html = await render({ status: "links" });
    expect(db.newClubApplication.findMany).not.toHaveBeenCalled();
    expect(db.newClubApplicationInvite.findMany).toHaveBeenCalledTimes(1);
    expect(html).toContain("Send a private link");
    expect(html).toMatch(/aria-current="page"[^>]*>Private links</);
  });

  it("moves the description and the two links into the intro, and the settings link is for system administrators only", async () => {
    const admin = await render({});
    expect(admin).toContain("Directors apply from the public");
    expect(admin).toContain('href="/clubs/register"');
    expect(admin).toContain('href="/admin/settings"');
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "u2", globalRole: null } });
    const clubsAdmin = await render({});
    expect(clubsAdmin).toContain('href="/clubs/register"');
    expect(clubsAdmin).not.toContain("/admin/settings");
  });

  it("sends a signed-out visitor to sign in and someone without Clubs administration to no access", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    await expect(render({})).rejects.toThrow("REDIRECT /staff/sign-in");
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "u3", globalRole: null } });
    mocks.hasClubsAdministration.mockResolvedValue(false);
    await expect(render({})).rejects.toThrow("REDIRECT /no-access");
  });
});

describe("the repository's status argument and the single read", () => {
  it("reads only the waiting applications for the waiting view, and only the decided ones for the decided view", async () => {
    state.rows = [row("PENDING"), row("APPROVED")];
    state.clubs = [{ name: "Existing Club", normalizedName: "existing club", parentOrganizationId: "church-1" }];
    await actualRepository.listNewClubApplications("SYSTEM_ADMIN", NOW, "waiting");
    const listReads = () => db.newClubApplication.findMany.mock.calls.filter((call) => call[0].take !== undefined).map((call) => call[0]);
    expect(listReads()).toHaveLength(1);
    expect(listReads()[0]!.where).toEqual({ status: "PENDING" });
    db.newClubApplication.findMany.mockClear();
    db.organization.findMany.mockClear();
    const decided = await actualRepository.listNewClubApplications("SYSTEM_ADMIN", NOW, "decided");
    expect(db.newClubApplication.findMany).toHaveBeenCalledTimes(1);
    expect(db.newClubApplication.findMany.mock.calls[0]![0]).toMatchObject({ where: { status: { not: "PENDING" } }, take: 50 });
    expect(decided.map((r) => r.status)).toEqual(["APPROVED"]);
    // Duplicate flags come from their own queries on the waiting rows, so the decided view needs none.
    expect(db.organization.findMany).not.toHaveBeenCalled();
  });

  it("keeps the duplicate flags on the waiting view, and reads both lists by default", async () => {
    state.rows = [row("PENDING"), row("APPROVED")];
    state.clubs = [{ name: "Existing Club", normalizedName: "existing club", parentOrganizationId: "church-1" }];
    const waiting = await actualRepository.listNewClubApplications("SYSTEM_ADMIN", NOW, "waiting");
    expect(waiting[0]!.duplicates.map((flag) => flag.kind)).toEqual(["CHURCH_HAS_CLUB"]);
    db.newClubApplication.findMany.mockClear();
    const both = await actualRepository.listNewClubApplications("AREA_COORDINATOR", NOW);
    expect(db.newClubApplication.findMany.mock.calls.filter((call) => call[0].take !== undefined)).toHaveLength(2);
    expect(both.map((r) => r.status)).toEqual(["PENDING", "APPROVED"]);
  });

  it("reads one application by id through the same viewer check and mapping, and returns null for an unknown or malformed id", async () => {
    state.rows = [row("PENDING")];
    state.clubs = [{ name: "Existing Club", normalizedName: "existing club", parentOrganizationId: "church-1" }];
    const found = await actualRepository.getNewClubApplication("CLUBS_ADMIN", "row-PENDING", NOW);
    expect(found).toMatchObject({ id: "row-PENDING", status: "PENDING", church: { needsChoice: false } });
    expect(found!.duplicates).toHaveLength(1);
    expect(await actualRepository.getNewClubApplication("SYSTEM_ADMIN", "missing", NOW)).toBeNull();
    expect(await actualRepository.getNewClubApplication("SYSTEM_ADMIN", "", NOW)).toBeNull();
    const calls = db.newClubApplication.findUnique.mock.calls.length;
    expect(await actualRepository.getNewClubApplication("SYSTEM_ADMIN", "x".repeat(500), NOW)).toBeNull();
    expect(db.newClubApplication.findUnique.mock.calls.length).toBe(calls);
    await expect(actualRepository.getNewClubApplication(null, "row-PENDING", NOW)).rejects.toMatchObject({ status: 403 });
    await expect(actualRepository.getNewClubApplication("nobody" as never, "row-PENDING", NOW)).rejects.toMatchObject({ status: 403 });
  });
});

describe("list cards", () => {
  it("are compact, link to the application, and carry no Approve or Decline", () => {
    const html = renderToStaticMarkup(createElement(StaffApplicationCard, {
      application: application({ sterling: "FLAGGED", duplicates: [{ kind: "CHURCH_HAS_CLUB", message: "Sample Valley Church already has a club: Existing Club." }] }),
    }));
    expect(html).toContain("Sample Valley Pathfinders");
    expect(html).toContain("Pending approval");
    expect(html).toContain("Sterling Volunteers:");
    expect(html).toContain("Possible duplicate: Sample Valley Church already has a club: Existing Club.");
    expect(html).toContain("Dana Sample");
    expect(html).toContain("Nov 1, 2026");
    expect(html).toContain('href="/admin/clubs/applications?application=app-1"');
    expect(html).toContain("Open application");
    expect(html).not.toMatch(/>Approve<|>Decline<|<button|<dl|Mailing address/);
  });

  it("keeps the sponsor wording for a typed or missing church", () => {
    const typed = renderToStaticMarkup(createElement(StaffApplicationCard, {
      application: application({ church: { id: null, name: "Typed Church", type: null, isOther: true, unavailable: false, needsChoice: true } }),
    }));
    expect(typed).toContain("(typed by the applicant, not in the directory)");
    const gone = renderToStaticMarkup(createElement(StaffApplicationCard, {
      application: application({ church: { id: "c", name: "", type: null, isOther: false, unavailable: true, needsChoice: true } }),
    }));
    expect(gone).toContain("the church is no longer in the directory");
  });

  it("the waiting and decided pages list cards, and an empty view says so", async () => {
    state.rows = [row("PENDING"), row("PENDING", { id: "row-2", clubName: "Second Club" })];
    const html = renderToStaticMarkup(await ApplicationsPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('id="application-row-PENDING"');
    expect(html).toContain('href="/admin/clubs/applications?application=row-2"');
    expect(html).not.toMatch(/>Approve<|>Decline<|Approve and send/);
    state.rows = [];
    expect(renderToStaticMarkup(await ApplicationsPage({ searchParams: Promise.resolve({}) }))).toContain("No applications are waiting.");
    expect(renderToStaticMarkup(await ApplicationsPage({ searchParams: Promise.resolve({ status: "decided" }) }))).toContain("No applications have been decided yet.");
  });
});

describe("one application on its own", () => {
  const page = async (id: string, extra: Record<string, string> = {}) => renderToStaticMarkup(await ApplicationsPage({ searchParams: Promise.resolve({ application: id, ...extra }) }));

  it("shows a waiting application in full with the Decision section after the details and a back link", async () => {
    state.rows = [row("PENDING", { attachmentName: "plan.pdf", attachmentContentType: "application/pdf", attachmentByteSize: 2048 })];
    const html = await page("row-PENDING");
    expect(db.newClubApplication.findMany.mock.calls.filter((call) => call[0].take !== undefined)).toHaveLength(0);
    expect(html).toContain("Back to waiting applications");
    expect(html).toContain('href="/admin/clubs/applications"');
    expect(html).toContain("Mailing address");
    expect(html).toContain("/api/admin/club-applications/row-PENDING/attachment");
    expect(html).toContain('<h2 id="application-decision-heading">Decision</h2>');
    expect(html.indexOf("Mailing address")).toBeLessThan(html.indexOf("Decision</h2>"));
    expect(html).toContain(">Approve<");
    expect(html).toContain(">Decline<");
  });

  it("shows a declined application with its reason and who decided, and no Decision section", async () => {
    state.rows = [row("DECLINED", { declineReason: "Already has a club.", decidedAt: new Date("2026-11-05T12:00:00Z"), decidedBy: { displayName: "Alex Admin" } })];
    const html = await page("row-DECLINED");
    expect(html).toContain("Back to decided applications");
    expect(html).toContain('href="/admin/clubs/applications?status=decided"');
    expect(html).toContain("Reason given");
    expect(html).toContain("Already has a club.");
    expect(html).toContain("Nov 5, 2026 by Alex Admin");
    expect(html).not.toContain("Decision</h2>");
    expect(html).not.toMatch(/>Approve<|>Decline<|Decline application/);
  });

  it("shows an approved application with the link to the new club", async () => {
    state.rows = [row("APPROVED", { createdOrganizationId: "club-9", decidedAt: new Date("2026-11-05T12:00:00Z") })];
    const html = await page("row-APPROVED");
    expect(html).toContain('href="/admin/organizations/club-9/profile"');
    expect(html).toContain("Open the new club");
    expect(html).not.toContain("Decision</h2>");
  });

  it("shows a duplicate-flagged application with its flags and still lets staff decide", async () => {
    state.rows = [row("PENDING")];
    state.clubs = [{ name: "Sample Valley Pathfinders", normalizedName: "sample valley pathfinders", parentOrganizationId: "church-1" }];
    const html = await page("row-PENDING");
    expect(html).toContain("Possible duplicate:");
    expect(html).toContain(">Approve<");
  });

  it("says plainly that an unknown or malformed id could not be found, with the back link and no other record", async () => {
    state.rows = [row("PENDING")];
    for (const id of ["nope", "../etc/passwd", "<script>", "x".repeat(300)]) {
      const html = await page(id);
      expect(html).toContain("That application could not be found.");
      expect(html).toContain("Back to waiting applications");
      expect(html).not.toContain("Sample Valley Pathfinders");
      expect(html).not.toContain("<script>");
    }
    expect(await page("nope", { status: "decided" })).toContain("Back to decided applications");
  });

  it("renders the record component with the church list for the decision", () => {
    const html = renderToStaticMarkup(createElement(StaffApplicationRecord, { application: application(), churches }));
    expect(html).toContain("Decision");
  });
});

describe("the Area Coordinator list is unchanged", () => {
  it("shows full read-only cards with no decision controls, and collapses a cancelled application when asked", () => {
    const cancelled = application({ id: "app-2", clubName: "Cancelled Club", status: "DECLINED", decidedAt: "2026-11-05T12:00:00.000Z" });
    const html = renderToStaticMarkup(createElement(NewClubApplicationsQueue, { applications: [application(), cancelled], collapseCancelled: true }));
    expect(html).toContain('data-application="app-1"');
    expect(html).toContain("Mailing address");
    expect(html).toMatch(/<details[^>]*data-application-collapsed="app-2"[^>]*><summary/);
    expect(html).not.toMatch(/<button|<form|>Approve<|>Decline<|Open application|Decision/);
    const plain = renderToStaticMarkup(createElement(NewClubApplicationsQueue, { applications: [cancelled] }));
    expect(plain).not.toContain("<details");
    expect(plain).toContain('id="application-app-2"');
  });
});

describe("transfer queue views", () => {
  const iso = "2026-10-05T15:00:00.000Z";
  const transfer = (overrides: Record<string, unknown> = {}) => ({
    id: "t1", requestedName: "Sam Testperson", matchedMemberName: null, fromOrganizationId: "a", fromOrganizationName: "Club A",
    toOrganizationId: "b", toOrganizationName: "Club B", reason: "r", status: "PENDING", staffReason: null, resolution: null,
    staffNote: "", initiatedAt: iso, acknowledgeDueAt: iso, declinedAt: null, resolvedAt: null, overdue: false, canFinish: true,
    canOverride: true, canCancel: true, needsMemberChoice: false, pendingRegistrationMoves: 0, events: [], ...overrides,
  }) as unknown as StaffTransferRecord;

  it("parses the view and falls back to open", () => {
    for (const view of staffQueueFilters) expect(parseStaffQueueView(view)).toBe(view);
    expect(parseStaffQueueView(" Overdue ")).toBe("overdue");
    expect(parseStaffQueueView(["declined", "pending"])).toBe("declined");
    for (const value of [undefined, "", "closed", "all", 7]) expect(parseStaffQueueView(value)).toBe("open");
    expect(staffQueueHref("open")).toBe("/admin/clubs/transfers");
    expect(staffQueueHref("unmatched")).toBe("/admin/clubs/transfers?view=unmatched");
  });

  it("the page reads the view on the server and passes it in, and keeps the move approvals for system administrators", async () => {
    const element = await TransfersPage({ searchParams: Promise.resolve({ view: "overdue" }) }) as { props: { children: Array<{ type: unknown; props: { filter?: string } } | false> } };
    const queue = element.props.children.find((child) => child && (child as { type: unknown }).type === ClubTransferQueue) as { props: { filter: string } };
    expect(queue.props.filter).toBe("overdue");
    const fallback = await TransfersPage({ searchParams: Promise.resolve({ view: "junk" }) }) as typeof element;
    expect((fallback.props.children.find((child) => child && (child as { type: unknown }).type === ClubTransferQueue) as { props: { filter: string } }).props.filter).toBe("open");
    expect(element.props.children[2]).toBeTruthy();
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "u2", globalRole: null } });
    const clubsAdmin = await TransfersPage({ searchParams: Promise.resolve({}) }) as typeof element;
    expect(clubsAdmin.props.children[2]).toBe(false);
  });

  it("gives each card a stable id and a name heading, and sets Close apart from Finish and Override", () => {
    const html = renderToStaticMarkup(createElement(StaffTransferCard, { transfer: transfer({ id: "t-77" }), onAction: () => undefined }));
    expect(html).toContain('id="transfer-t-77"');
    expect(html).toMatch(/<h3[^>]*translate="no"[^>]*>Sam Testperson<\/h3>/);
    const actions = html.slice(html.indexOf('class="transfer-card-actions"'));
    expect(actions.indexOf(">Finish<")).toBeLessThan(actions.indexOf(">Override<"));
    expect(actions.indexOf(">Override<")).toBeLessThan(actions.indexOf(">Close<"));
    expect(actions).toMatch(/<div class="[^"]*closeZone[^"]*"><button[^>]*>Close<\/button><\/div>/);
    expect(html).not.toContain('class="eyebrow"');
  });

  it("drops the Clubs eyebrow on the queue heading", () => {
    expect(renderToStaticMarkup(createElement(ClubTransferQueue))).not.toContain("eyebrow");
  });

});
