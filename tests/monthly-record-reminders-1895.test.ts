import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1895: the automatic Monthly Record reminder against an in-memory stand-in for the database. Dates are pinned and the
 * clubs, people and addresses are synthetic.
 */
type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  clubs: [] as Row[],
  reports: [] as Row[],
  logs: [] as Row[],
  grants: [] as Row[],
  coordinators: [] as Row[],
  settings: [] as Row[],
  outbox: [] as Row[],
  audit: [] as Row[],
  delivered: [] as string[][],
  emailConfigured: true,
  failClubOutbox: null as string | null,
  nextId: 1,
}));

const activeAccount = (account: unknown) => { const row = account as { disabledAt?: Date | null; status?: string }; return !row.disabledAt && (row.status ?? "ACTIVE") === "ACTIVE"; };

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ APP_BASE_URL: "https://events.example.test" }) }));
vi.mock("@/lib/logger", () => ({ logError: () => undefined }));
vi.mock("@/lib/prisma", () => {
  const client = {
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => {
      const before = { logs: [...state.logs], outbox: [...state.outbox], audit: [...state.audit], settings: [...state.settings] };
      try {
        return await run(client);
      } catch (error) {
        Object.assign(state, before);
        throw error;
      }
    },
    organization: { findMany: async ({ where }: { where: { type?: string; isActive?: boolean; id?: { in: string[] } } }) => state.clubs.filter((club) => (where.isActive === undefined || club.isActive === where.isActive) && (!where.id || where.id.in.includes(club.id as string))) },
    clubMonthlyReport: {
      findMany: async ({ where }: { where: { reportMonth: string } }) => state.reports.filter((row) => row.reportMonth === where.reportMonth),
      findUnique: async ({ where }: { where: { organizationId_reportMonth: { organizationId: string; reportMonth: string } } }) =>
        state.reports.find((row) => row.organizationId === where.organizationId_reportMonth.organizationId && row.reportMonth === where.organizationId_reportMonth.reportMonth) ?? null,
    },
    monthlyRecordReminderLog: {
      findMany: async ({ where, orderBy, skip, take }: { where?: { reportMonth?: string }; orderBy?: Array<Record<string, unknown>>; skip?: number; take?: number }) => {
        const nameOf = (id: unknown) => String(state.clubs.find((club) => club.id === id)?.name ?? "");
        const value = (row: Row, spec: Record<string, unknown>): string | number => {
          const [field] = Object.entries(spec)[0]!;
          if (field === "organization") return nameOf(row.organizationId);
          const raw = row[field];
          return raw instanceof Date ? raw.getTime() : (raw as string | number);
        };
        const rows = state.logs.filter((row) => !where?.reportMonth || row.reportMonth === where.reportMonth);
        if (orderBy) {
          rows.sort((a, b) => {
            for (const spec of orderBy) {
              const [field, dir] = Object.entries(spec)[0]!;
              const sign = (field === "organization" ? (dir as { name: string }).name : dir) === "asc" ? 1 : -1;
              const left = value(a, spec); const right = value(b, spec);
              if (left !== right) return sign * (left < right ? -1 : 1);
            }
            return 0;
          });
        }
        return rows.slice(skip ?? 0, (skip ?? 0) + (take ?? rows.length)).map((row) => ({ ...row, organization: { name: nameOf(row.organizationId) } }));
      },
      count: async (args?: { where?: { reportMonth?: string } }) => state.logs.filter((row) => !args?.where?.reportMonth || row.reportMonth === args.where.reportMonth).length,
      createMany: async ({ data, skipDuplicates }: { data: Row[]; skipDuplicates: boolean }) => {
        let count = 0;
        for (const row of data) {
          const duplicate = state.logs.some((log) => log.organizationId === row.organizationId && log.reportMonth === row.reportMonth);
          if (duplicate && !skipDuplicates) throw new Error("Unique constraint failed");
          if (!duplicate) { state.logs.push({ id: `log-${state.nextId++}`, ...row }); count += 1; }
        }
        return { count };
      },
    },
    monthlyRecordReminderSetting: {
      findUnique: async ({ where }: { where: { clubYear: string } }) => state.settings.find((row) => row.clubYear === where.clubYear) ?? null,
      findFirst: async () => state.settings[0] ?? null,
      upsert: async ({ where, update, create }: { where: { clubYear: string }; update: Row; create: Row }) => {
        const existing = state.settings.find((row) => row.clubYear === where.clubYear);
        if (existing) Object.assign(existing, update); else state.settings.push(create);
      },
    },
    clubDirectorGrant: { findMany: async ({ where }: { where: { organizationId: { in: string[] }; attendeeAccount?: unknown } }) => {
      // The query must ask for active accounts only; the stand-in then applies exactly that filter.
      expect(where.attendeeAccount).toEqual({ disabledAt: null, status: "ACTIVE" });
      return state.grants.filter((grant) => where.organizationId.in.includes(grant.organizationId as string) && activeAccount(grant.attendeeAccount));
    } },
    areaCoordinatorGrant: { findMany: async ({ where }: { where: { attendeeAccount?: unknown } }) => {
      expect(where.attendeeAccount).toEqual({ disabledAt: null, status: "ACTIVE" });
      return state.coordinators.filter((row) => activeAccount(row.attendeeAccount));
    } },
    messageOutbox: {
      findUnique: async ({ where }: { where: { idempotencyKey: string } }) => state.outbox.find((row) => row.idempotencyKey === where.idempotencyKey) ?? null,
      create: async ({ data }: { data: Row }) => {
        if (state.failClubOutbox && String(data.idempotencyKey).includes(state.failClubOutbox)) throw new Error("synthetic outbox failure");
        if (state.outbox.some((row) => row.idempotencyKey === data.idempotencyKey)) throw new Error("Unique constraint failed on idempotencyKey");
        const row = { id: `message-${state.nextId++}`, ...data };
        state.outbox.push(row);
        return { id: row.id };
      },
      upsert: async ({ where, create }: { where: { idempotencyKey: string }; create: Row }) => {
        const existing = state.outbox.find((row) => row.idempotencyKey === where.idempotencyKey);
        if (existing) return { id: existing.id };
        const row = { id: `message-${state.nextId++}`, ...create };
        state.outbox.push(row);
        return { id: row.id };
      },
    },
  };
  return { getPrisma: () => client };
});
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: async (entry: Row) => { state.audit.push(entry); } }));
vi.mock("@/modules/communications/email-delivery", () => ({ processAccountEmailQueue: async (options: { messageIds: string[] }) => { state.delivered.push(options.messageIds); return { sentIds: options.messageIds, rescheduledIds: [] }; } }));
vi.mock("@/modules/communications/account-email", () => ({
  isAccountEmailConfigured: () => state.emailConfigured,
  getAccountEmailSender: () => ({ name: "IMAdventist", address: "events@example.test", replyTo: null }),
}));

