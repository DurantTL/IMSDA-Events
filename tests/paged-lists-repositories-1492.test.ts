import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The query-building half of the paged staff lists (#1492), against a recording prisma stand-in: the where-clause each page
 * is read with, the skip and take, the clamped page, and the permission and scope on every select-all route. The real
 * database behaviour is proven by `npm run test:calendar-bulk`, `test:staff-invitations`, `test:custom-message` and
 * `test:pending-invites-paging`. Synthetic data only.
 */
const mocks = vi.hoisted(() => ({
  calendarCount: vi.fn(),
  calendarFindMany: vi.fn(),
  clubInviteCount: vi.fn(),
  clubInviteFindMany: vi.fn(),
  areaCount: vi.fn(),
  areaFindMany: vi.fn(),
  userFindMany: vi.fn(),
  invitationCount: vi.fn(),
  invitationFindMany: vi.fn(),
  eventFindUnique: vi.fn(),
  requireSystemAdministrator: vi.fn(),
  requirePermission: vi.fn(),
  getCurrentSession: vi.fn(),
  getMessagingWorkspace: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    calendarEntry: { count: mocks.calendarCount, findMany: mocks.calendarFindMany },
    event: { findMany: async () => [], findUnique: mocks.eventFindUnique },
    calendarEventMatchDismissal: { findMany: async () => [] },
    clubInvite: { count: mocks.clubInviteCount, findMany: mocks.clubInviteFindMany },
    areaCoordinatorInvite: { count: mocks.areaCount, findMany: mocks.areaFindMany },
    user: { findMany: mocks.userFindMany },
    staffInvitation: { count: mocks.invitationCount, findMany: mocks.invitationFindMany },
  }),
}));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/modules/calendar/deadline-reminders", () => ({ reconcileDeadlineReminders: vi.fn() }));
vi.mock("@/modules/organizations/access", () => ({ requireSystemAdministrator: mocks.requireSystemAdministrator }));
vi.mock("@/modules/access/authorization", () => ({
  AccessDeniedError: class extends Error { constructor(message: string, public status = 403, public code = "PERMISSION_DENIED") { super(message); } },
  requirePermission: mocks.requirePermission,
}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: vi.fn() }));
vi.mock("@/modules/communications/messaging-repository", () => ({ getMessagingWorkspace: mocks.getMessagingWorkspace }));
vi.mock("@/modules/communications/account-email", () => ({ isAccountEmailConfigured: () => true }));
vi.mock("@/modules/club-imports/invites", () => ({ clubInviteSignUpUrl: (email: string) => `https://events.imsda.test/sign-up#${email}` }));

import { listCalendarEntryPage, listMatchingCalendarEntryIds } from "@/modules/calendar/repository";
import { defaultEntryFilters, maxBulkEntries } from "@/modules/calendar/admin-list";
import { listPendingInvites, listPendingInvitesPage, PENDING_INVITES_PAGE_SIZE } from "@/modules/system-admin/pending-invites";
import { listInvitations, listMatchingInvitationIds } from "@/modules/staff-invitations/repository";
import { GET as CALENDAR_LIST } from "@/app/api/admin/calendar/entries/route";
import { GET as CALENDAR_MATCHING } from "@/app/api/admin/calendar/entries/matching-ids/route";
import { GET as INVITATION_MATCHING } from "@/app/api/events/[eventId]/staff-invitations/matching-ids/route";
import { GET as MESSAGES } from "@/app/api/events/[eventId]/messages/route";
import { AccessDeniedError } from "@/modules/access/authorization";

