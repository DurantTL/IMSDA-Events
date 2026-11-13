import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Area Coordinator item-by-item review of Monthly Records (#1701), against an in-memory database: the coordinator's one
 * narrow write through the real route and access check (only the sign-in lookups are mocked), the conference switch, the
 * superseding of decisions on a new submission, and the one past-due exception. Synthetic data only.
 */

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({
  settings: [] as Row[],
  reports: [] as Row[],
  reviews: [] as Row[],
  orgs: [] as Row[],
  grants: [] as Row[],
  audit: [] as Row[],
  nextId: 1,
  uniqueViolation: false,
  locks: 0,
}));
const mocks = vi.hoisted(() => ({
  getCurrentAttendee: vi.fn(),
  accountNeedsSecondStep: vi.fn(),
  currentStaffActingContext: vi.fn(),
  rateLimit: vi.fn(),
  listDirectedClubs: vi.fn(),
}));

const matches = (row: Row, where: Row) => Object.entries(where).every(([key, value]) => (value === null ? row[key] == null : row[key] === value));
const orgMatches = (org: Row, where: { clubKind?: { in: string[] }; isActive?: boolean; guestEventId?: null; type?: string }) => (
  (!where.type || org.type === where.type)
  && (where.isActive === undefined || org.isActive === where.isActive)
  && (where.guestEventId === undefined || (org.guestEventId ?? null) === null)
  && (!where.clubKind || where.clubKind.in.includes(org.clubKind as string))
);

const client = {
  $transaction: async (work: (tx: unknown) => unknown) => work(client),
  $queryRaw: async () => { db.locks += 1; return []; },
  monthlyRecordAreaReviewSetting: {
    findUnique: async ({ where }: { where: { clubYear: string } }) => db.settings.find((row) => row.clubYear === where.clubYear) ?? null,
    upsert: async ({ where, update, create }: { where: { clubYear: string }; update: Row; create: Row }) => {
      const found = db.settings.find((row) => row.clubYear === where.clubYear);
      if (found) Object.assign(found, update); else db.settings.push({ ...create });
    },
  },
  clubMonthlyReport: {
    findUnique: async ({ where }: { where: { id?: string; organizationId_reportMonth?: { organizationId: string; reportMonth: string } } }) =>
      db.reports.find((row) => (where.id ? row.id === where.id : row.organizationId === where.organizationId_reportMonth!.organizationId && row.reportMonth === where.organizationId_reportMonth!.reportMonth)) ?? null,
    findFirst: async ({ where }: { where: { organizationId: string; reportMonth: string; organization: Parameters<typeof orgMatches>[1] } }) => {
      const report = db.reports.find((row) => row.organizationId === where.organizationId && row.reportMonth === where.reportMonth);
      const org = report && db.orgs.find((candidate) => candidate.id === report.organizationId);
      return report && org && orgMatches(org, where.organization) ? report : null;
    },
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      const report = db.reports.find((row) => row.id === where.id)!;
      Object.assign(report, data);
      return report;
    },
    create: async ({ data }: { data: Row }) => {
      const report = { id: `report-${db.nextId++}`, ...data };
      db.reports.push(report);
      return report;
    },
  },
  clubMonthlyReportItemReview: {
    findFirst: async ({ where }: { where: Row }) => db.reviews.find((row) => matches(row, where)) ?? null,
    findMany: async ({ where }: { where: Row & { report?: { organizationId: string; clubYear: string } } }) => {
      const { report, ...flat } = where;
      return db.reviews.filter((row) => matches(row, flat)).filter((row) => {
        const parent = db.reports.find((candidate) => candidate.id === row.reportId)!;
        return !report || (parent.organizationId === report.organizationId && parent.clubYear === report.clubYear);
      }).map((row) => ({ ...row, report: { reportMonth: db.reports.find((candidate) => candidate.id === row.reportId)!.reportMonth } }));
    },
    count: async ({ where }: { where: Row }) => db.reviews.filter((row) => matches(row, where)).length,
    update: async ({ where, data }: { where: { id: string }; data: Row }) => { Object.assign(db.reviews.find((row) => row.id === where.id)!, data); },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const hit = db.reviews.filter((row) => matches(row, where));
      hit.forEach((row) => Object.assign(row, data));
      return { count: hit.length };
    },
    create: async ({ data }: { data: Row }) => {
      if (db.uniqueViolation) throw Object.assign(new Error("unique"), { code: "P2002" });
      const row = { id: `review-${db.nextId++}`, supersededAt: null, ...data };
      db.reviews.push(row);
      return row;
    },
  },
  organization: {
    findUnique: async ({ where }: { where: { id: string } }) => db.orgs.find((row) => row.id === where.id) ?? null,
  },
  areaCoordinatorGrant: {
    findUnique: async ({ where }: { where: { attendeeAccountId: string } }) => db.grants.find((row) => row.attendeeAccountId === where.attendeeAccountId) ?? null,
  },
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => client }));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: async (entry: Row) => { db.audit.push(entry); } }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: (request: Request) => (request.headers.get("origin") === "https://events.imsda.test" ? null : Response.json({ error: "CROSS_ORIGIN" }, { status: 403 })) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), notFound: vi.fn() }));
vi.mock("@/modules/organizations/staff-act-as", () => ({ currentStaffActingContext: mocks.currentStaffActingContext }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee }));
vi.mock("@/modules/organizations/director-access", () => ({ listDirectedClubs: mocks.listDirectedClubs }));
vi.mock("@/modules/attendee-accounts/sign-in-gate", () => ({ accountNeedsSecondStep: mocks.accountNeedsSecondStep }));
vi.mock("@/modules/attendee-accounts/passkeys", () => ({ passkeysConfigured: vi.fn(async () => false) }));
vi.mock("@/modules/attendee-accounts/return-redirect", () => ({ twoStepRedirectPath: vi.fn(async () => "/account/two-step") }));
vi.mock("@/modules/rate-limit/service", () => ({ checkMasterGuideWriteRateLimit: mocks.rateLimit }));

