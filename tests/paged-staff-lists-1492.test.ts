import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { segmentWindows } from "@/lib/segment-window";
import { parseSortParams } from "@/lib/list-sort";
import {
  buildDeliveryWhere,
  DEFAULT_DELIVERY_QUERY,
  DELIVERY_FILTERS,
  DELIVERY_ORDER_BY,
  DELIVERY_PAGE_SIZE,
  parseDeliveryQuery,
} from "@/modules/communications/delivery-log-model";
import {
  buildEntryWhere,
  CALENDAR_ENTRY_PAGE_SIZE,
  defaultEntryFilters,
  entryOrderBy,
  entryQueryParams,
  parseEntryQuery,
  parseEntrySort,
  type EntryFilters,
} from "@/modules/calendar/admin-list";
import {
  buildInvitationWhere,
  INVITATION_BULK_LIMIT,
  INVITATION_DEFAULT_SORT,
  INVITATION_PAGE_SIZE,
  INVITATION_SORT_COLUMNS,
  invitationListHref,
  invitationOrderBy,
  invitationStatusSortOrder,
  invitationStatusWhere,
  parseInvitationFilters,
  parseInvitationQuery,
} from "@/modules/staff-invitations/list-query";
import { INVITATION_STATUSES, INVITATION_STATUS_LABEL } from "@/modules/staff-invitations/domain";

/** The four capped staff lists are paged in the database (#1492): the pure query building, with synthetic values only. */

describe("segmentWindows: a page across ordered runs", () => {
  it("takes a page from one run when it fits", () => {
    expect(segmentWindows([120, 40], 0, 50)).toEqual([{ segment: 0, skip: 0, take: 50 }]);
    expect(segmentWindows([120, 40], 50, 50)).toEqual([{ segment: 0, skip: 50, take: 50 }]);
  });

  it("spans two runs at the boundary and starts the second from its own beginning", () => {
    expect(segmentWindows([60, 40], 50, 50)).toEqual([{ segment: 0, skip: 50, take: 10 }, { segment: 1, skip: 0, take: 40 }]);
  });

  it("skips whole runs, tolerates empty runs and stops at the end", () => {
    expect(segmentWindows([10, 0, 20], 12, 50)).toEqual([{ segment: 2, skip: 2, take: 18 }]);
    expect(segmentWindows([10, 5], 100, 50)).toEqual([]);
    expect(segmentWindows([], 0, 50)).toEqual([]);
  });

  it("covers every row exactly once across all pages", () => {
    const counts = [7, 0, 23, 1, 14];
    const total = counts.reduce((sum, count) => sum + count, 0);
    const seen: string[] = [];
    for (let skip = 0; skip < total; skip += 6) {
      for (const window of segmentWindows(counts, skip, 6)) for (let index = 0; index < window.take; index += 1) seen.push(`${window.segment}:${window.skip + index}`);
    }
    expect(seen).toHaveLength(total);
    expect(new Set(seen).size).toBe(total);
  });
});

describe("pending invites tie order (#1492)", () => {
  it("breaks ties on the id with a plain comparison, newest first", async () => {
    vi.mock("server-only", () => ({}));
    const { comparePendingInvites } = await import("@/modules/system-admin/pending-invites");
    const row = (id: string, sentAt: string, kind: "club" | "area" | "staff" = "club") => ({ kind, id, name: "", email: "z@example.test", what: "", sentAt, expired: false });
    const sorted = [row("b", "2026-10-01T00:00:00.000Z"), row("a", "2026-10-02T00:00:00.000Z"), row("a", "2026-10-01T00:00:00.000Z", "area"), row("C", "2026-10-01T00:00:00.000Z")]
      .sort(comparePendingInvites).map((entry) => `${entry.kind}:${entry.id}`);
    // Newest first; on a tie the id by code unit ("C" before "a"), then the kind.
    expect(sorted).toEqual(["club:a", "club:C", "area:a", "club:b"]);
  });
});