const now = new Date("2026-11-02T18:00:00Z");
const entryRow = (id: string, patch: Record<string, unknown> = {}) => ({
  id, title: `Entry ${id}`, description: "", startsOn: "2026-11-10", endsOn: "2026-11-10", timeLabel: "", location: "", category: "", linkUrl: null,
  status: "SCHEDULED", entryType: "STANDARD", repeatRule: null, repeatExceptions: [], isPublished: true, sourceFeedId: null, sourceFeed: null,
  sourceUid: null, sourceRemovedAt: null, isHiddenLocally: false, locallyEditedFields: [], linkedEventId: null, linkedEvent: null,
  updatedAt: new Date("2026-10-01T00:00:00Z"), ...patch,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSystemAdministrator.mockResolvedValue({ id: "admin-1" });
  mocks.requirePermission.mockResolvedValue({ user: { id: "user-1" } });
  mocks.getCurrentSession.mockResolvedValue({ user: { id: "user-1" } });
});

describe("the calendar entries page", () => {
  it("counts in the database, clamps the page, and reads one page with skip and take", async () => {
    mocks.calendarCount.mockResolvedValueOnce(120).mockResolvedValueOnce(300);
    mocks.calendarFindMany.mockImplementation(async (args: Record<string, unknown>) => (args.distinct ? [{ category: "Youth" }] : [entryRow("e1")]));
    const result = await listCalendarEntryPage({ filters: { ...defaultEntryFilters, time: "all", search: "rally" }, sort: "title", page: 99 }, now);
    expect(result).toMatchObject({ total: 120, totalAll: 300, page: 3, pageSize: 50, categories: ["Youth"] });
    const pageRead = mocks.calendarFindMany.mock.calls.map((call) => call[0]).find((args) => args.take === 50)!;
    expect(pageRead.skip).toBe(100);
    expect(pageRead.orderBy.at(-1)).toEqual({ id: "asc" });
    expect(JSON.stringify(pageRead.where)).toContain('"contains":"rally"');
  });

  it("puts a repeating series that began in the past into Upcoming, and a finished one into Past", async () => {
    const series = (id: string, repeatRule: string) => entryRow(id, { startsOn: "2026-01-05", endsOn: "2026-01-05", repeatRule });
    mocks.calendarCount.mockResolvedValue(1);
    mocks.calendarFindMany.mockImplementation(async (args: { where?: { repeatRule?: unknown }; distinct?: unknown }) => {
      if (args.where?.repeatRule) return [series("open", "FREQ=WEEKLY"), series("ended", "FREQ=WEEKLY;UNTIL=20260201"), series("counted-out", "FREQ=WEEKLY;COUNT=3")];
      return args.distinct ? [] : [entryRow("e1")];
    });
    await listCalendarEntryPage({ filters: { ...defaultEntryFilters, time: "upcoming" }, sort: "date", page: 1 }, now);
    const upcomingWhere = mocks.calendarFindMany.mock.calls.map((call) => call[0]).find((args) => args.take === 50)!.where;
    expect(upcomingWhere.AND[0]).toEqual({ OR: [{ endsOn: { gte: "2026-11-02" } }, { id: { in: ["open"] } }] });
    mocks.calendarFindMany.mockClear();
    await listCalendarEntryPage({ filters: { ...defaultEntryFilters, time: "past" }, sort: "date", page: 1 }, now);
    const pastWhere = mocks.calendarFindMany.mock.calls.map((call) => call[0]).find((args) => args.take === 50)!.where;
    expect(pastWhere.AND[0]).toEqual({ endsOn: { lt: "2026-11-02" }, id: { notIn: ["open"] } });
  });

  it("reads no series at all when the time filter is All dates", async () => {
    mocks.calendarCount.mockResolvedValue(0);
    mocks.calendarFindMany.mockResolvedValue([]);
    await listCalendarEntryPage({ filters: { ...defaultEntryFilters, time: "all" }, sort: "date", page: 1 }, now);
    expect(mocks.calendarFindMany.mock.calls.some((call) => call[0].where?.repeatRule)).toBe(false);
  });

  it("windows the category order across the two runs, rows with no category last", async () => {
    // 60 rows have a category and 40 do not: page 2 is rows 51 to 100.
    mocks.calendarCount.mockImplementation(async (args?: { where?: { AND?: unknown[] } }) => {
      const text = JSON.stringify(args?.where ?? {});
      if (text.includes('"not":""')) return 60;
      return text.includes('"category":""') ? 40 : 100;
    });
    mocks.calendarFindMany.mockImplementation(async (args: { skip?: number; take?: number; distinct?: unknown }) => (args.distinct ? [] : Array.from({ length: args.take ?? 0 }, (_, index) => entryRow(`r-${args.skip}-${index}`))));
    await listCalendarEntryPage({ filters: { ...defaultEntryFilters, time: "all" }, sort: "category", page: 2 }, now);
    const reads = mocks.calendarFindMany.mock.calls.map((call) => call[0]).filter((args) => typeof args.take === "number");
    expect(reads.map((args) => [args.skip, args.take])).toEqual([[50, 10], [0, 40]]);
    expect(JSON.stringify(reads[0].where)).toContain('"not":""');
    expect(JSON.stringify(reads[1].where)).toContain('"category":""');
  });

  it("answers Select all N matching with every id, and only the count past the bulk limit", async () => {
    mocks.calendarCount.mockResolvedValueOnce(3);
    mocks.calendarFindMany.mockResolvedValueOnce([{ id: "a" }, { id: "b" }, { id: "c" }]);
    expect(await listMatchingCalendarEntryIds({ ...defaultEntryFilters, time: "all" }, now)).toEqual({ ids: ["a", "b", "c"], total: 3, limit: maxBulkEntries });
    mocks.calendarCount.mockResolvedValueOnce(maxBulkEntries + 1);
    mocks.calendarFindMany.mockClear();
    expect(await listMatchingCalendarEntryIds({ ...defaultEntryFilters, time: "all" }, now)).toEqual({ ids: [], total: maxBulkEntries + 1, limit: maxBulkEntries });
    expect(mocks.calendarFindMany).not.toHaveBeenCalled();
  });
});