import { getMonthlyRecordReminderOverview, sendDueMonthlyRecordReminders, setMonthlyRecordReminderEnabled } from "@/modules/club-reports/monthly-reminders";

const club = (id: string, name: string, isActive = true) => ({ id, name, isActive, type: "CLUB", createdAt: new Date("2024-01-01T00:00:00Z"), newClubApplicationCreated: null });
const director = (organizationId: string, email: string, role = "DIRECTOR") => ({
  organizationId, role, effectiveFrom: new Date("2026-01-01T00:00:00Z"), effectiveTo: null, revokedAt: null,
  attendeeAccount: { displayName: "Pat Person", email },
});
const at = (iso: string) => { vi.setSystemTime(new Date(iso)); return new Date(); };
const outboxFor = (templateKey: string) => state.outbox.filter((row) => row.templateKey === templateKey);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  Object.assign(state, { clubs: [], reports: [], logs: [], grants: [], coordinators: [], settings: [], outbox: [], audit: [], delivered: [], emailConfigured: true, failClubOutbox: null, nextId: 1 });
  // Reminders were turned on for this club year before these tests begin; the launch default has its own tests below.
  state.settings.push({ clubYear: "2026-27", enabled: true });
  state.clubs.push(club("club-a", "Aspen Pathfinders"), club("club-b", "Birch Pathfinders"), club("club-c", "Cedar Pathfinders"), club("club-x", "Closed Pathfinders", false));
  // Aspen has not filed; Birch submitted; Cedar has a draft; the closed club has nothing.
  state.reports.push(
    { organizationId: "club-b", reportMonth: "2026-10", status: "SUBMITTED" },
    { organizationId: "club-c", reportMonth: "2026-10", status: "DRAFT" },
  );
  state.grants.push(
    director("club-a", "aspen.director@example.test"), director("club-a", "aspen.deputy@example.test", "DEPUTY"), director("club-a", "aspen.registrar@example.test", "REGISTRAR"),
    director("club-b", "birch.director@example.test"), director("club-c", "cedar.director@example.test"), director("club-x", "closed.director@example.test"),
  );
  state.coordinators.push({ attendeeAccountId: "acct-ac", attendeeAccount: { displayName: "Alex Coordinator", email: "ac@example.test" } });
});
afterEach(() => vi.useRealTimers());

