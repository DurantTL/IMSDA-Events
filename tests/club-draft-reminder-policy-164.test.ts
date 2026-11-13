import { beforeEach, describe, expect, it, vi } from "vitest";

/** #164: saving the policy writes the change and its audit entry together, with old and new values, and nothing when unchanged. */
const state = vi.hoisted(() => ({ clubEvents: ["event-1"], events: ["event-1", "event-2"], policy: null as null | Record<string, unknown>, audit: [] as Array<Record<string, unknown>> }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logError: () => undefined }));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ APP_BASE_URL: "https://events.example.test" }) }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: async (entry: Record<string, unknown>) => { state.audit.push(entry); } }));
vi.mock("@/modules/communications/effective-delivery", () => ({ loadEventEmailSettings: async () => null }));
vi.mock("@/modules/communications/messaging-repository", () => ({ processQueuedMessageIdsAfterCommit: async () => ({ sentIds: [] }) }));
vi.mock("@/lib/prisma", () => {
  const client = {
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => run(client),
    event: {
      findUnique: async ({ where }: { where: { id: string } }) => (state.events.includes(where.id) ? { id: where.id } : null),
      findFirst: async ({ where }: { where: { id: string } }) => (state.clubEvents.includes(where.id) ? { id: where.id } : null),
    },
    clubDraftReminderPolicy: {
      findUnique: async ({ select }: { select: Record<string, true> }) => (state.policy ? Object.fromEntries(Object.keys(select).map((key) => [key, state.policy![key]])) : null),
      upsert: async ({ update, create }: { update: Record<string, unknown>; create: Record<string, unknown> }) => { state.policy = state.policy ? { ...state.policy, ...update } : create; },
    },
  };
  return { getPrisma: () => client };
});

import { saveClubDraftReminderPolicy } from "@/modules/club-registrations/draft-reminders";

const valid = { enabled: true, firstAfterDays: 2, repeatEveryDays: 3, maxReminders: 2, staleAfterDays: 30 };

beforeEach(() => Object.assign(state, { policy: null, audit: [] }));

describe("saving the club registration reminder policy", () => {
  it("turning it on the first time writes the row and an audit entry with the old (defaults, no row) and new values", async () => {
    expect(await saveClubDraftReminderPolicy("event-1", "staff-1", valid)).toMatchObject({ changed: true, found: true });
    expect(state.policy).toMatchObject({ ...valid, updatedByUserId: "staff-1" });
    expect(state.audit).toEqual([expect.objectContaining({ eventId: "event-1", actorUserId: "staff-1", action: "CLUB_DRAFT_REMINDER_TURNED_ON", metadata: { eventId: "event-1", before: null, after: valid } })]);
  });

  it("a timing change audits old and new values; turning it off has its own action", async () => {
    await saveClubDraftReminderPolicy("event-1", "staff-1", valid);
    await saveClubDraftReminderPolicy("event-1", "staff-1", { ...valid, maxReminders: 3 });
    await saveClubDraftReminderPolicy("event-1", "staff-1", { ...valid, maxReminders: 3, enabled: false });
    expect(state.audit.map((entry) => entry.action)).toEqual(["CLUB_DRAFT_REMINDER_TURNED_ON", "CLUB_DRAFT_REMINDER_POLICY_CHANGED", "CLUB_DRAFT_REMINDER_TURNED_OFF"]);
    expect(state.audit[1]!.metadata).toEqual({ eventId: "event-1", before: valid, after: { ...valid, maxReminders: 3 } });
  });

  it("writes nothing when nothing changed, and refuses an invalid policy", async () => {
    await saveClubDraftReminderPolicy("event-1", "staff-1", valid);
    expect(await saveClubDraftReminderPolicy("event-1", "staff-1", valid)).toMatchObject({ changed: false });
    expect(state.audit).toHaveLength(1);
    await expect(saveClubDraftReminderPolicy("event-1", "staff-1", { ...valid, staleAfterDays: 2 })).rejects.toThrow();
    expect(state.audit).toHaveLength(1);
  });

  it("refuses an event that is not a club event, without writing", async () => {
    expect(await saveClubDraftReminderPolicy("event-2", "staff-1", valid)).toMatchObject({ found: true, eligible: false, changed: false });
    expect(state.policy).toBeNull();
    expect(state.audit).toHaveLength(0);
  });

  it("reports a missing event without writing", async () => {
    expect(await saveClubDraftReminderPolicy("event-9", "staff-1", valid)).toMatchObject({ found: false, changed: false });
    expect(state.policy).toBeNull();
  });
});
