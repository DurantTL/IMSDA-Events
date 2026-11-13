import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  settingsFindUnique: vi.fn(),
  settingsUpsert: vi.fn(),
  grantFindMany: vi.fn(),
  prefFindUnique: vi.fn(),
  prefUpsert: vi.fn(),
  writeAuditLog: vi.fn(),
  getCurrentAttendee: vi.fn(),
  accountNeedsSecondStep: vi.fn(),
  getCurrentSession: vi.fn(),
  areaGrantFindUnique: vi.fn(),
  attendeeSignInStepPending: vi.fn(),
  crossOrigin: null as Response | null,
}));

const client = {
  platformSettings: { findUnique: mocks.settingsFindUnique, upsert: mocks.settingsUpsert },
  clubDirectorGrant: { findMany: mocks.grantFindMany },
  leaderDirectoryPreference: { findUnique: mocks.prefFindUnique, upsert: mocks.prefUpsert },
  areaCoordinatorGrant: { findUnique: mocks.areaGrantFindUnique },
  $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(client),
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => client }));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => mocks.crossOrigin }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee, findSwitchableAttendeeAccountForStaff: vi.fn() }));
vi.mock("@/modules/attendee-accounts/sign-in-gate", () => ({ accountNeedsSecondStep: mocks.accountNeedsSecondStep }));
vi.mock("@/modules/attendee-accounts/portal-second-step", () => ({ attendeeSignInStepPending: mocks.attendeeSignInStepPending }));

import { PATCH as ADMIN_SWITCH } from "@/app/api/admin/platform-settings/leader-directory/route";
import { PATCH as CHOICES } from "@/app/api/attendee/leader-directory/route";
import { currentLeaderDirectoryViewer } from "@/modules/leader-directory/access";
import {
  buildLeaderEntries,
  canViewLeaderDirectory,
  filterLeaderEntries,
  parseLeaderFilters,
  type LeaderGrantRow,
} from "@/modules/leader-directory/domain";
import {
  leaderDirectorySelect,
  readLeaderDirectory,
  recordLeaderDirectoryView,
  saveLeaderChoices,
  setLeaderDirectoryEnabled,
} from "@/modules/leader-directory/repository";

const ORIGIN = "https://events.imsda.test";
const attendee = { account: { id: "acct-1" }, via: "attendee", sessionId: "s1" };
const signedOut = { account: null, via: null, sessionId: null };

/** The viewer's own club grants as listDirectedClubs reads them (the same findMany, filtered by account). */
function viewerGrants(roles: string[], guestEventId: string | null = null) {
  return roles.map((role) => ({ role, organization: { id: `club-${role}`, name: `Club ${role}`, guestEventId, parentOrganization: null } }));
}

function setup(options: { guest?: boolean; enabled?: boolean; who?: "attendee" | "staffActAs" | "anonymous"; roles?: string[]; areaCoordinator?: boolean; secondStep?: "OK" | "VERIFY" }) {
  mocks.settingsFindUnique.mockResolvedValue({ leaderDirectoryEnabled: options.enabled ?? true });
  const who = options.who ?? "attendee";
  mocks.getCurrentAttendee.mockResolvedValue(who === "attendee" ? attendee : signedOut);
  mocks.accountNeedsSecondStep.mockResolvedValue(options.secondStep ?? "OK");
  // listDirectedClubs asks for the viewer's own grants; the directory read asks for everyone's.
  mocks.grantFindMany.mockImplementation(async (args: { where: { attendeeAccountId?: string } }) => (args.where.attendeeAccountId ? viewerGrants(options.roles ?? [], options.guest ? "event-guest" : null) : []));
  mocks.areaGrantFindUnique.mockResolvedValue(options.areaCoordinator ? { revokedAt: null, expiresAt: null } : null);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.crossOrigin = null;
  mocks.attendeeSignInStepPending.mockResolvedValue(false);
  mocks.getCurrentSession.mockResolvedValue({ user: { id: "admin-1", globalRole: "SYSTEM_ADMIN" } });
  mocks.writeAuditLog.mockResolvedValue(undefined);
});

