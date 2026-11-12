import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ outboxWhere: null as unknown }));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/communications/messaging-repository", () => ({ captureMessageIdsLocally: vi.fn(), ensureEventMessagingDefaults: vi.fn() }));
vi.mock("@/lib/prisma", () => {
  const row = {
    id: "debrief-invite-event-1", eventId: "event-1", name: "Debrief invitation", templateKey: "EVENT_DEBRIEF_INVITE", trigger: "AFTER_EVENT_END",
    localDate: null, localTime: "08:00", daysBefore: 1, eventTimezone: "America/Chicago", anchorAt: new Date("2027-03-13T22:00:00Z"),
    sendAt: new Date("2027-03-14T13:00:00Z"), dstBehavior: "NONE", dstNote: null, announcementTitle: null, announcementBody: null, audienceQuery: {},
    revision: 1, status: "CANCELLED", claimToken: null, pauseReason: null, failureReason: null, activatedAt: null, cancelledAt: new Date(), completedAt: null,
    createdAt: new Date(), eligibleCount: 0, excludedCount: 0,
  };
  const tx = {
    scheduledEmailBatch: { updateMany: vi.fn(async () => ({ count: 1 })), findFirst: vi.fn(async () => row) },
    messageOutbox: {
      updateMany: vi.fn(async (args: { where: unknown }) => { db.outboxWhere = args.where; return { count: 2 }; }),
      count: vi.fn(async () => 0),
      groupBy: vi.fn(async () => []),
    },
    scheduledEmailRecipient: { updateMany: vi.fn(async () => ({ count: 0 })), groupBy: vi.fn(async () => []) },
    auditLog: { create: vi.fn(async () => ({})) },
    event: { findUnique: vi.fn(async () => ({ timezone: "America/Chicago", startsAt: new Date("2027-03-12T14:00:00Z"), endsAt: new Date("2027-03-13T22:00:00Z"), registrationClosesOn: null, paymentDueOn: null })) },
    $transaction: async (run: (client: unknown) => unknown) => run(tx),
  };
  return { getPrisma: () => tx };
});

import { cancelScheduledEmail } from "@/modules/communications/scheduled-email-repository";

beforeEach(() => { db.outboxWhere = null; });

describe("cancelling a debrief email from the scheduled emails list (#1679)", () => {
  it("also cancels the debrief messages still waiting in the queue for that batch", async () => {
    await cancelScheduledEmail("event-1", "user-1", "debrief-invite-event-1");
    expect(JSON.stringify(db.outboxWhere)).toContain('"debriefBatchId"');
    expect(JSON.stringify(db.outboxWhere)).toContain("debrief-invite-event-1");
    expect((db.outboxWhere as { status: string }).status).toBe("PENDING");
  });
});
