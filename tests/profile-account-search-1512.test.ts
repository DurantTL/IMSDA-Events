import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  writeAuditLog: vi.fn(),
  getCurrentSession: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));

import { GET as search } from "@/app/api/people/profile-updates/accounts/search/route";
import { GET as open } from "@/app/api/people/profile-updates/accounts/[accountId]/route";
import { ACCOUNT_SEARCH_MIN_LENGTH, ACCOUNT_SEARCH_RESULT_LIMIT } from "@/modules/attendee-accounts/account-search-staff";
import { ACCOUNT_SEARCH_MIN } from "@/components/profile-account-search";

const attendeeAccount = { findMany: vi.fn(), findUnique: vi.fn() };

const run = (handler: unknown, url: string, params?: { accountId: string }) =>
  (handler as (request: Request, context?: unknown) => Promise<Response>)(
    new Request(url),
    params ? { params: Promise.resolve(params) } : undefined,
  );
const doSearch = (query: string) => run(search, `https://events.imsda.test/api/people/profile-updates/accounts/search?q=${encodeURIComponent(query)}`);
const doOpen = (accountId = "acct-1") => run(open, `https://events.imsda.test/api/people/profile-updates/accounts/${accountId}`, { accountId });
const session = (globalRole: string | null) => mocks.getCurrentSession.mockResolvedValue({
  user: { id: "usr-admin", email: "admin@example.test", displayName: "Admin Person", globalRole },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getPrisma.mockReturnValue({ attendeeAccount });
  mocks.writeAuditLog.mockResolvedValue(undefined);
  attendeeAccount.findMany.mockResolvedValue([
    { id: "acct-1", displayName: "Avery Person", email: "avery@example.test", status: "ACTIVE", disabledAt: null },
    { id: "acct-2", displayName: "Averil Sample", email: "averil@example.test", status: "PENDING_VERIFICATION", disabledAt: null },
  ]);
  attendeeAccount.findUnique.mockResolvedValue({ displayName: "Avery Person", firstName: "Avery", lastName: "Person", phone: null, shirtSize: "M" });
  session("SYSTEM_ADMIN");
});