import { POST as reviewRoute } from "@/app/api/attendee/area-clubs/monthly-records/item-review/route";
import { getItemDecisionsForRecord, returnedReportMonths, reviewReportItem, setMonthlyRecordAreaReviewEnabled, getAreaReviewSwitch } from "@/modules/club-reports/area-review";
import { reopenClubReport, saveClubReport } from "@/modules/club-reports/repository";
import { clubReportInputSchema } from "@/modules/club-reports/schemas";
import { ClubReportError } from "@/modules/club-reports/repository";

const origin = "https://events.imsda.test";
const now = new Date("2026-11-12T15:00:00.000Z"); // after the 10th: October's record is past due
const beforeDue = new Date("2026-11-05T15:00:00.000Z");
const coordinator = { accountId: "acct-ac" };

const call = (body: unknown, headers: Record<string, string> = { origin }) => reviewRoute(new Request(`${origin}/api/attendee/area-clubs/monthly-records/item-review`, {
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
}));
const VERSION = "2026-11-05T15:00:00.000Z";
const body = (overrides: Row = {}) => ({ organizationId: "club-1", month: "2026-10", itemKey: "ratio", outcome: "RETURNED", note: "Please recount the ratio.", version: VERSION, ...overrides });

function signInAs(kind: "coordinator" | "coordinatorNoSecondStep" | "director" | "staffActingAsCoordinator" | "staff" | "signedOut") {
  mocks.currentStaffActingContext.mockResolvedValue(kind === "staffActingAsCoordinator" ? { role: "AREA_COORDINATOR", actAsId: "act-1" } : null);
  if (kind === "signedOut" || kind === "staff" || kind === "staffActingAsCoordinator") {
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: kind === "signedOut" ? null : "staff", sessionId: null });
  } else {
    // A director or deputy of the club is an ordinary attendee account with no coordinator grant.
    mocks.getCurrentAttendee.mockResolvedValue({ account: { id: kind === "director" ? "acct-director" : "acct-ac" }, via: "attendee", sessionId: "session-1" });
  }
  mocks.accountNeedsSecondStep.mockResolvedValue(kind === "coordinatorNoSecondStep" ? "NEEDED" : "OK");
}