describe("the delivery log query (#1492)", () => {
  it("reads only listed statuses and a positive page, otherwise All and page 1", () => {
    expect(parseDeliveryQuery({ status: "FAILED", page: "3" })).toEqual({ status: "FAILED", page: 3 });
    expect(parseDeliveryQuery({ status: "FAILED; DROP", page: "-4" })).toEqual({ status: "ALL", page: 1 });
    expect(parseDeliveryQuery({ status: ["SENT", "FAILED"], page: ["2", "9"] })).toEqual({ status: "SENT", page: 2 });
    expect(parseDeliveryQuery({})).toEqual(DEFAULT_DELIVERY_QUERY);
    expect(DELIVERY_FILTERS).toContain("ALL");
  });

  it("always scopes to the event, and narrows by status in the database", () => {
    const all = buildDeliveryWhere("event-1", "ALL") as Record<string, unknown>;
    expect(all.eventId).toBe("event-1");
    // Only event messages: a row with an event id but another kind of key (an invoice, a form submission) or an account recipient is not in the total, the counts or the page.
    expect((all.templateKey as { in: string[] }).in).toContain("CUSTOM_MESSAGE");
    expect((all.templateKey as { in: string[] }).in).not.toContain("INVOICE_DELIVERY");
    expect((all.templateKey as { in: string[] }).in).not.toContain("INFORMATION_FORM_SUBMITTED");
    expect(all.recipientKind).toEqual({ not: "ACCOUNT" });
    expect(all.status).toBeUndefined();
    expect(buildDeliveryWhere("event-1", "FAILED")).toMatchObject({ eventId: "event-1", status: "FAILED", recipientKind: { not: "ACCOUNT" } });
  });

  it("orders newest first and ends in the id, with 50 to a page and no cap", () => {
    expect(DELIVERY_ORDER_BY).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
    expect(DELIVERY_PAGE_SIZE).toBe(50);
  });
});

describe("the calendar entries query (#1492)", () => {
  const filters = (patch: Partial<EntryFilters> = {}): EntryFilters => ({ ...defaultEntryFilters, time: "all", ...patch });

  it("reads the address, and writes back only what differs from the default", () => {
    const query = parseEntryQuery(new URLSearchParams("q=rally&category=Youth&state=draft&time=past&sort=title&page=3"));
    expect(query).toMatchObject({ filters: { search: "rally", category: "Youth", state: "draft", time: "past" }, sort: "title", page: 3 });
    expect(entryQueryParams(query).toString()).toBe("q=rally&category=Youth&state=draft&time=past&sort=title&page=3");
    expect(entryQueryParams(parseEntryQuery(new URLSearchParams(""))).toString()).toBe("");
  });

  it("never lets a raw sort or page value through", () => {
    expect(parseEntrySort("title; DROP TABLE")).toBe("date");
    expect(parseEntrySort("__proto__")).toBe("date");
    expect(parseEntrySort(null)).toBe("date");
    expect(parseEntryQuery(new URLSearchParams("page=abc&sort=zzz")).page).toBe(1);
    expect(parseEntryQuery(new URLSearchParams("page=0")).page).toBe(1);
    expect(parseEntryQuery(new URLSearchParams("q=" + "x".repeat(300))).filters.search).toHaveLength(100);
  });

  it("builds the where-clause from each filter", () => {
    expect(buildEntryWhere(filters(), "2026-11-02", [])).toEqual({});
    const and = (where: unknown) => (where as { AND: unknown[] }).AND;
    expect(and(buildEntryWhere(filters({ search: " pathfinder " }), "2026-11-02", []))[0]).toEqual({ OR: [
      { title: { contains: "pathfinder", mode: "insensitive" } },
      { location: { contains: "pathfinder", mode: "insensitive" } },
      { description: { contains: "pathfinder", mode: "insensitive" } },
    ] });
    expect(and(buildEntryWhere(filters({ category: "__none__" }), "2026-11-02", []))).toEqual([{ category: "" }]);
    expect(and(buildEntryWhere(filters({ category: "Youth" }), "2026-11-02", []))).toEqual([{ category: "Youth" }]);
    expect(and(buildEntryWhere(filters({ source: "__staff__" }), "2026-11-02", []))).toEqual([{ sourceFeedId: null }]);
    expect(and(buildEntryWhere(filters({ source: "feed-1" }), "2026-11-02", []))).toEqual([{ sourceFeedId: "feed-1" }]);
    expect(and(buildEntryWhere(filters({ entryType: "DEADLINE" }), "2026-11-02", []))).toEqual([{ entryType: "DEADLINE" }]);
    expect(and(buildEntryWhere(filters({ state: "published" }), "2026-11-02", []))).toEqual([{ isPublished: true }]);
    expect(and(buildEntryWhere(filters({ state: "draft" }), "2026-11-02", []))).toEqual([{ isPublished: false }]);
    expect(and(buildEntryWhere(filters({ state: "hidden" }), "2026-11-02", []))).toEqual([{ isHiddenLocally: true }]);
    expect(and(buildEntryWhere(filters({ state: "removed" }), "2026-11-02", []))).toEqual([{ sourceRemovedAt: { not: null } }]);
  });

  it("keeps a repeating entry that began in the past in Upcoming, and out of Past (the series ids decide)", () => {
    const upcoming = buildEntryWhere(filters({ time: "upcoming" }), "2026-11-02", ["series-open"]) as { AND: unknown[] };
    expect(upcoming.AND).toEqual([{ OR: [{ endsOn: { gte: "2026-11-02" } }, { id: { in: ["series-open"] } }] }]);
    const past = buildEntryWhere(filters({ time: "past" }), "2026-11-02", ["series-open"]) as { AND: unknown[] };
    expect(past.AND).toEqual([{ endsOn: { lt: "2026-11-02" }, id: { notIn: ["series-open"] } }]);
  });

  it("orders by a whitelisted sort and ends every order in the id", () => {
    for (const sort of ["date", "title", "category"] as const) {
      const order = entryOrderBy(sort);
      expect(order[order.length - 1]).toEqual({ id: "asc" });
    }
    expect(entryOrderBy("title")[0]).toEqual({ title: "asc" });
    expect(entryOrderBy("category")[0]).toEqual({ category: "asc" });
    expect(entryOrderBy("date")[0]).toEqual({ startsOn: "asc" });
    expect(CALENDAR_ENTRY_PAGE_SIZE).toBe(50);
  });
});

