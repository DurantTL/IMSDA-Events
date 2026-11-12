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
      findMany: async ({ where, take }: { where?: { reportMonth?: string }; take?: number }) =>
        state.logs.filter((row) => !where?.reportMonth || row.reportMonth === where.reportMonth).sort((a, b) => (b.sentAt as Date).getTime() - (a.sentAt as Date).getTime()).slice(0, take ?? 1000),
      count: async ({ where }: { where: { reportMonth: string } }) => state.logs.filter((row) => row.reportMonth === where.reportMonth).length,
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
      upsert: async ({ where, update, create }: { where: { clubYear: string }; update: Row; create: Row }) => {
        const existing = state.settings.find((row) => row.clubYear === where.clubYear);
        if (existing) Object.assign(existing, update); else state.settings.push(create);
      },
    },
    clubDirectorGrant: { findMany: async ({ where }: { where: { organizationId: { in: string[] } } }) => state.grants.filter((grant) => where.organizationId.in.includes(grant.organizationId as string)) },
    areaCoordinatorGrant: { findMany: async () => state.coordinators },
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

describe("the Area Coordinator summary", () => {
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
  it("lists month, club, how many people and when, and no address or name", async () => {
    at("2026-11-11T15:00:00Z");
    await sendDueMonthlyRecordReminders();
    const overview = await getMonthlyRecordReminderOverview();
    expect(overview).toMatchObject({ clubYear: "2026-27", enabled: true });
    expect(overview.log.map((row) => [row.reportMonth, row.clubName, row.recipients]).sort()).toEqual([
      ["2026-10", "Aspen Pathfinders", 2],
      ["2026-10", "Cedar Pathfinders", 1],
    ]);
    expect(JSON.stringify(overview)).not.toContain("example.test");
    expect(overview.log[0]!.sentAt).toBe("2026-11-11T15:00:00.000Z");
  });
});