describe("when it runs", () => {
  it("sends nothing before the 11th", async () => {
    at("2026-11-10T20:00:00Z");
    expect(await sendDueMonthlyRecordReminders()).toMatchObject({ status: "NOT_DUE", reminded: 0 });
    expect(state.outbox).toHaveLength(0);
  });

  it("uses the conference date: late on the 10th in Chicago is still the 10th, early on the 11th is the 11th", async () => {
    at("2026-11-11T04:30:00Z");
    expect((await sendDueMonthlyRecordReminders()).status).toBe("NOT_DUE");
    at("2026-11-11T07:00:00Z");
    expect((await sendDueMonthlyRecordReminders()).status).toBe("RAN");
  });

  it("on the 11th reminds the director and deputy of each unsubmitted active club, and nobody else", async () => {
    at("2026-11-11T15:00:00Z");
    const result = await sendDueMonthlyRecordReminders();
    expect(result).toMatchObject({ status: "RAN", reportMonth: "2026-10", reminded: 2, failed: 0 });
    const reminders = outboxFor("MONTHLY_RECORD_REMINDER");
    expect(reminders.map((row) => row.recipientEmail).sort()).toEqual(["aspen.deputy@example.test", "aspen.director@example.test", "cedar.director@example.test"]);
    for (const row of reminders) {
      expect(row.subjectSnapshot).toContain("October 2026");
      expect(String(row.bodyTextSnapshot)).toMatch(/https:\/\/events\.example\.test\/account\/clubs\/club-[ac]\/records/);
    }
    expect(state.logs.map((row) => [row.organizationId, row.recipients]).sort()).toEqual([["club-a", 2], ["club-c", 1]]);
    expect(state.delivered.flat().length).toBe(state.outbox.length);
    expect(state.audit.filter((row) => row.action === "MONTHLY_RECORD_REMINDER_SENT")).toHaveLength(2);
  });

  it("is idempotent: running again the same day, or on the 12th, sends nothing more", async () => {
    at("2026-11-11T15:00:00Z");
    await sendDueMonthlyRecordReminders();
    const sent = state.outbox.length;
    expect((await sendDueMonthlyRecordReminders()).reminded).toBe(0);
    at("2026-11-12T15:00:00Z");
    expect((await sendDueMonthlyRecordReminders()).reminded).toBe(0);
    expect(state.outbox).toHaveLength(sent);
    expect(state.logs).toHaveLength(2);
  });

  it("two concurrent runs queue each club once", async () => {
    at("2026-11-11T15:00:00Z");
    const results = await Promise.all([sendDueMonthlyRecordReminders(), sendDueMonthlyRecordReminders()]);
    expect(outboxFor("MONTHLY_RECORD_REMINDER")).toHaveLength(3);
    expect(state.logs).toHaveLength(2);
    expect(results.reduce((sum, result) => sum + result.reminded, 0)).toBe(2);
  });

  it("a first run on the 12th still sends for last month only, never an older month", async () => {
    state.reports.push({ organizationId: "club-a", reportMonth: "2026-09", status: "DRAFT" });
    at("2026-11-12T15:00:00Z");
    expect((await sendDueMonthlyRecordReminders()).reportMonth).toBe("2026-10");
    expect(state.logs.every((row) => row.reportMonth === "2026-10")).toBe(true);
  });

  it("a club submitted between the read and the claim is skipped", async () => {
    at("2026-11-11T15:00:00Z");
    state.reports.push({ organizationId: "club-a", reportMonth: "2026-10", status: "SUBMITTED" });
    await sendDueMonthlyRecordReminders();
    expect(state.logs.map((row) => row.organizationId)).toEqual(["club-c"]);
  });

  it("a club with nobody to email is not logged, so a director added later is still reminded", async () => {
    state.grants = state.grants.filter((grant) => grant.organizationId !== "club-c");
    at("2026-11-11T15:00:00Z");
    expect(await sendDueMonthlyRecordReminders()).toMatchObject({ reminded: 1, noRecipient: 1 });
    state.grants.push(director("club-c", "cedar.new@example.test"));
    at("2026-11-12T15:00:00Z");
    expect((await sendDueMonthlyRecordReminders()).reminded).toBe(1);
  });

  it("does not remind a club whose record was submitted once and then reopened", async () => {
    state.reports.push({ organizationId: "club-a", reportMonth: "2026-10", status: "DRAFT", firstSubmittedAt: new Date("2026-11-05T12:00:00Z") });
    at("2026-11-11T15:00:00Z");
    await sendDueMonthlyRecordReminders();
    expect(state.logs.map((row) => row.organizationId)).toEqual(["club-c"]);
  });

  it("does not email a disabled or unverified director or deputy", async () => {
    state.grants = [
      { ...director("club-a", "disabled@example.test"), attendeeAccount: { displayName: "Dis", email: "disabled@example.test", disabledAt: new Date("2026-06-01T00:00:00Z"), status: "ACTIVE" } },
      { ...director("club-a", "unverified@example.test", "DEPUTY"), attendeeAccount: { displayName: "Unv", email: "unverified@example.test", disabledAt: null, status: "PENDING" } },
      director("club-c", "cedar.director@example.test"),
    ];
    at("2026-11-11T15:00:00Z");
    await sendDueMonthlyRecordReminders();
    expect(outboxFor("MONTHLY_RECORD_REMINDER").map((row) => row.recipientEmail)).toEqual(["cedar.director@example.test"]);
    expect(state.logs.map((row) => row.organizationId)).toEqual(["club-c"]);
  });

  it("skips a revoked or ended grant", async () => {
    state.grants = [
      { ...director("club-a", "revoked@example.test"), revokedAt: new Date("2026-06-01T00:00:00Z") },
      { ...director("club-c", "ended@example.test"), effectiveTo: new Date("2026-09-01T00:00:00Z") },
    ];
    at("2026-11-11T15:00:00Z");
    expect((await sendDueMonthlyRecordReminders()).reminded).toBe(0);
  });

  it("queues nothing when email is not set up, and sends the next time it is", async () => {
    state.emailConfigured = false;
    at("2026-11-11T15:00:00Z");
    expect((await sendDueMonthlyRecordReminders()).status).toBe("EMAIL_NOT_CONFIGURED");
    expect(state.logs).toHaveLength(0);
    state.emailConfigured = true;
    expect((await sendDueMonthlyRecordReminders()).reminded).toBe(2);
  });

  it("a failure rolls the club's claim back so the next sweep retries it, and holds the summary", async () => {
    state.failClubOutbox = "club-c";
    at("2026-11-11T15:00:00Z");
    const first = await sendDueMonthlyRecordReminders();
    expect(first).toMatchObject({ reminded: 1, failed: 1, summaries: 0 });
    expect(outboxFor("MONTHLY_RECORD_REMINDER_SUMMARY")).toHaveLength(0);
    expect(state.logs.map((row) => row.organizationId)).toEqual(["club-a"]);
    state.failClubOutbox = null;
    const second = await sendDueMonthlyRecordReminders();
    expect(second).toMatchObject({ reminded: 1, failed: 0, summaries: 1 });
  });
});

