/* eslint-disable @typescript-eslint/no-explicit-any -- the recording database receives loosely typed Prisma arguments */
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Every query that means "the conference's clubs" leaves visiting clubs out (#835): the helper's shape, and the where
 * each listed site sends to a recording database. Synthetic data only; nothing is read back.
 */

const mocks = vi.hoisted(() => ({ calls: [] as Array<{ model: string; method: string; args: any }>, getPrisma: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn(), logInfo: vi.fn(), logWarn: vi.fn() }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ APP_BASE_URL: "https://example.test" }) }));
vi.mock("@/modules/communications/account-email", () => ({ getAccountEmailSender: () => ({ send: vi.fn() }), isAccountEmailConfigured: () => true }));

function recordingPrisma(): any {
  const model = (name: string) =>
    new Proxy({}, {
      get: (_t, method: string) => async (args: any) => {
        mocks.calls.push({ model: name, method, args });
        // The reminder switch is on, so the monthly step goes on to read its clubs.
        if (name === "monthlyRecordReminderSetting") return { enabled: true, clubYear: "2026-2027" };
        return method === "count" ? 0 : method.startsWith("findFirst") || method.startsWith("findUnique") ? null : [];
      },
    });
  const client: any = new Proxy({}, {
    get: (_t, key: string) => {
      if (key === "$transaction") return async (fn: any) => (typeof fn === "function" ? fn(client) : []);
      if (key === "$queryRaw" || key === "$executeRaw") return async () => [];
      return model(key);
    },
  });
  return client;
}

/** Every recorded query whose arguments name a club type, which must also say guestEventId: null. */
function clubQueries() {
  return mocks.calls.filter((call) => JSON.stringify(call.args ?? null).includes('"type":"CLUB"'));
}

async function run(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch {
    // Only the first reads matter here; a later step may fail on empty data.
  }
}

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.getPrisma.mockReturnValue(recordingPrisma());
});

describe("conferenceClubWhere", () => {
  it("is active clubs with no guest event, and areaClubWhere builds on it", async () => {
    const { conferenceClubWhere, areaClubWhere } = await import("@/modules/organizations/area-coordinator-ministries-domain");
    expect(conferenceClubWhere()).toEqual({ type: "CLUB", isActive: true, guestEventId: null });
    expect(areaClubWhere(["PATHFINDER"])).toEqual({ type: "CLUB", isActive: true, guestEventId: null, clubKind: { in: ["PATHFINDER"] } });
  });

  it("returns a fresh object each time, so a caller cannot change another's filter", async () => {
    const { conferenceClubWhere } = await import("@/modules/organizations/area-coordinator-ministries-domain");
    expect(conferenceClubWhere()).not.toBe(conferenceClubWhere());
  });
});

describe("each conference club list leaves visiting clubs out", () => {
  const now = new Date("2027-03-15T18:00:00Z");
  const cases: Array<[string, () => Promise<unknown>]> = [
    ["monthly record reminders", async () => (await import("@/modules/club-reports/monthly-reminders")).sendDueMonthlyRecordReminders({ now })],
    ["deadline reminders", async () => (await import("@/modules/calendar/deadline-reminders")).loadReminderRecipients(mocks.getPrisma(), now)],
    ["year-end list", async () => (await import("@/modules/club-reports/year-end-repository")).listYearEndReportsForYear("2026-2027", now)],
    ["required club forms", async () => (await import("@/modules/club-forms/required")).getRequiredFormsStatus("2026-2027")],
    ["open applications", async () => (await import("@/modules/club-forms/open-applications")).listOpenApplicationClubs()],
    ["youth directory", async () => (await import("@/modules/youth-directory/repository")).listYouthDirectoryRows(now)],
    ["master guide approvals", async () => (await import("@/modules/master-guide/repository")).listAreaApprovalQueue(["PATHFINDER"], now)],
    ["leader directory", async () => (await import("@/modules/leader-directory/repository")).readLeaderDirectory({} as any, now)],
  ];

  it.each(cases)("%s", async (_name, call) => {
    await run(call);
    const queries = clubQueries();
    expect(queries.length).toBeGreaterThan(0);
    for (const query of queries) expect(JSON.stringify(query.args)).toContain('"guestEventId":null');
  });
});