describe("GET account search", () => {
  it("is 401 without a session and 403 for everyone who is not a system administrator, reading and auditing nothing", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    expect((await doSearch("avery")).status).toBe(401);
    for (const role of [null, "CLUBS_ADMIN", "EVENTS_ADMIN"]) {
      session(role);
      expect((await doSearch("avery")).status).toBe(403);
    }
    expect(mocks.getPrisma).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("refuses a query that is too short once trimmed, reading and auditing nothing", async () => {
    for (const query of ["", "  ", "av", "  a  b ".slice(0, 4)]) {
      const response = await doSearch(query);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe("QUERY_TOO_SHORT");
    }
    expect(attendeeAccount.findMany).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("searches name and email case-insensitively with a cap, selecting only id, display name and email", async () => {
    const response = await doSearch("  AVER  ");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    const call = attendeeAccount.findMany.mock.calls[0]![0];
    const contains = { contains: "AVER", mode: "insensitive" };
    expect(call.where).toEqual({ OR: [{ displayName: contains }, { firstName: contains }, { lastName: contains }, { email: contains }] });
    expect(call.take).toBe(ACCOUNT_SEARCH_RESULT_LIMIT);
    expect(call.select).toEqual({ id: true, displayName: true, email: true, status: true, disabledAt: true });
  });

  it("returns only the account id, display name and email, nothing personal", async () => {
    attendeeAccount.findMany.mockResolvedValue([
      { id: "acct-1", displayName: "Avery Person", email: "avery@example.test", status: "ACTIVE", disabledAt: null, phone: "(515) 555-0100", mailingLine1: "1 Example Way", emergencyContactName: "Casey" },
    ]);
    const body = await (await doSearch("avery")).json();
    expect(body).toEqual({
      results: [{ accountId: "acct-1", displayName: "Avery Person", email: "avery@example.test", note: null }],
      limit: ACCOUNT_SEARCH_RESULT_LIMIT,
    });
    expect(JSON.stringify(body)).not.toMatch(/555|Example Way|Casey|person(Id|Merge)/);
  });

  it("notes accounts that are disabled or not verified, in plain words", async () => {
    attendeeAccount.findMany.mockResolvedValue([
      { id: "a", displayName: "A One", email: "a@example.test", status: "ACTIVE", disabledAt: new Date("2027-01-01") },
      { id: "b", displayName: "B Two", email: "b@example.test", status: "PENDING_VERIFICATION", disabledAt: null },
      { id: "c", displayName: "C Three", email: "c@example.test", status: "ACTIVE", disabledAt: null },
    ]);
    const body = await (await doSearch("exam")).json();
    expect(body.results.map((result: { note: string | null }) => result.note)).toEqual(["Disabled", "Not verified", null]);
    expect(JSON.stringify(body)).not.toMatch(/disabledAt|2027/);
  });

  it("writes the audit with ids and the query length only, never the query, names or emails", async () => {
    await doSearch("avery person");
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
    const entry = mocks.writeAuditLog.mock.calls[0]![0];
    expect(entry.actorUserId).toBe("usr-admin");
    expect(entry.metadata).toEqual({
      queryLength: 12,
      surface: "ATTENDEE_ACCOUNT_SEARCH",
      resultCount: 2,
      resultIds: ["acct-1", "acct-2"],
      truncated: false,
    });
    expect(JSON.stringify(entry.metadata) + entry.summary).not.toMatch(/avery|averil|sample|example\.test|person/i);
  });

  it("audits a search with no results too", async () => {
    attendeeAccount.findMany.mockResolvedValue([]);
    const response = await doSearch("nobody");
    expect((await response.json()).results).toEqual([]);
    expect(mocks.writeAuditLog.mock.calls[0]![0].metadata).toMatchObject({ resultCount: 0, resultIds: [] });
  });

  it("returns no results when the audit cannot be written", async () => {
    mocks.writeAuditLog.mockRejectedValueOnce(new Error("audit down"));
    const response = await doSearch("avery");
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toMatch(/avery@example\.test/);
  });

  it("caps an overlong query", async () => {
    await doSearch("x".repeat(500));
    expect(attendeeAccount.findMany.mock.calls[0]![0].where.OR[0].displayName.contains).toHaveLength(100);
  });

  it("keeps the page's minimum in step with the server's", () => {
    expect(ACCOUNT_SEARCH_MIN).toBe(ACCOUNT_SEARCH_MIN_LENGTH);
  });
});

describe("GET open account", () => {
  it("is 401 without a session and 403 for staff who are not system administrators, reading nothing", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    expect((await doOpen()).status).toBe(401);
    session("CLUBS_ADMIN");
    expect((await doOpen()).status).toBe(403);
    expect(mocks.getPrisma).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("returns name, phone and shirt size for one account, selecting no address or emergency contact", async () => {
    const response = await doOpen();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      accountId: "acct-1",
      accountName: "Avery Person",
      current: { firstName: "Avery", lastName: "Person", phone: "", shirtSize: "M" },
    });
    expect(attendeeAccount.findUnique.mock.calls[0]![0].select).toEqual({ displayName: true, firstName: true, lastName: true, phone: true, shirtSize: true });
  });

  it("audits the opened account by id before returning, and fails the read when the audit fails", async () => {
    await doOpen();
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({
      actorUserId: "usr-admin",
      entityId: "acct-1",
      metadata: { surface: "ATTENDEE_ACCOUNT_OPENED", resultCount: 1, resultIds: ["acct-1"] },
    });
    mocks.writeAuditLog.mockRejectedValueOnce(new Error("audit down"));
    const failed = await doOpen();
    expect(failed.status).toBe(500);
    expect(JSON.stringify(await failed.json())).not.toMatch(/Avery/);
  });

  it("is 404 for an unknown account and writes no audit", async () => {
    attendeeAccount.findUnique.mockResolvedValue(null);
    expect((await doOpen()).status).toBe(404);
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});

describe("the page", () => {
  it("shows the search on the Profile updates list, with or without changes", () => {
    const source = readFileSync(join(process.cwd(), "components/profile-updates-review.tsx"), "utf8");
    expect(source.match(/<ProfileAccountSearch \/>/g)).toHaveLength(2);
  });
});