describe("the switch", () => {
  it("sends nothing for the whole run while off for the club year, and again once on", async () => {
    at("2026-11-11T15:00:00Z");
    await setMonthlyRecordReminderEnabled(false, "user-1");
    expect(await sendDueMonthlyRecordReminders()).toMatchObject({ status: "SWITCHED_OFF", reminded: 0 });
    expect(state.outbox).toHaveLength(0);
    await setMonthlyRecordReminderEnabled(true, "user-1");
    expect((await sendDueMonthlyRecordReminders()).reminded).toBe(2);
  });

  it("is per club year: off for 2026-27 does not stop the next year's September reminder", async () => {
    at("2026-11-11T15:00:00Z");
    await setMonthlyRecordReminderEnabled(false, "user-1");
    state.reports = [];
    at("2027-09-11T15:00:00Z");
    expect(await sendDueMonthlyRecordReminders()).toMatchObject({ status: "RAN", reportMonth: "2027-08" });
  });

  it("audits each change with who and which year, and writes nothing for a no-op", async () => {
    at("2026-11-11T15:00:00Z");
    expect(await setMonthlyRecordReminderEnabled(true, "user-1")).toMatchObject({ changed: false });
    expect(state.audit).toHaveLength(0);
    expect(await setMonthlyRecordReminderEnabled(false, "user-1")).toEqual({ clubYear: "2026-27", enabled: false, changed: true });
    expect(await setMonthlyRecordReminderEnabled(true, "user-2")).toMatchObject({ changed: true });
    expect(state.audit.map((row) => [row.action, row.actorUserId])).toEqual([
      ["MONTHLY_RECORD_REMINDER_TURNED_OFF", "user-1"],
      ["MONTHLY_RECORD_REMINDER_TURNED_ON", "user-2"],
    ]);
  });
});