function seed() {
  Object.assign(db, { settings: [], reports: [], reviews: [], orgs: [], grants: [], audit: [], nextId: 1, uniqueViolation: false, locks: 0 });
  db.orgs.push(
    { id: "club-1", type: "CLUB", name: "Aspen Pathfinders", clubKind: "PATHFINDER", isActive: true, guestEventId: null },
    { id: "club-adv", type: "CLUB", name: "Birch Adventurers", clubKind: "ADVENTURER", isActive: true, guestEventId: null },
    { id: "club-visiting", type: "CLUB", name: "Visiting Pathfinders", clubKind: "PATHFINDER", isActive: true, guestEventId: "event-1" },
    { id: "club-closed", type: "CLUB", name: "Closed Pathfinders", clubKind: "PATHFINDER", isActive: false, guestEventId: null },
  );
  for (const id of ["club-1", "club-adv", "club-visiting", "club-closed"]) {
    db.reports.push({ id: `report-${id}`, organizationId: id, clubYear: "2026-27", reportMonth: "2026-10", status: "SUBMITTED", firstSubmittedAt: new Date("2026-11-05T15:00:00Z"), submittedAt: new Date("2026-11-05T15:00:00Z"), totalPoints: 100, onTimePoints: 25, reviewedAt: null, updatedAt: new Date("2026-11-05T15:00:00Z"), honors: [], points: {}, classLevels: [] });
  }
  db.settings.push({ clubYear: "2026-27", enabled: true });
  db.grants.push({ attendeeAccountId: "acct-ac", revokedAt: null, expiresAt: null, ministries: ["PATHFINDER"] });
}

const reviewsFor = (reportId: string) => db.reviews.filter((row) => row.reportId === reportId);
const current = (reportId: string) => reviewsFor(reportId).filter((row) => row.supersededAt === null);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  seed();
  mocks.rateLimit.mockResolvedValue({ allowed: true, decisions: [] });
  signInAs("coordinator");
});

