import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1680: the baptism follow-up notice. Off unless the event has the module on and a lead address saved; one email per recipient
 * per club per change with only the new names; never twice for a name; the pastor only when one is on file. Synthetic data only.
 */

type Ledger = { eventId: string; organizationId: string; normalizedName: string; displayName: string; leadNotified: boolean; pastorNotified: boolean };

const state = vi.hoisted(() => ({
  moduleOn: true,
  leads: ["lead@example.test"] as string[],
  pastorEmail: "pastor@example.test" as string | null,
  churchId: "church-1" as string | null,
  responses: {} as Record<string, unknown>,
  registrationFound: true,
  ledger: [] as Array<{ eventId: string; organizationId: string; normalizedName: string; displayName: string; leadNotified: boolean; pastorNotified: boolean }>,
  outbox: [] as Array<Record<string, unknown>>,
  senderConfigured: true,
  outboxFails: false,
  audit: vi.fn(),
  deliver: vi.fn(),
  logError: vi.fn(),
  NotConfigured: class extends Error {},
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logError: state.logError, logInfo: vi.fn(), logWarn: vi.fn() }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: state.audit }));
vi.mock("@/modules/registrations/amendments-repository", () => ({
  currentRegistrationAnswers: async () => (state.registrationFound ? { updatedAt: "2026-10-01T00:00:00.000Z", responses: state.responses } : null),
}));
vi.mock("@/modules/communications/account-email", () => ({
  AccountEmailNotConfiguredError: state.NotConfigured,
  isAccountEmailConfigured: () => true,
  getAccountEmailSender: () => {
    if (!state.senderConfigured) throw new state.NotConfigured("not configured");
    return { name: "IMAdventist", address: "events@example.test", replyTo: null };
  },
}));
vi.mock("@/modules/communications/email-delivery", () => ({ processAccountEmailQueue: state.deliver }));
vi.mock("@/lib/prisma", () => {
  const client = {
    eventModule: { findUnique: async () => (state.moduleOn ? { id: "m1" } : null) },
    baptismFollowUpSetting: { findUnique: async () => ({ leadEmails: state.leads }) },
    baptismFollowUp: {
      findMany: async () => state.ledger.map((row) => ({ normalizedName: row.normalizedName })),
      createManyAndReturn: async ({ data }: { data: Ledger[] }) => {
        const created: Ledger[] = [];
        for (const row of data) {
          if (state.ledger.some((existing) => existing.eventId === row.eventId && existing.organizationId === row.organizationId && existing.normalizedName === row.normalizedName)) continue;
          state.ledger.push(row);
          created.push(row);
        }
        return created.map((row) => ({ normalizedName: row.normalizedName, displayName: row.displayName }));
      },
    },
    event: { findUnique: async () => ({ name: "Sample Fall Camporee", startsAt: new Date("2026-10-09T15:00:00Z"), endsAt: new Date("2026-10-11T17:00:00Z"), timezone: "America/Chicago" }) },
    organization: { findUnique: async () => ({ name: "Sample Pathfinder Club", parentOrganizationId: state.churchId }) },
    organizationContact: { findFirst: async () => (state.pastorEmail ? { email: state.pastorEmail } : null) },
    messageOutbox: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (state.outboxFails) throw new Error("outbox down");
        state.outbox.push(data);
        return { id: `msg-${state.outbox.length}` };
      },
    },
    $transaction: async (run: (tx: unknown) => unknown) => run(client),
  };
  return { getPrisma: () => client };
});

import { sendBaptismFollowUpNotices } from "@/modules/baptism-follow-up/notice";

const input = { eventId: "event-1", organizationId: "club-1", registrationId: "reg-1" };
const answer = (baptismNames: string) => { state.responses = { baptism_names: baptismNames, phone: "(515) 555-0100", director_birth_date: "1980-01-01", medical_notes: "synthetic note" }; };

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(state, { moduleOn: true, leads: ["lead@example.test"], pastorEmail: "pastor@example.test", churchId: "church-1", registrationFound: true, ledger: [], outbox: [], senderConfigured: true, outboxFails: false });
  answer("Ava Sample");
});