describe("the staff invitation list query (#1492)", () => {
  it("reads the address, with anything unlisted meaning All", () => {
    expect(parseInvitationFilters({ status: "SENT", group: "PASTOR", q: "  ada  " })).toEqual({ status: "SENT", group: "PASTOR", search: "ada" });
    expect(parseInvitationFilters({ status: "NOPE", group: "x", q: ["a", "b"] })).toEqual({ status: "ALL", group: "ALL", search: "a" });
    expect(parseInvitationFilters({})).toEqual({ status: "ALL", group: "ALL", search: "" });
  });

  it("accepts only whitelisted sort columns, and falls back to the default order", () => {
    expect(INVITATION_SORT_COLUMNS).toEqual(["person", "group", "status"]);
    expect(parseInvitationQuery({ sort: "status", dir: "desc", page: "4" })).toMatchObject({ sort: { key: "status", dir: "desc" }, page: 4 });
    for (const bad of ["email; DROP", "__proto__", "createdAt", ""]) {
      expect(parseSortParams({ sort: bad, dir: "desc" }, INVITATION_SORT_COLUMNS, INVITATION_DEFAULT_SORT).key).toBeNull();
    }
    expect(parseInvitationQuery({ page: "zero" }).page).toBe(1);
  });

  it("scopes every query to the event's current invitations", () => {
    const where = buildInvitationWhere("event-1", { status: "ALL", group: "ALL", search: "" }) as Record<string, unknown>;
    expect(where).toEqual({ eventId: "event-1", supersededAt: null });
    const narrowed = buildInvitationWhere("event-1", { status: "REVOKED", group: "STAFF", search: "ada love" }) as { eventId: string; supersededAt: null; AND: unknown[] };
    expect(narrowed.eventId).toBe("event-1");
    expect(narrowed.supersededAt).toBeNull();
    expect(narrowed.AND).toHaveLength(3);
    // Every word must match the email, first name or last name.
    expect(narrowed.AND[1]).toEqual({ AND: [
      { OR: [{ email: { contains: "ada", mode: "insensitive" } }, { firstName: { contains: "ada", mode: "insensitive" } }, { lastName: { contains: "ada", mode: "insensitive" } }] },
      { OR: [{ email: { contains: "love", mode: "insensitive" } }, { firstName: { contains: "love", mode: "insensitive" } }, { lastName: { contains: "love", mode: "insensitive" } }] },
    ] });
  });

  it("leaves the status out when asked, for the counts and the status order", () => {
    expect(buildInvitationWhere("event-1", { status: "SENT", group: "ALL", search: "" }, { withStatus: false })).toEqual({ eventId: "event-1", supersededAt: null });
  });

  it("has a database condition for every status, matching the words the list shows", () => {
    for (const status of INVITATION_STATUSES) expect(invitationStatusWhere(status)).toBeTruthy();
    expect(invitationStatusWhere("REVOKED")).toEqual({ revokedAt: { not: null } });
    expect(invitationStatusWhere("NOT_SENT")).toMatchObject({ revokedAt: null, registeredAt: null, sentAt: null });
    expect(invitationStatusWhere("APPROVED")).toMatchObject({ registeredAt: { not: null }, approval: "APPROVED" });
    expect(invitationStatusWhere("REGISTERED")).toMatchObject({ OR: [{ approval: null }, { approval: "WAITING" }] });
    // "Sent" is every sent link that has not failed, including one whose provider status is not yet known.
    expect(JSON.stringify(invitationStatusWhere("SENT"))).toContain('"providerDeliveryStatus":null');
    expect(JSON.stringify(invitationStatusWhere("DELIVERY_FAILED"))).toContain("BOUNCED");
  });

  it("orders by whitelisted columns and always ends in the id", () => {
    expect(invitationOrderBy({ key: "person", dir: "desc" })[0]).toEqual({ lastName: "desc" });
    expect(invitationOrderBy({ key: "group", dir: "asc" })[0]).toEqual({ group: "asc" });
    expect(invitationOrderBy(INVITATION_DEFAULT_SORT)[0]).toEqual({ group: "asc" });
    for (const key of [null, ...INVITATION_SORT_COLUMNS] as const) {
      const order = invitationOrderBy({ key, dir: "asc" });
      expect(order[order.length - 1]).toEqual({ id: "asc" });
    }
  });

  it("sorts the status column by the status words, and reverses it", () => {
    const labels = invitationStatusSortOrder("asc").map((status) => INVITATION_STATUS_LABEL[status]);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, "en")));
    expect(invitationStatusSortOrder("desc")).toEqual([...invitationStatusSortOrder("asc")].reverse());
  });

  it("writes only what differs from the default into the address, and bounds one selection", () => {
    const base = { filters: { status: "ALL" as const, group: "ALL" as const, search: "" }, sort: INVITATION_DEFAULT_SORT, page: 1 };
    expect(invitationListHref("/people/staff-invitations", "event-1", base)).toBe("/people/staff-invitations?event=event-1");
    expect(invitationListHref("/people/staff-invitations", "event-1", { filters: { status: "SENT", group: "VOLUNTEER", search: "ada" }, sort: { key: "status", dir: "desc" }, page: 3 }))
      .toBe("/people/staff-invitations?event=event-1&status=SENT&group=VOLUNTEER&q=ada&sort=status&dir=desc&page=3");
    expect(INVITATION_BULK_LIMIT).toBe(2000);
    expect(INVITATION_PAGE_SIZE).toBe(50);
  });
});