describe("the launch default: off until a Clubs Administrator first turns reminders on", () => {
  beforeEach(() => { state.settings.length = 0; });

  it("sends nothing on November 12 when reminders were never turned on, and says so", async () => {
    at("2026-11-12T15:00:00Z");
    expect(await sendDueMonthlyRecordReminders()).toMatchObject({ status: "NOT_STARTED", reminded: 0, summaries: 0 });
    expect(state.outbox).toHaveLength(0);
    expect(state.logs).toHaveLength(0);
    expect(await getMonthlyRecordReminderOverview()).toMatchObject({ enabled: false, started: false, clubYear: "2026-27" });
  });

  it("turning off before it ever started changes nothing and writes nothing", async () => {
    at("2026-11-12T15:00:00Z");
    expect(await setMonthlyRecordReminderEnabled(false, "user-1")).toMatchObject({ changed: false, enabled: false });
    expect(state.settings).toHaveLength(0);
    expect(state.audit).toHaveLength(0);
  });

  it("sends once it is turned on, with the turn-on audited", async () => {
    at("2026-11-12T15:00:00Z");
    expect(await setMonthlyRecordReminderEnabled(true, "user-1")).toEqual({ clubYear: "2026-27", enabled: true, changed: true });
    expect(await getMonthlyRecordReminderOverview()).toMatchObject({ enabled: true, started: true });
    expect(await sendDueMonthlyRecordReminders()).toMatchObject({ status: "RAN", reportMonth: "2026-10", reminded: 2 });
    expect(state.audit.map((row) => row.action)).toContain("MONTHLY_RECORD_REMINDER_TURNED_ON");
  });

  it("stays off for the year after being turned on and then off", async () => {
    at("2026-11-12T15:00:00Z");
    await setMonthlyRecordReminderEnabled(true, "user-1");
    await setMonthlyRecordReminderEnabled(false, "user-1");
    expect(await sendDueMonthlyRecordReminders()).toMatchObject({ status: "SWITCHED_OFF", reminded: 0 });
    expect(await getMonthlyRecordReminderOverview()).toMatchObject({ enabled: false, started: true });
    expect(state.outbox).toHaveLength(0);
  });

  it("a new club year with no row stays on once reminders have launched, even if last year ended off", async () => {
    at("2026-11-12T15:00:00Z");
    await setMonthlyRecordReminderEnabled(true, "user-1");
    await setMonthlyRecordReminderEnabled(false, "user-1");
    state.reports = [];
    at("2027-09-11T15:00:00Z");
    expect(await sendDueMonthlyRecordReminders()).toMatchObject({ status: "RAN", reportMonth: "2027-08" });
  });
});

