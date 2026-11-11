import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

/**
 * Sterling Volunteers reminders (#1844): the staff list, the preview and the Send, against an in-memory stand-in for
 * the database. Synthetic people only.
 */
type Member = { id: string; organizationId: string; personId: string; role: string; attendeeType: "ADULT" | "STAFF"; firstName: string; lastName: string; email: string | null; check: { complianceStatus: string | null; expiresOn: string | null } | null };

const state = vi.hoisted(() => ({
  members: [] as Array<Record<string, unknown>>,
  reminders: [] as Array<Record<string, unknown>>,
  grants: [] as Array<Record<string, unknown>>,
  outbox: [] as Array<Record<string, unknown>>,
  audit: [] as Array<Record<string, unknown>>,
  delivered: [] as string[][],
  emailConfigured: true,
  nextId: 1,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ APP_BASE_URL: "https://events.example.test" }) }));
vi.mock("@/lib/prisma", () => {
  const client = {
    $executeRaw: async () => 1,
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => {
      const before = { reminders: [...state.reminders], outbox: [...state.outbox], audit: [...state.audit] };
      try {
        return await run(client);
      } catch (error) {
        Object.assign(state, before);
        throw error;
      }
    },
    clubRosterMember: { findMany: async () => state.members },
    backgroundCheckReminder: {
      findMany: async ({ where }: { where: { clubYear?: string; personId?: { in: string[] }; sentAt?: { gte: Date } } }) => state.reminders.filter((row) =>
        (!where.clubYear || row.clubYear === where.clubYear)
        && (!where.personId || where.personId.in.includes(row.personId as string))
        && (!where.sentAt || (row.sentAt as Date) >= where.sentAt.gte)),
      createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => { state.reminders.push(...data.map((row) => ({ id: `r-${state.nextId++}`, ...row }))); return { count: data.length }; },
    },
    clubDirectorGrant: { findMany: async () => state.grants },
    messageOutbox: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (state.outbox.some((row) => row.idempotencyKey === data.idempotencyKey)) throw new Error("Unique constraint failed on idempotencyKey");
        const row = { id: `message-${state.nextId++}`, ...data };
        state.outbox.push(row);
        return { id: row.id };
      },
    },
  };
  return { getPrisma: () => client };
});
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: async (entry: Record<string, unknown>) => { state.audit.push(entry); } }));
vi.mock("@/modules/events/lifecycle", () => ({ calendarDateInEventTimeZone: (date: Date) => date.toISOString().slice(0, 10) }));
vi.mock("@/modules/background-checks/repository", () => ({
  rosterMemberCheckEvidenceSelect: {},
  personCheckEvidenceSelect: {},
  uncachedChecksForRosterMembers: async () => new Map(),
}));
vi.mock("@/modules/communications/email-delivery", () => ({ processAccountEmailQueue: async (options: { messageIds: string[] }) => { state.delivered.push(options.messageIds); return { sentIds: options.messageIds, rescheduledIds: [] }; } }));
vi.mock("@/modules/communications/account-email", () => ({
  isAccountEmailConfigured: () => state.emailConfigured,
  getAccountEmailSender: () => ({ name: "IMAdventist", address: "events@example.test", replyTo: null }),
}));

import { listSterlingActionPeople, previewSterlingReminders, sendSterlingReminders } from "@/modules/background-checks/reminders";
import { BackgroundCheckOperationError } from "@/modules/background-checks/errors";

const NOW = new Date("2026-11-11T18:00:00Z");

function member(m: Member) {
  return {
    id: m.id,
    organizationId: m.organizationId,
    personId: m.personId,
    role: m.role,
    attendeeType: m.attendeeType,
    sealedBirthDate: null,
    organization: { name: m.organizationId === "club-1" ? "Maple Pathfinders" : "Oak Adventurers", parentOrganization: null },
    person: {
      firstName: m.firstName,
      lastName: m.lastName,
      normalizedEmail: m.email,
      attendeeAccountLinks: [],
      backgroundCheckMatch: m.check ? { entry: m.check } : null,
    },
  };
}