describe("the select-all routes keep the list's own gate", () => {
  it("calendar: closed to anyone but a system administrator, and uses the address's filters", async () => {
    mocks.requireSystemAdministrator.mockRejectedValueOnce(new AccessDeniedError("No.", 403, "PERMISSION_DENIED"));
    expect((await CALENDAR_MATCHING(new Request("https://events.imsda.test/api/admin/calendar/entries/matching-ids"))).status).toBe(403);
    expect((await CALENDAR_LIST(new Request("https://events.imsda.test/api/admin/calendar/entries"))).status).toBeLessThan(500);
    mocks.requireSystemAdministrator.mockRejectedValueOnce(new AccessDeniedError("No.", 403, "PERMISSION_DENIED"));
    expect((await CALENDAR_LIST(new Request("https://events.imsda.test/api/admin/calendar/entries"))).status).toBe(403);
    mocks.calendarCount.mockResolvedValue(1);
    mocks.calendarFindMany.mockResolvedValue([{ id: "a" }]);
    const ok = await CALENDAR_MATCHING(new Request("https://events.imsda.test/api/admin/calendar/entries/matching-ids?state=draft&time=all&q=rally"));
    expect(await ok.json()).toEqual({ ids: ["a"], total: 1, limit: maxBulkEntries });
    expect(JSON.stringify(mocks.calendarCount.mock.calls.at(-1)![0].where)).toContain('"isPublished":false');
  });

  it("staff invitations: needs MANAGE_REGISTRATION for this event, and reads only this event's rows", async () => {
    const context = { params: Promise.resolve({ eventId: "event-1" }) };
    mocks.requirePermission.mockRejectedValueOnce(new AccessDeniedError("No.", 403, "PERMISSION_DENIED"));
    expect((await INVITATION_MATCHING(new Request("https://events.imsda.test/x"), context)).status).toBe(403);
    expect(mocks.requirePermission.mock.calls[0]![1]).toBe("event-1");
    expect(mocks.requirePermission.mock.calls[0]![2]).toBe("MANAGE_REGISTRATION");
    mocks.eventFindUnique.mockResolvedValue({ id: "event-1", audience: "GENERAL" });
    mocks.invitationCount.mockResolvedValue(2);
    mocks.invitationFindMany.mockResolvedValue([{ id: "i1" }, { id: "i2" }]);
    const ok = await INVITATION_MATCHING(new Request("https://events.imsda.test/x?status=SENT&group=STAFF&q=ada"), context);
    expect(await ok.json()).toEqual({ ids: ["i1", "i2"], total: 2, limit: 2000 });
    const where = mocks.invitationFindMany.mock.calls.at(-1)![0].where;
    expect(where).toMatchObject({ eventId: "event-1", supersededAt: null });
    expect(JSON.stringify(where)).toContain('"group":"STAFF"');
  });

  it("the delivery log refresh passes the address's status and page to the event-scoped loader", async () => {
    mocks.getMessagingWorkspace.mockResolvedValue({ messages: [] });
    const context = { params: Promise.resolve({ eventId: "event-1" }) };
    expect((await MESSAGES(new Request("https://events.imsda.test/x?status=FAILED&page=4"), context)).status).toBe(200);
    expect(mocks.requirePermission.mock.calls[0]![2]).toBe("MANAGE_COMMUNICATIONS");
    expect(mocks.getMessagingWorkspace).toHaveBeenCalledWith("event-1", { status: "FAILED", page: 4 });
    await MESSAGES(new Request("https://events.imsda.test/x?status=bogus&page=-1"), context);
    expect(mocks.getMessagingWorkspace).toHaveBeenLastCalledWith("event-1", { status: "ALL", page: 1 });
  });
});