describe("baptism follow-up notices (#1680)", () => {
  it("sends nothing when the module is off", async () => {
    state.moduleOn = false;
    expect(await sendBaptismFollowUpNotices(input)).toMatchObject({ queued: 0 });
    expect(state.outbox).toHaveLength(0);
    expect(state.ledger).toHaveLength(0);
  });

  it("sends one email to the lead and one to the pastor, with only the names, club, event and dates", async () => {
    const result = await sendBaptismFollowUpNotices(input);
    expect(result).toEqual({ queued: 2, names: 1, recipients: ["lead", "pastor"] });
    expect(state.outbox.map((row) => row.recipientEmail)).toEqual(["lead@example.test", "pastor@example.test"]);
    for (const row of state.outbox) {
      expect(row).toMatchObject({ templateKey: "BAPTISM_FOLLOW_UP", recipientKind: "INTERNAL", status: "PENDING", eventId: null });
      const body = String(row.bodyTextSnapshot);
      expect(body).toContain("Ava Sample");
      expect(body).toContain("Sample Pathfinder Club");
      expect(body).toContain("Sample Fall Camporee");
      expect(body).toContain("October 9");
      expect(body).toContain("follow up");
      expect(body).not.toMatch(/555|1980|synthetic note/);
    }
    expect(state.deliver).toHaveBeenCalledWith({ messageIds: ["msg-1", "msg-2"] });
    expect(state.ledger).toEqual([expect.objectContaining({ normalizedName: "ava sample", leadNotified: true, pastorNotified: true })]);
  });

  it("sends nothing when the same names are saved again, whatever the case or spacing", async () => {
    await sendBaptismFollowUpNotices(input);
    state.outbox.length = 0;
    answer("  ava   SAMPLE ");
    expect(await sendBaptismFollowUpNotices(input)).toMatchObject({ queued: 0 });
    expect(state.outbox).toHaveLength(0);
  });

  it("sends only the new name when an edit adds one, and nothing when one is removed", async () => {
    await sendBaptismFollowUpNotices(input);
    state.outbox.length = 0;
    answer("Ava Sample, Ben Sample");
    expect(await sendBaptismFollowUpNotices(input)).toMatchObject({ queued: 2, names: 1 });
    const body = String(state.outbox[0]!.bodyTextSnapshot);
    expect(body).toContain("Ben Sample");
    expect(body).not.toContain("Ava Sample");
    state.outbox.length = 0;
    answer("Ben Sample");
    expect(await sendBaptismFollowUpNotices(input)).toMatchObject({ queued: 0 });
    // A removed name stays remembered, so putting it back is not announced again.
    answer("Ava Sample, Ben Sample");
    expect(await sendBaptismFollowUpNotices(input)).toMatchObject({ queued: 0 });
    expect(state.ledger).toHaveLength(2);
  });

  it("sends to the lead only when the club's church has no pastor on file", async () => {
    state.pastorEmail = null;
    expect(await sendBaptismFollowUpNotices(input)).toEqual({ queued: 1, names: 1, recipients: ["lead"] });
    expect(state.outbox.map((row) => row.recipientEmail)).toEqual(["lead@example.test"]);
    expect(state.ledger[0]).toMatchObject({ pastorNotified: false });
  });

  it("sends to the lead only when the club has no sponsoring church", async () => {
    state.churchId = null;
    state.pastorEmail = null;
    expect(await sendBaptismFollowUpNotices(input)).toMatchObject({ queued: 1, recipients: ["lead"] });
  });

  it("sends nothing, and remembers nothing, when no event lead is set", async () => {
    state.leads = [];
    expect(await sendBaptismFollowUpNotices(input)).toMatchObject({ queued: 0 });
    expect(state.outbox).toHaveLength(0);
    expect(state.ledger).toHaveLength(0);
  });

  it("emails each lead address once and does not email a pastor who is also a lead twice", async () => {
    state.leads = ["lead@example.test", "second@example.test", "pastor@example.test"];
    await sendBaptismFollowUpNotices(input);
    expect(state.outbox.map((row) => row.recipientEmail)).toEqual(["lead@example.test", "second@example.test", "pastor@example.test"]);
  });

  it("uses a repeatable idempotency key per recipient and change", async () => {
    await sendBaptismFollowUpNotices(input);
    const keys = state.outbox.map((row) => row.idempotencyKey);
    expect(new Set(keys).size).toBe(2);
    expect(keys.every((key) => String(key).startsWith("baptism-follow-up:event-1:club-1:"))).toBe(true);
  });

  it("writes one audit entry per send with counts and roles only", async () => {
    answer("Ava Sample, Ben Sample");
    await sendBaptismFollowUpNotices(input);
    expect(state.audit).toHaveBeenCalledTimes(1);
    const entry = state.audit.mock.calls[0]![0] as { action: string; metadata: Record<string, unknown>; summary: string };
    expect(entry.action).toBe("BAPTISM_FOLLOW_UP_NOTICE_QUEUED");
    expect(entry.metadata).toEqual({ eventId: "event-1", organizationId: "club-1", nameCount: 2, leadCount: 1, pastorNotified: true, recipientRoles: ["lead", "pastor"] });
    expect(JSON.stringify(entry)).not.toMatch(/Ava|Ben|@example/);
  });

  it("does nothing when no sender is configured, and still treats the names as new later", async () => {
    state.senderConfigured = false;
    expect(await sendBaptismFollowUpNotices(input)).toMatchObject({ queued: 0 });
    expect(state.ledger).toHaveLength(0);
  });

  it("never throws when queueing fails, and logs without a name or an address", async () => {
    state.outboxFails = true;
    await expect(sendBaptismFollowUpNotices(input)).resolves.toMatchObject({ queued: 0 });
    expect(state.logError).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(state.logError.mock.calls[0])).not.toMatch(/Ava|@example/);
  });

  it("does nothing for a registration that cannot be read", async () => {
    state.registrationFound = false;
    expect(await sendBaptismFollowUpNotices(input)).toMatchObject({ queued: 0 });
  });
});

describe("where the notice runs (#1680)", () => {
  const source = readFileSync("modules/club-registrations/repository.ts", "utf8");

  it("runs after a submit and after an amendment, and nowhere else in the club registration code", () => {
    expect(source.match(/sendBaptismFollowUpNotices\(/g)).toHaveLength(2);
    const submit = source.slice(source.indexOf("export async function submitClubRegistration"), source.indexOf("export function recordFromJson"));
    expect(submit).toContain("sendBaptismFollowUpNotices(");
    const amend = source.slice(source.indexOf("export async function amendClubRegistration"));
    expect(amend).toContain("sendBaptismFollowUpNotices(");
  });

  it("is not called by a draft save", () => {
    const start = source.indexOf("export async function saveClubRegistrationDraft");
    expect(start).toBeGreaterThan(0);
    const draft = source.slice(start, source.indexOf("\nexport ", start + 10));
    expect(draft).not.toContain("sendBaptismFollowUpNotices");
    expect(draft).not.toContain("baptism");
  });
});