const grant = (organizationId: string, email: string, displayName: string) => ({
  organizationId, role: "DIRECTOR", effectiveFrom: new Date("2026-01-01T00:00:00Z"), effectiveTo: null, revokedAt: null, attendeeAccount: { email, displayName },
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  state.members = [
    member({ id: "m1", organizationId: "club-1", personId: "p1", role: "Counselor", attendeeType: "STAFF", firstName: "Avery", lastName: "Testperson", email: "avery@example.test", check: { complianceStatus: null, expiresOn: "2026-12-01" } }),
    member({ id: "m2", organizationId: "club-1", personId: "p2", role: "", attendeeType: "ADULT", firstName: "Blair", lastName: "Samplesmith", email: null, check: { complianceStatus: "NOT_COMPLIANT", expiresOn: "2026-09-01" } }),
    member({ id: "m3", organizationId: "club-2", personId: "p3", role: "Driver", attendeeType: "ADULT", firstName: "Casey", lastName: "Exampleton", email: "casey@example.test", check: null }),
    member({ id: "m4", organizationId: "club-2", personId: "p4", role: "Helper", attendeeType: "ADULT", firstName: "Devon", lastName: "Fakename", email: null, check: null }),
    member({ id: "m5", organizationId: "club-1", personId: "p5", role: "Staff", attendeeType: "STAFF", firstName: "Eli", lastName: "Clearson", email: "eli@example.test", check: { complianceStatus: null, expiresOn: "2027-08-01" } }),
  ];
  state.reminders = [];
  state.grants = [grant("club-1", "dana@example.test", "Dana Director"), grant("club-1", "DANA@example.test", "Dana Director")];
  state.outbox = [];
  state.audit = [];
  state.delivered = [];
  state.emailConfigured = true;
  state.nextId = 1;
});
afterEach(() => vi.useRealTimers());

const list = (input: Partial<Parameters<typeof listSterlingActionPeople>[0]> = {}) => listSterlingActionPeople({ filter: "not-current", sort: "name", dir: "asc", page: 1, now: NOW, ...input });

describe("the People to follow up list", () => {
  it("lists only the not-current people by default and counts every quick filter", async () => {
    const result = await list();
    expect(result.items.map((row) => row.name)).toEqual(["Casey Exampleton", "Devon Fakename", "Blair Samplesmith"]);
    expect(result.counts).toEqual({ expiring: 1, notCurrent: 3, all: 5, current: 1 });
    expect(result.total).toBe(3);
  });

  it("shows an expiry only when it comes from a Sterling date, and the role or the member type", async () => {
    const all = (await list({ filter: "all", sort: "name" })).items;
    const avery = all.find((row) => row.name === "Avery Testperson")!;
    expect(avery).toMatchObject({ state: "FLAGGED", statusText: "Expiring soon", expiresOn: "2026-12-01", role: "Counselor", hasOwnEmail: true });
    expect(all.find((row) => row.name === "Blair Samplesmith")).toMatchObject({ role: "Adult", state: "NOT_COMPLIANT", hasOwnEmail: false });
    expect(all.find((row) => row.name === "Casey Exampleton")).toMatchObject({ state: "NO_RECORD", expiresOn: null });
    expect(all.find((row) => row.name === "Avery Testperson")!.personHref).toBe("/admin/organizations/club-1/club#member-m1");
  });

  it("filters expiring and sorts on the server, and never sends an address to the page", async () => {
    const expiring = await list({ filter: "expiring" });
    expect(expiring.items.map((row) => row.name)).toEqual(["Avery Testperson"]);
    const byClub = await list({ filter: "all", sort: "club", dir: "desc" });
    expect(byClub.items[0]!.clubName).toBe("Oak Adventurers");
    expect(JSON.stringify(byClub)).not.toContain("@example.test");
  });

  it("pages at fifty and shows when someone was last reminded", async () => {
    state.reminders = [{ id: "r0", personId: "p3", organizationId: "club-2", clubYear: "2026-27", sentAt: new Date("2026-11-05T12:00:00Z") }];
    const result = await list({ page: 9 });
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(50);
    expect(result.items.find((row) => row.name === "Casey Exampleton")!.lastRemindedAt).toBe("2026-11-05T12:00:00.000Z");
  });
});