describe("the staff invitation page", () => {
  it("counts, clamps and reads one page for the event, and the status order is a window over one read per status", async () => {
    mocks.eventFindUnique.mockResolvedValue({ id: "event-1", audience: "GENERAL" });
    mocks.invitationCount.mockImplementation(async (args: { where: Record<string, unknown> }) => (JSON.stringify(args.where).includes("revokedAt") ? 3 : 120));
    mocks.invitationFindMany.mockResolvedValue([]);
    const result = await listInvitations("event-1", { filters: { status: "ALL", group: "ALL", search: "" }, sort: { key: null, dir: "asc" }, page: 99 });
    expect(result).toMatchObject({ total: 120, page: 3, pageSize: 50 });
    const read = mocks.invitationFindMany.mock.calls.at(-1)![0];
    expect(read).toMatchObject({ skip: 100, take: 50 });
    expect(read.where).toMatchObject({ eventId: "event-1", supersededAt: null });
    expect(read.orderBy.at(-1)).toEqual({ id: "asc" });
    mocks.invitationFindMany.mockClear();
    await listInvitations("event-1", { filters: { status: "ALL", group: "ALL", search: "" }, sort: { key: "status", dir: "asc" }, page: 1 });
    // One read per status that has rows, each scoped to the event.
    for (const call of mocks.invitationFindMany.mock.calls) expect(call[0].where).toMatchObject({ eventId: "event-1", supersededAt: null });
  });

  it("answers Select all N matching only for people of this event, and only the count past the limit", async () => {
    mocks.eventFindUnique.mockResolvedValue({ id: "event-1", audience: "GENERAL" });
    mocks.invitationCount.mockResolvedValueOnce(2001);
    expect(await listMatchingInvitationIds("event-1", { status: "ALL", group: "ALL", search: "" })).toEqual({ ids: [], total: 2001, limit: 2000 });
    expect(mocks.invitationFindMany).not.toHaveBeenCalled();
  });
});