describe("the Area Coordinator summary", () => {
  it("counts a record submitted and then reopened as submitted, so the numbers add up", async () => {
    state.reports.push({ organizationId: "club-a", reportMonth: "2026-10", status: "DRAFT", firstSubmittedAt: new Date("2026-11-05T12:00:00Z") });
    at("2026-11-11T15:00:00Z");
    await sendDueMonthlyRecordReminders();
    const body = String(outboxFor("MONTHLY_RECORD_REMINDER_SUMMARY")[0]!.bodyTextSnapshot);
    expect(body).toContain("Clubs reminded: 1");
    expect(body).toContain("Clubs submitted: 2");
    expect(body).toContain("Total clubs: 3");
  });

  it("does not email a disabled or unverified coordinator", async () => {
    state.coordinators.push(
      { attendeeAccountId: "acct-off", attendeeAccount: { displayName: "Off", email: "off@example.test", disabledAt: new Date("2026-06-01T00:00:00Z"), status: "ACTIVE" } },
      { attendeeAccountId: "acct-new", attendeeAccount: { displayName: "New", email: "new@example.test", disabledAt: null, status: "PENDING" } },
    );
    at("2026-11-11T15:00:00Z");
    await sendDueMonthlyRecordReminders();
    expect(outboxFor("MONTHLY_RECORD_REMINDER_SUMMARY").map((row) => row.recipientEmail)).toEqual(["ac@example.test"]);
  });

  it("is one email per coordinator, numbers only, and not repeated", async () => {
    at("2026-11-11T15:00:00Z");
    expect((await sendDueMonthlyRecordReminders()).summaries).toBe(1);
    const [summary] = outboxFor("MONTHLY_RECORD_REMINDER_SUMMARY");
    expect(summary).toMatchObject({ recipientEmail: "ac@example.test" });
    expect(String(summary!.bodyTextSnapshot)).toContain("Clubs reminded: 2");
    expect(String(summary!.bodyTextSnapshot)).toContain("Clubs submitted: 1");
    expect(String(summary!.bodyTextSnapshot)).toContain("Total clubs: 3");
    for (const name of ["Aspen", "Birch", "Cedar", "Pat Person"]) expect(String(summary!.bodyTextSnapshot) + String(summary!.subjectSnapshot)).not.toContain(name);
    at("2026-11-12T15:00:00Z");
    expect((await sendDueMonthlyRecordReminders()).summaries).toBe(0);
    expect(outboxFor("MONTHLY_RECORD_REMINDER_SUMMARY")).toHaveLength(1);
  });
});

describe("the log a Clubs Administrator sees", () => {
  function seedLog(count: number) {
    state.clubs.length = 0;
    for (let index = 0; index < count; index += 1) {
      const id = `log-club-${String(index).padStart(3, "0")}`;
      state.clubs.push(club(id, `Club ${String(count - index).padStart(3, "0")}`));
      state.logs.push({ id: `row-${String(index).padStart(3, "0")}`, organizationId: id, reportMonth: "2026-10", clubYear: "2026-27", recipients: (index % 3) + 1, sentAt: new Date(Date.UTC(2026, 10, 11, 12, 0, index)) });
    }
  }

  it("pages and sorts every row, not just the newest 100, with the real total", async () => {
    seedLog(130);
    const first = await getMonthlyRecordReminderOverview(new Date("2026-11-20T12:00:00Z"), { page: 1 });
    expect(first.slice).toMatchObject({ total: 130, page: 1, pageCount: 6, from: 1, to: 25 });
    expect(first.slice.items[0]!.id).toBe("row-129");
    const last = await getMonthlyRecordReminderOverview(new Date("2026-11-20T12:00:00Z"), { page: 6 });
    expect(last.slice).toMatchObject({ page: 6, from: 126, to: 130 });
    expect(last.slice.items.map((row) => row.id)).toEqual(["row-004", "row-003", "row-002", "row-001", "row-000"]);
    const byClub = await getMonthlyRecordReminderOverview(new Date("2026-11-20T12:00:00Z"), { sort: { key: "club", dir: "asc" }, page: 6 });
    expect(byClub.slice.items.at(-1)!.clubName).toBe("Club 130");
    expect(byClub.slice.items[0]!.clubName).toBe("Club 126");
  });

  it("clamps a page past the end and ignores an unknown sort column", async () => {
    seedLog(30);
    const past = await getMonthlyRecordReminderOverview(new Date("2026-11-20T12:00:00Z"), { page: 99, sort: { key: "bogus" as never, dir: "asc" } });
    expect(past.slice).toMatchObject({ page: 2, total: 30, from: 26, to: 30 });
  });

  it("lists month, club, how many people and when, and no address or name", async () => {
    at("2026-11-11T15:00:00Z");
    await sendDueMonthlyRecordReminders();
    const overview = await getMonthlyRecordReminderOverview();
    expect(overview).toMatchObject({ clubYear: "2026-27", enabled: true });
    expect(overview.slice).toMatchObject({ total: 2, from: 1, to: 2, page: 1 });
    expect(overview.slice.items.map((row) => [row.reportMonth, row.clubName, row.recipients]).sort()).toEqual([
      ["2026-10", "Aspen Pathfinders", 2],
      ["2026-10", "Cedar Pathfinders", 1],
    ]);
    expect(JSON.stringify(overview)).not.toContain("example.test");
    expect(overview.slice.items[0]!.sentAt).toBe("2026-11-11T15:00:00.000Z");
  });
});