describe("the Area Coordinator's item review route", () => {
  it("lets a coordinator of the club's ministry return an item with a note, audited with ids and outcomes only", async () => {
    const response = await call(body());
    expect(response.status).toBe(200);
    expect(current("report-club-1")).toHaveLength(1);
    expect(current("report-club-1")[0]).toMatchObject({ itemKey: "ratio", outcome: "RETURNED", note: "Please recount the ratio.", reviewedByAccountId: "acct-ac" });
    expect(db.audit).toHaveLength(1);
    expect(db.audit[0]).toMatchObject({
      action: "CLUB_REPORT_ITEM_AREA_REVIEWED",
      entityType: "ClubMonthlyReport",
      entityId: "report-club-1",
      metadata: { organizationId: "club-1", reportMonth: "2026-10", itemKey: "ratio", outcome: "RETURNED", previousOutcome: null, actorAttendeeAccountId: "acct-ac" },
    });
    expect(JSON.stringify(db.audit[0])).not.toContain("recount");
    expect(JSON.stringify(db.audit[0])).not.toContain("Aspen");
  });

  it("marks an item OK without a note", async () => {
    expect((await call(body({ outcome: "OK", note: undefined }))).status).toBe(200);
    expect(current("report-club-1")[0]).toMatchObject({ outcome: "OK", note: "" });
  });

  it("changes a decision by superseding the old one, and audits the previous outcome", async () => {
    await call(body());
    expect((await call(body({ outcome: "OK", note: undefined }))).status).toBe(200);
    expect(reviewsFor("report-club-1")).toHaveLength(2);
    expect(current("report-club-1")).toHaveLength(1);
    expect(current("report-club-1")[0]).toMatchObject({ outcome: "OK" });
    expect(db.audit[1]!.metadata).toMatchObject({ outcome: "OK", previousOutcome: "RETURNED" });
  });

  it("writes and audits nothing for an unchanged decision", async () => {
    await call(body());
    const response = await call(body({ note: "  Please recount the ratio.  " }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ changed: false });
    expect(reviewsFor("report-club-1")).toHaveLength(1);
    expect(db.audit).toHaveLength(1);
  });

  it("refuses a return without a note, a note over 500 characters, an unknown item and extra fields", async () => {
    expect((await call(body({ note: "   " }))).status).toBe(400);
    expect((await call(body({ note: undefined }))).status).toBe(400);
    expect((await call(body({ note: "x".repeat(501) }))).status).toBe(400);
    expect((await call(body({ itemKey: "onTime" }))).status).toBe(400);
    expect((await call({ ...body(), reviewedByAccountId: "acct-other" })).status).toBe(400);
    expect(db.reviews).toHaveLength(0);
    expect(db.audit).toHaveLength(0);
  });

  it.each(["club-adv", "club-visiting", "club-closed", "club-missing"])("answers not found for %s, with nothing written", async (organizationId) => {
    const response = await call(body({ organizationId }));
    expect(response.status).toBe(404);
    expect(JSON.stringify(await response.json())).not.toMatch(/Adventurer|Visiting|Closed|ministry/);
    expect(db.reviews).toHaveLength(0);
    expect(db.audit).toHaveLength(0);
  });

  it("reads the coordinator's ministries fresh: a revoked or expired grant is not found", async () => {
    db.grants[0]!.revokedAt = new Date("2026-11-01T00:00:00Z");
    expect((await call(body())).status).toBe(404);
    db.grants[0]!.revokedAt = null;
    db.grants[0]!.expiresAt = new Date("2026-11-01T00:00:00Z");
    expect((await call(body())).status).toBe(404);
    expect(db.reviews).toHaveLength(0);
  });

  it("lets an Adventurer coordinator review an Adventurer club and not a Pathfinder one", async () => {
    db.grants[0]!.ministries = ["ADVENTURER"];
    expect((await call(body({ organizationId: "club-adv" }))).status).toBe(200);
    expect((await call(body({ organizationId: "club-1" }))).status).toBe(404);
  });

  it("refuses with the switch off for the record's club year, and when it was never turned on", async () => {
    db.settings[0]!.enabled = false;
    expect((await call(body())).status).toBe(404);
    db.settings.length = 0;
    expect((await call(body())).status).toBe(404);
    expect(db.reviews).toHaveLength(0);
  });

  it("refuses a draft record", async () => {
    db.reports[0]!.status = "DRAFT";
    const response = await call(body());
    expect(response.status).toBe(409);
    expect(db.reviews).toHaveLength(0);
  });

  it.each(["director", "coordinatorNoSecondStep", "staffActingAsCoordinator", "staff", "signedOut"] as const)("refuses %s with nothing written", async (kind) => {
    signInAs(kind);
    // A club director or deputy, another club's director, a coordinator without the second step, staff acting as a coordinator and staff: none is a coordinator on their own account.
    expect((await call(body())).status).toBe(404);
    expect(db.reviews).toHaveLength(0);
    expect(db.audit).toHaveLength(0);
    expect(mocks.rateLimit).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin request and a rate-limited one", async () => {
    expect((await call(body(), { origin: "https://evil.example" })).status).toBe(403);
    mocks.rateLimit.mockResolvedValue({ allowed: false, decisions: [] });
    expect((await call(body())).status).toBe(429);
    expect(db.reviews).toHaveLength(0);
  });

  it("refuses a decision on a record that changed since the coordinator loaded it, and writes nothing", async () => {
    const stale = await call(body({ version: "2026-11-04T10:00:00.000Z" }));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: "CONFLICT", message: "This record changed. Reload to see the latest." });
    expect(db.reviews).toHaveLength(0);
    expect(db.audit).toHaveLength(0);
    // The director resubmitted after the page loaded: the record's version moved on.
    db.reports[0]!.updatedAt = new Date("2026-11-12T14:00:00.000Z");
    expect((await call(body())).status).toBe(409);
    expect((await call(body({ version: "2026-11-12T14:00:00.000Z" }))).status).toBe(200);
  });

  it("locks the record's row before it reads it, and needs a version in the body", async () => {
    await call(body());
    expect(db.locks).toBe(1);
    expect((await call(body({ version: undefined }))).status).toBe(400);
  });

  it("answers a conflict when two decisions race on the same item", async () => {
    db.uniqueViolation = true;
    expect((await call(body())).status).toBe(409);
  });
});