describe("who can open the leader directory (#1707)", () => {
  it.each([
    ["a club director", { roles: ["DIRECTOR"] }, true],
    ["a deputy", { roles: ["DEPUTY"] }, true],
    ["an Area Coordinator", { roles: [], areaCoordinator: true }, true],
    ["a registrar only", { roles: ["REGISTRAR"] }, false],
    ["a reporter only", { roles: ["REPORTER"] }, false],
    ["a registrar and reporter of another club", { roles: ["REGISTRAR", "REPORTER"] }, false],
    ["a plain attendee", { roles: [] }, false],
    ["a director whose second step is pending", { roles: ["DIRECTOR"], secondStep: "VERIFY" as const }, false],
    ["a director while the switch is off", { roles: ["DIRECTOR"], enabled: false }, false],
    ["an Area Coordinator while the switch is off", { roles: [], areaCoordinator: true, enabled: false }, false],
    ["staff acting as a director", { who: "staffActAs" as const, roles: ["DIRECTOR"] }, false],
    ["staff acting as an Area Coordinator", { who: "staffActAs" as const, areaCoordinator: true }, false],
    ["someone signed out", { who: "anonymous" as const }, false],
  ])("%s: %s", async (_label, options, allowed) => {
    setup(options);
    const viewer = await currentLeaderDirectoryViewer();
    expect(Boolean(viewer)).toBe(allowed);
    if (allowed) expect(viewer).toEqual({ accountId: "acct-1" });
  });

  it("does not let a visiting club's director or deputy in, but an Area Coordinator still can", async () => {
    setup({ roles: ["DIRECTOR", "DEPUTY"], guest: true });
    await expect(currentLeaderDirectoryViewer()).resolves.toBeNull();
    setup({ roles: ["DIRECTOR"], guest: true, areaCoordinator: true });
    await expect(currentLeaderDirectoryViewer()).resolves.toEqual({ accountId: "acct-1" });
  });

  it("reads no grants at all while the switch is off", async () => {
    setup({ enabled: false, roles: ["DIRECTOR"] });
    await currentLeaderDirectoryViewer();
    expect(mocks.grantFindMany).not.toHaveBeenCalled();
  });

  it("keeps the navigation decision in one pure function", () => {
    expect(canViewLeaderDirectory({ enabled: true, directedRoles: ["DEPUTY"], areaCoordinator: false })).toBe(true);
    expect(canViewLeaderDirectory({ enabled: true, directedRoles: ["REGISTRAR"], areaCoordinator: false })).toBe(false);
    expect(canViewLeaderDirectory({ enabled: false, directedRoles: ["DIRECTOR"], areaCoordinator: true })).toBe(false);
  });
});

const row = (over: Partial<LeaderGrantRow> & { name?: string; email?: string; phone?: string | null; pref?: LeaderGrantRow["attendeeAccount"]["leaderDirectoryPreference"]; club?: string }): LeaderGrantRow => ({
  role: over.role ?? "DIRECTOR",
  organization: { id: over.club ?? "club-a", name: over.club === "club-b" ? "Beta Pathfinders" : "Alpha Adventurers" },
  attendeeAccount: {
    displayName: over.name ?? "Casey Rivera",
    email: over.email ?? "casey@example.org",
    phone: over.phone === undefined ? "(515) 555-0100" : over.phone,
    leaderDirectoryPreference: over.pref ?? null,
  },
});

describe("what the directory lists (#1707)", () => {
  it("lists a leader with no saved choice, sharing email but not phone", () => {
    const [entry] = buildLeaderEntries([row({})]);
    expect(entry).toMatchObject({ name: "Casey Rivera", clubName: "Alpha Adventurers", roleLabel: "Director", email: "casey@example.org", phone: null });
  });

  it("drops a leader who opted out", () => {
    expect(buildLeaderEntries([row({ pref: { listed: false, shareEmail: true, sharePhone: true } })])).toEqual([]);
  });

  it("respects shareEmail and sharePhone, and never shows a blank phone", () => {
    const [shared] = buildLeaderEntries([row({ pref: { listed: true, shareEmail: false, sharePhone: true } })]);
    expect(shared).toMatchObject({ email: null, phone: "(515) 555-0100" });
    const [blank] = buildLeaderEntries([row({ phone: "  ", pref: { listed: true, shareEmail: true, sharePhone: true } })]);
    expect(blank!.phone).toBeNull();
    const [none] = buildLeaderEntries([row({ pref: { listed: true, shareEmail: false, sharePhone: false } })]);
    expect(none).toMatchObject({ email: null, phone: null });
  });

  it("makes one entry per leader per club, and two for a leader in two clubs", () => {
    const entries = buildLeaderEntries([row({ role: "DIRECTOR" }), row({ role: "REGISTRAR" }), row({ club: "club-b", role: "DEPUTY" })]);
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.clubId === "club-a")!.roleLabel).toBe("Director, Registrar");
    expect(entries.find((e) => e.clubId === "club-b")!.roleLabel).toBe("Deputy director");
  });

  it("searches name or club case-insensitively and filters by role", () => {
    const entries = buildLeaderEntries([row({}), row({ club: "club-b", name: "Dana Okafor", email: "dana@example.org", role: "DEPUTY" })]);
    expect(filterLeaderEntries(entries, parseLeaderFilters({ q: "CASEY" })).map((e) => e.name)).toEqual(["Casey Rivera"]);
    expect(filterLeaderEntries(entries, parseLeaderFilters({ q: "beta" })).map((e) => e.name)).toEqual(["Dana Okafor"]);
    expect(filterLeaderEntries(entries, parseLeaderFilters({ role: "DEPUTY" })).map((e) => e.name)).toEqual(["Dana Okafor"]);
    expect(filterLeaderEntries(entries, parseLeaderFilters({ role: "NOPE" }))).toHaveLength(2);
    expect(filterLeaderEntries(entries, parseLeaderFilters({}))).toHaveLength(2);
  });
});