describe("the four staff lists are not capped any more (#1492)", () => {
  const read = (file: string) => readFileSync(path.resolve(__dirname, "..", file), "utf8");

  it("the delivery log has no server cap or cap notice", () => {
    const source = read("components/communications-workspace.tsx");
    expect(source).not.toMatch(/DELIVERY_SERVER_CAP|holds the newest|take: 150/);
    expect(read("modules/communications/messaging-repository.ts")).not.toMatch(/take: 150\b/);
  });

  it("the calendar list has no entry limit or cap notice", () => {
    expect(read("modules/calendar/admin-list.ts")).not.toContain("calendarEntryListLimit");
    expect(read("modules/calendar/repository.ts")).not.toContain("calendarEntryListLimit");
    expect(read("components/calendar-admin-workspace.tsx")).not.toMatch(/calendarEntryListLimit|are not loaded/);
  });

  it("the invite list has no 2,000-person cut-off and no truncated flag", () => {
    const source = read("components/staff-invitation-list.tsx");
    expect(source).not.toMatch(/cut off|truncated/);
    expect(read("app/(workspace)/people/staff-invitations/page.tsx")).not.toContain("truncated");
  });

  it("the pending invites list has no newest-50 cap", () => {
    expect(read("modules/system-admin/pending-invites.ts")).not.toMatch(/PENDING_INVITES_CAP/);
    expect(read("components/people-directory.tsx")).not.toMatch(/pendingCapped|The newest|Older ones are not listed/);
    expect(read("app/(workspace)/admin/people/page.tsx")).not.toContain("PENDING_INVITES_CAP");
  });
});