describe("the conference switch", () => {
  it("is off with no row, and a Clubs Administrator turns it on and off with an audit entry each time", async () => {
    db.settings.length = 0;
    expect(await getAreaReviewSwitch(now)).toEqual({ clubYear: "2026-27", enabled: false });
    expect(await setMonthlyRecordAreaReviewEnabled(true, "user-1", now)).toEqual({ clubYear: "2026-27", enabled: true, changed: true });
    expect(await setMonthlyRecordAreaReviewEnabled(false, "user-2", now)).toMatchObject({ changed: true });
    expect(db.audit.map((row) => [row.action, row.actorUserId])).toEqual([
      ["MONTHLY_RECORD_AREA_REVIEW_TURNED_ON", "user-1"],
      ["MONTHLY_RECORD_AREA_REVIEW_TURNED_OFF", "user-2"],
    ]);
    expect(db.audit[0]).toMatchObject({ entityType: "MonthlyRecordAreaReviewSetting", entityId: "2026-27", metadata: { clubYear: "2026-27", enabled: true } });
  });

  it("writes nothing when it is already in the wanted state, including turning off a switch never turned on", async () => {
    db.settings.length = 0;
    expect(await setMonthlyRecordAreaReviewEnabled(false, "user-1", now)).toMatchObject({ changed: false, enabled: false });
    expect(db.settings).toHaveLength(0);
    await setMonthlyRecordAreaReviewEnabled(true, "user-1", now);
    db.audit.length = 0;
    expect(await setMonthlyRecordAreaReviewEnabled(true, "user-1", now)).toMatchObject({ changed: false });
    expect(db.audit).toHaveLength(0);
  });

  it("shows no decisions anywhere while off, even ones made earlier", async () => {
    await call(body());
    expect((await getItemDecisionsForRecord("club-1", "2026-10")).decisions).toHaveLength(1);
    db.settings[0]!.enabled = false;
    expect(await getItemDecisionsForRecord("club-1", "2026-10")).toEqual({ switchOn: false, decisions: [] });
  });

  it("lists the months with a current returned item for the director's month list, only while on", async () => {
    stage("report-club-1", "RETURNED");
    stage("report-club-adv", "RETURNED");
    expect([...await returnedReportMonths("club-1", "2026-27")]).toEqual(["2026-10"]);
    expect((await returnedReportMonths("club-1", "2025-26")).size).toBe(0);
    db.settings[0]!.enabled = false;
    expect((await returnedReportMonths("club-1", "2026-27")).size).toBe(0);
  });

  it("leaves the coordinator's name out unless staff ask for it", async () => {
    await call(body());
    const plain = await getItemDecisionsForRecord("club-1", "2026-10");
    expect(plain.decisions[0]).not.toHaveProperty("reviewedByName");
  });
});

const input = (overrides: Row = {}) => clubReportInputSchema.parse({
  points: { staffMeeting: 25, ratio: 25 },
  honors: [],
  classLevels: [],
  signatureName: "Pat Example",
  signedOn: "2026-11-12",
  status: "SUBMITTED",
  ...overrides,
});
const club = { accountId: "acct-director" };
const stage = (reportId: string, outcome: "OK" | "RETURNED", itemKey = "ratio") => db.reviews.push({ id: `review-${db.nextId++}`, reportId, itemKey, outcome, note: outcome === "RETURNED" ? "Recount." : "", reviewedByAccountId: "acct-ac", reviewedAt: now, supersededAt: null });

describe("superseding decisions when the record is submitted again", () => {
  it("supersedes the current decisions on any save as SUBMITTED, before the due date", async () => {
    stage("report-club-1", "RETURNED");
    stage("report-club-1", "OK", "devotions");
    await saveClubReport("club-1", "2026-10", input(), club, beforeDue);
    expect(current("report-club-1")).toHaveLength(0);
    expect(reviewsFor("report-club-1").every((row) => row.supersededAt instanceof Date)).toBe(true);
    expect(db.audit.at(-1)!.metadata).toMatchObject({ areaDecisionsSuperseded: 2 });
  });

  it("keeps them on a draft save and on a reopen, so the director still sees the notes", async () => {
    db.reports[0]!.status = "DRAFT";
    stage("report-club-1", "RETURNED");
    await saveClubReport("club-1", "2026-10", input({ status: "DRAFT" }), club, beforeDue);
    expect(current("report-club-1")).toHaveLength(1);
    expect(db.audit.at(-1)!.metadata).not.toHaveProperty("areaDecisionsSuperseded");
    db.reports[0]!.status = "SUBMITTED";
    await reopenClubReport("club-1", "2026-10", club, beforeDue);
    expect(current("report-club-1")).toHaveLength(1);
  });

  it("supersedes for a staff edit of a submitted record too, and leaves other records' decisions alone", async () => {
    stage("report-club-1", "RETURNED");
    stage("report-club-adv", "RETURNED");
    await saveClubReport("club-1", "2026-10", input(), { userId: "staff-1" }, now);
    expect(current("report-club-1")).toHaveLength(0);
    expect(current("report-club-adv")).toHaveLength(1);
  });
});