describe("the directory read (#1707)", () => {
  it("selects only the role, club name and id, display name, email, phone and the leader's own choices", async () => {
    mocks.grantFindMany.mockResolvedValue([]);
    await readLeaderDirectory({ q: "", role: "" });
    const args = mocks.grantFindMany.mock.calls[0]![0];
    expect(args.select).toBe(leaderDirectorySelect);
    expect(Object.keys(args.select).sort()).toEqual(["attendeeAccount", "organization", "role"]);
    expect(Object.keys(args.select.attendeeAccount.select).sort()).toEqual(["displayName", "email", "leaderDirectoryPreference", "phone"]);
    expect(Object.keys(args.select.attendeeAccount.select.leaderDirectoryPreference.select).sort()).toEqual(["listed", "sharePhone", "shareEmail"].sort());
    expect(Object.keys(args.select.organization.select).sort()).toEqual(["id", "name"]);
  });

  it("asks only for active, unrevoked, in-date grants on active clubs, and leaves out opted-out leaders", async () => {
    mocks.grantFindMany.mockResolvedValue([]);
    const now = new Date("2026-11-12T12:00:00Z");
    await readLeaderDirectory({ q: "", role: "" }, now);
    const { where } = mocks.grantFindMany.mock.calls[0]![0];
    expect(where.revokedAt).toBeNull();
    expect(where.effectiveFrom).toEqual({ lte: now });
    expect(where.OR).toEqual([{ effectiveTo: null }, { effectiveTo: { gt: now } }]);
    expect(where.organization).toEqual({ type: "CLUB", isActive: true, guestEventId: null });
    expect(where.attendeeAccount.OR).toContainEqual({ leaderDirectoryPreference: { is: { listed: true } } });
  });

  it("drops an opted-out leader even if the database let the row through", async () => {
    mocks.grantFindMany.mockResolvedValue([row({ pref: { listed: false, shareEmail: true, sharePhone: true } }), row({ name: "Dana Okafor", email: "dana@example.org" })]);
    const result = await readLeaderDirectory({ q: "", role: "" });
    expect(result.entries.map((e) => e.name)).toEqual(["Dana Okafor"]);
    expect(result.total).toBe(1);
  });

  it("audits a view with counts and filter keys only", async () => {
    await recordLeaderDirectoryView({ filters: { q: "casey", role: "DEPUTY" }, shown: 3, matching: 3, total: 9, page: 1 }, { accountId: "acct-1" });
    const entry = mocks.writeAuditLog.mock.calls[0]![0];
    expect(entry.action).toBe("LEADER_DIRECTORY_VIEWED");
    expect(entry.metadata).toEqual({ actorAttendeeAccountId: "acct-1", rowsShown: 3, rowsMatching: 3, totalListed: 9, page: 1, filters: ["q", "role"] });
    expect(JSON.stringify(entry)).not.toContain("casey");
  });
});

const patch = (path: string, body: unknown) => new Request(`${ORIGIN}${path}`, {
  method: "PATCH",
  headers: { origin: ORIGIN, "content-type": "application/json" },
  body: JSON.stringify(body),
});
const choicesBody = { listed: false, shareEmail: false, sharePhone: true };