describe("the reminder preview", () => {
  it("shows every message as it will be sent and lists people with nobody to tell separately", async () => {
    const preview = await previewSterlingReminders({ rosterMemberIds: ["m1", "m2", "m3", "m4", "m5"] }, { now: NOW });
    // m5 is current and ignored.
    expect(preview.selected).toBe(4);
    expect(preview.noRecipient).toEqual([{ rosterMemberId: "m4", name: "Devon Fakename", clubName: "Oak Adventurers" }]);
    const director = preview.messages.filter((m) => m.label.startsWith("Director"));
    expect(director).toHaveLength(1);
    expect(director[0]!.to.email).toBe("dana@example.test");
    expect(director[0]!.bodyText).toContain("Avery Testperson");
    expect(director[0]!.bodyText).toContain("Blair Samplesmith");
    expect(director[0]!.bodyText).not.toContain("Eli Clearson");
    expect(preview.messages.filter((m) => m.label === "Volunteer").map((m) => m.to.email).sort()).toEqual(["avery@example.test", "casey@example.test"]);
    expect(preview.directorOnly).toBe(1);
    expect(preview.recipients).toHaveLength(preview.messages.length);
    expect(preview.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("covers everyone in a filter and still ignores people whose check is current", async () => {
    const all = await previewSterlingReminders({ filter: "all", all: true }, { now: NOW });
    expect(all.selected).toBe(4);
    const expiring = await previewSterlingReminders({ filter: "expiring", all: true }, { now: NOW });
    expect(expiring.selected).toBe(1);
  });

  it("flags people reminded within a week, and gives the same fingerprint for the same plan", async () => {
    state.reminders = [{ id: "r0", personId: "p1", organizationId: "club-1", clubYear: "2026-27", sentAt: new Date("2026-11-08T12:00:00Z") }];
    const first = await previewSterlingReminders({ rosterMemberIds: ["m1"] }, { now: NOW });
    const second = await previewSterlingReminders({ rosterMemberIds: ["m1"] }, { now: NOW });
    expect(first.recentlyReminded).toEqual([{ rosterMemberId: "m1", name: "Avery Testperson", clubName: "Maple Pathfinders", remindedAt: "2026-11-08T12:00:00.000Z" }]);
    expect(first.fingerprint).toBe(second.fingerprint);
  });

  it("refuses more than 500 people", async () => {
    await expect(previewSterlingReminders({ rosterMemberIds: Array.from({ length: 501 }, (_, i) => `x${i}`) })).rejects.toMatchObject({ code: "TOO_MANY_PEOPLE" });
  });
});

describe("sending reminders", () => {
  const selection = { rosterMemberIds: ["m1", "m2", "m3", "m4"] };
  const previewed = () => previewSterlingReminders(selection, { now: NOW });

  it("refuses when the preview changed, and writes nothing", async () => {
    const { fingerprint } = await previewed();
    state.grants = [grant("club-1", "someone-new@example.test", "New Director")];
    await expect(sendSterlingReminders(selection, { fingerprint, actorUserId: "staff-1", now: NOW })).rejects.toMatchObject({ code: "PREVIEW_CHANGED" });
    expect(state.outbox).toHaveLength(0);
    expect(state.reminders).toHaveLength(0);
    expect(state.audit).toHaveLength(0);
  });

  it("refuses when account email is not set up, and writes nothing", async () => {
    const { fingerprint } = await previewed();
    state.emailConfigured = false;
    await expect(sendSterlingReminders(selection, { fingerprint, actorUserId: "staff-1", now: NOW })).rejects.toMatchObject({ code: "REMINDER_EMAIL_NOT_CONFIGURED" });
    expect(state.outbox).toHaveLength(0);
    expect(state.reminders).toHaveLength(0);
  });

  it("queues the emails, logs one row per person reminded and one audit row with no address in it", async () => {
    const { fingerprint, messages } = await previewed();
    const result = await sendSterlingReminders(selection, { fingerprint, actorUserId: "staff-1", now: NOW });
    expect(result).toMatchObject({ people: 3, directorEmails: 1, volunteerEmails: 2, noRecipient: 1 });
    expect(state.outbox).toHaveLength(messages.length);
    expect(state.outbox.every((row) => row.eventId === null && row.templateKey === "STERLING_REMINDER" && row.status === "PENDING")).toBe(true);
    expect(state.outbox.map((row) => row.bodyTextSnapshot)).toEqual(messages.map((m) => m.bodyText));
    // m4 had nobody to tell, so only three people are logged.
    expect(state.reminders.map((row) => row.personId).sort()).toEqual(["p1", "p2", "p3"]);
    expect(state.reminders.every((row) => row.sentByUserId === "staff-1" && row.batchId === result.batchId && row.sentAt === NOW)).toBe(true);
    expect(state.reminders.find((row) => row.personId === "p2")).toMatchObject({ state: "NOT_COMPLIANT", directorRecipients: 1, volunteerEmailed: false });
    expect(state.audit).toHaveLength(1);
    expect(state.audit[0]).toMatchObject({ action: "BACKGROUND_CHECK_REMINDERS_SENT", actorUserId: "staff-1", entityId: result.batchId });
    expect(JSON.stringify(state.audit)).not.toMatch(/@/);
    expect(state.delivered).toHaveLength(1);
  });

  it("asks for confirmation when someone was reminded in the last week, and sends again once confirmed", async () => {
    const { fingerprint } = await previewed();
    await sendSterlingReminders(selection, { fingerprint, actorUserId: "staff-1", now: NOW });
    const outboxAfterFirst = state.outbox.length;
    const again = await previewed();
    const refusal = await sendSterlingReminders(selection, { fingerprint: again.fingerprint, actorUserId: "staff-1", now: NOW }).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(BackgroundCheckOperationError);
    expect((refusal as BackgroundCheckOperationError).code).toBe("RECENTLY_REMINDED");
    expect((refusal as BackgroundCheckOperationError).details).toMatchObject({ recentlyReminded: [{ name: "Avery Testperson" }, { name: "Blair Samplesmith" }, { name: "Casey Exampleton" }] });
    expect(state.outbox).toHaveLength(outboxAfterFirst);
    await sendSterlingReminders(selection, { fingerprint: again.fingerprint, confirmRecent: true, actorUserId: "staff-1", now: NOW });
    expect(state.outbox.length).toBe(outboxAfterFirst * 2);
    expect(state.audit).toHaveLength(2);
  });

  it("does not count a reminder older than a week as recent", async () => {
    state.reminders = [{ id: "r0", personId: "p1", organizationId: "club-1", clubYear: "2026-27", sentAt: new Date("2026-11-01T12:00:00Z") }];
    const { fingerprint } = await previewed();
    await expect(sendSterlingReminders(selection, { fingerprint, actorUserId: "staff-1", now: NOW })).resolves.toMatchObject({ people: 3 });
  });

  it("refuses when there is nobody at all to send to", async () => {
    const only = { rosterMemberIds: ["m4"] };
    const { fingerprint } = await previewSterlingReminders(only, { now: NOW });
    await expect(sendSterlingReminders(only, { fingerprint, actorUserId: "staff-1", now: NOW })).rejects.toMatchObject({ code: "NOTHING_TO_SEND" });
  });
});