describe("pending invites on People & access: three sources, one list", () => {
  const club = (index: number, sent: string | null) => ({ id: `c${index}`, email: `club${index}@example.test`, name: "", role: "DIRECTOR", sentAt: sent ? new Date(sent) : null, createdAt: new Date("2026-10-01T00:00:00Z"), expiresAt: null, organization: { name: "Synthetic Club" } });
  const area = (index: number, sent: string) => ({ id: `a${index}`, email: `area${index}@example.test`, name: "", sentAt: new Date(sent), createdAt: new Date("2026-10-01T00:00:00Z"), expiresAt: null });
  const staff = (index: number, created: string) => ({ id: `s${index}`, email: `staff${index}@example.test`, displayName: "", createdAt: new Date(created), resetTokens: [{ createdAt: new Date(created), expiresAt: new Date("2026-12-01T00:00:00Z"), usedAt: null }] });

  it("totals all three sources, reads skip plus a page from each, and merges newest first", async () => {
    mocks.clubInviteCount.mockResolvedValue(60);
    mocks.areaCount.mockResolvedValue(40);
    mocks.userFindMany.mockResolvedValue([staff(1, "2026-10-20T00:00:00Z")]);
    mocks.clubInviteFindMany.mockImplementation(async (args: { where: { AND: Array<{ sentAt?: unknown }> } }) => (args.where.AND[1]!.sentAt === null ? [] : [club(1, "2026-10-22T00:00:00Z"), club(2, "2026-10-18T00:00:00Z")]));
    mocks.areaFindMany.mockImplementation(async (args: { where: { AND: Array<{ sentAt?: unknown }> } }) => (args.where.AND[1]!.sentAt === null ? [] : [area(1, "2026-10-21T00:00:00Z")]));
    const page = await listPendingInvitesPage({ scope: "full" }, 2, now);
    expect(page).toMatchObject({ total: 101, page: 2, pageSize: PENDING_INVITES_PAGE_SIZE });
    // Page 2 asks each source for its newest 2 x 25 = 50 rows, and the merged list is cut to rows 26 to 50.
    for (const call of [...mocks.clubInviteFindMany.mock.calls, ...mocks.areaFindMany.mock.calls]) expect(call[0].take).toBe(50);
    expect(page.invites).toEqual([]);
    const first = await listPendingInvitesPage({ scope: "full" }, 1, now);
    expect(first.invites.map((invite) => `${invite.kind}:${invite.id}`)).toEqual(["club:c1", "area:a1", "staff:s1", "club:c2"]);
  });

  it("clamps a page past the end to the last page", async () => {
    mocks.clubInviteCount.mockResolvedValue(30);
    mocks.areaCount.mockResolvedValue(0);
    mocks.userFindMany.mockResolvedValue([]);
    mocks.clubInviteFindMany.mockResolvedValue([club(1, "2026-10-22T00:00:00Z")]);
    expect((await listPendingInvitesPage({ scope: "clubs" }, 99, now)).page).toBe(2);
  });

  it("never reads staff logins for a Clubs Administrator, in either read", async () => {
    mocks.clubInviteCount.mockResolvedValue(0);
    mocks.areaCount.mockResolvedValue(0);
    mocks.clubInviteFindMany.mockResolvedValue([]);
    mocks.areaFindMany.mockResolvedValue([]);
    await listPendingInvitesPage({ scope: "clubs" }, 1, now);
    await listPendingInvites({ scope: "clubs" }, now);
    expect(mocks.userFindMany).not.toHaveBeenCalled();
  });

  it("keeps the club scope on every club read: PEOPLE invites in CLUB organizations, still open", async () => {
    mocks.clubInviteCount.mockResolvedValue(1);
    mocks.areaCount.mockResolvedValue(0);
    mocks.userFindMany.mockResolvedValue([]);
    mocks.clubInviteFindMany.mockResolvedValue([]);
    await listPendingInvitesPage({ scope: "full", query: "pat" }, 1, now);
    const where = JSON.stringify(mocks.clubInviteCount.mock.calls[0]![0].where);
    expect(where).toContain('"source":"PEOPLE"');
    expect(where).toContain('"type":"CLUB"');
    expect(where).toContain('"PENDING","SENT"');
    expect(where).toContain('"contains":"pat"');
  });
});