describe("PATCH /api/attendee/leader-directory (#1707)", () => {
  beforeEach(() => {
    mocks.getCurrentAttendee.mockResolvedValue(attendee);
    mocks.prefUpsert.mockResolvedValue({});
    mocks.grantFindMany.mockResolvedValue(viewerGrants(["REGISTRAR"]));
  });

  it("refuses an account with no active club leader grant", async () => {
    mocks.grantFindMany.mockResolvedValue([]);
    const response = await (CHOICES as (r: Request) => Promise<Response>)(patch("/api/attendee/leader-directory", choicesBody));
    expect(response.status).toBe(403);
    expect(mocks.prefUpsert).not.toHaveBeenCalled();
  });

  it("writes only the caller's own row and audits the three values", async () => {
    const response = await (CHOICES as (r: Request) => Promise<Response>)(patch("/api/attendee/leader-directory", choicesBody));
    expect(response.status).toBe(200);
    expect(mocks.prefUpsert).toHaveBeenCalledTimes(1);
    expect(mocks.prefUpsert).toHaveBeenCalledWith({ where: { attendeeAccountId: "acct-1" }, create: { attendeeAccountId: "acct-1", ...choicesBody }, update: choicesBody });
    const audit = mocks.writeAuditLog.mock.calls[0]![0];
    expect(audit.action).toBe("LEADER_DIRECTORY_CHOICES_CHANGED");
    expect(audit.metadata).toEqual({ actorAttendeeAccountId: "acct-1", ...choicesBody });
  });

  it("ignores an account id in the body by refusing the unknown key", async () => {
    const response = await (CHOICES as (r: Request) => Promise<Response>)(patch("/api/attendee/leader-directory", { ...choicesBody, attendeeAccountId: "acct-2" }));
    expect(response.status).toBe(400);
    expect(mocks.prefUpsert).not.toHaveBeenCalled();
  });

  it.each([
    ["unknown key", { ...choicesBody, extra: true }],
    ["missing key", { listed: true, shareEmail: true }],
    ["a string instead of a boolean", { ...choicesBody, listed: "false" }],
  ])("rejects %s", async (_label, body) => {
    const response = await (CHOICES as (r: Request) => Promise<Response>)(patch("/api/attendee/leader-directory", body));
    expect(response.status).toBe(400);
    expect(mocks.prefUpsert).not.toHaveBeenCalled();
  });

  it("answers 401 to someone signed out or acting as staff", async () => {
    mocks.getCurrentAttendee.mockResolvedValue(signedOut);
    const response = await (CHOICES as (r: Request) => Promise<Response>)(patch("/api/attendee/leader-directory", choicesBody));
    expect(response.status).toBe(401);
    expect(mocks.prefUpsert).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin request and a pending second step", async () => {
    mocks.crossOrigin = new Response("no", { status: 403 });
    expect((await (CHOICES as (r: Request) => Promise<Response>)(patch("/api/attendee/leader-directory", choicesBody))).status).toBe(403);
    mocks.crossOrigin = null;
    mocks.attendeeSignInStepPending.mockResolvedValue(true);
    expect((await (CHOICES as (r: Request) => Promise<Response>)(patch("/api/attendee/leader-directory", choicesBody))).status).toBe(403);
    expect(mocks.prefUpsert).not.toHaveBeenCalled();
  });

  it("saveLeaderChoices keeps the write and the audit row in one transaction", async () => {
    const order: string[] = [];
    mocks.prefUpsert.mockImplementation(async () => { order.push("upsert"); });
    mocks.writeAuditLog.mockImplementation(async (_entry: unknown, tx: unknown) => { order.push(tx === client ? "audit-in-tx" : "audit-outside"); });
    await saveLeaderChoices("acct-1", { listed: true, shareEmail: true, sharePhone: false });
    expect(order).toEqual(["upsert", "audit-in-tx"]);
  });
});

describe("the admin switch (#1707)", () => {
  it("turns the directory on, stamps who and when, and audits old and new in the same transaction", async () => {
    mocks.settingsFindUnique.mockResolvedValue({ leaderDirectoryEnabled: false });
    mocks.writeAuditLog.mockImplementation(async (_entry: unknown, tx: unknown) => { expect(tx).toBe(client); });
    const now = new Date("2026-11-12T15:00:00Z");
    await setLeaderDirectoryEnabled(true, "admin-1", now);
    expect(mocks.settingsUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { leaderDirectoryEnabled: true, leaderDirectorySetAt: now, leaderDirectorySetByUserId: "admin-1" },
    }));
    const audit = mocks.writeAuditLog.mock.calls[0]![0];
    expect(audit).toMatchObject({ action: "LEADER_DIRECTORY_SWITCHED", actorUserId: "admin-1", metadata: { before: false, after: true } });
  });

  it("is a system administrator only route, with a strict body", async () => {
    mocks.settingsFindUnique.mockResolvedValue({ leaderDirectoryEnabled: false });
    const call = (body: unknown) => (ADMIN_SWITCH as (r: Request) => Promise<Response>)(patch("/api/admin/platform-settings/leader-directory", body));
    expect((await call({ enabled: true })).status).toBe(200);
    expect((await call({ enabled: true, other: 1 })).status).toBe(400);
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "ca-1", globalRole: null } });
    expect((await call({ enabled: true })).status).toBe(403);
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    expect((await call({ enabled: true })).status).toBe(403);
  });
});