describe("the past-due exception for a returned record", () => {
  const lockedMessage = async (work: Promise<unknown>) => {
    const error = await work.then(() => null, (caught: unknown) => caught);
    expect(error).toBeInstanceOf(ClubReportError);
    expect((error as ClubReportError).code).toBe("CLUB_REPORT_LOCKED");
  };

  it("keeps the lock after the due date with no returned item (nothing reviewed, only OK, or the switch off)", async () => {
    await lockedMessage(reopenClubReport("club-1", "2026-10", club, now));
    await lockedMessage(saveClubReport("club-1", "2026-10", input(), club, now));
    stage("report-club-1", "OK");
    await lockedMessage(reopenClubReport("club-1", "2026-10", club, now));
    stage("report-club-1", "RETURNED", "devotions");
    db.settings[0]!.enabled = false;
    await lockedMessage(reopenClubReport("club-1", "2026-10", club, now));
    await lockedMessage(saveClubReport("club-1", "2026-10", input(), club, now));
    expect(db.reports[0]!.status).toBe("SUBMITTED");
  });

  it("keeps the lock after the exception for a superseded decision", async () => {
    stage("report-club-1", "RETURNED");
    db.reviews[0]!.supersededAt = new Date("2026-11-11T00:00:00Z");
    await lockedMessage(reopenClubReport("club-1", "2026-10", club, now));
  });

  it("lets the club reopen and resubmit with a returned item and the switch on, then locks again", async () => {
    stage("report-club-1", "RETURNED");
    await reopenClubReport("club-1", "2026-10", club, now);
    expect(db.reports[0]!.status).toBe("DRAFT");
    expect(db.audit.at(-1)).toMatchObject({ action: "CLUB_REPORT_REOPENED", metadata: { afterAreaReturn: true } });
    // The returned note is still there while the director edits, and a draft can be saved past the due date.
    await saveClubReport("club-1", "2026-10", input({ status: "DRAFT" }), club, now);
    expect(current("report-club-1")).toHaveLength(1);
    const first = db.reports[0]!.firstSubmittedAt;
    await saveClubReport("club-1", "2026-10", input(), club, now);
    expect(db.audit.at(-1)).toMatchObject({ action: "CLUB_REPORT_UPDATED", metadata: { afterAreaReturn: true, status: "SUBMITTED" } });
    expect(db.reports[0]!.firstSubmittedAt).toBe(first);
    expect(db.reports[0]!.onTimePoints).toBe(25);
    expect(current("report-club-1")).toHaveLength(0);
    await lockedMessage(reopenClubReport("club-1", "2026-10", club, now));
    await lockedMessage(saveClubReport("club-1", "2026-10", input(), club, now));
  });

  it("applies to a staff member acting as the director with the club's rules, and not to another record", async () => {
    stage("report-club-1", "RETURNED");
    await reopenClubReport("club-1", "2026-10", { userId: "staff-1", actAsId: "act-1" }, now);
    expect(db.reports[0]!.status).toBe("DRAFT");
    await lockedMessage(reopenClubReport("club-adv", "2026-10", club, now));
  });

  it("does not move the on-time points of a late first submission", async () => {
    db.reports[0]!.firstSubmittedAt = new Date("2026-11-11T20:00:00Z");
    db.reports[0]!.onTimePoints = 0;
    stage("report-club-1", "RETURNED");
    await reopenClubReport("club-1", "2026-10", club, now);
    await saveClubReport("club-1", "2026-10", input(), club, now);
    expect(db.reports[0]!.onTimePoints).toBe(0);
  });
});

describe("reviewReportItem directly", () => {
  it("reads the ministries inside the same transaction as the write", async () => {
    await reviewReportItem({ organizationId: "club-1", month: "2026-10", itemKey: "ratio", outcome: "OK", version: VERSION }, coordinator, now);
    expect(current("report-club-1")).toHaveLength(1);
  });
});
