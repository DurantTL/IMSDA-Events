import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The two office digests write their feed item (#1033) only when a digest row is really waiting to leave: a paused or
 * disabled event suppresses the email, and then there is no alert. Synthetic data only.
 */

const mocks = vi.hoisted(() => ({ loadEventEmailSettings: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/communications/effective-delivery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/communications/effective-delivery")>()),
  loadEventEmailSettings: mocks.loadEventEmailSettings,
}));

import { queueNotices as queueGeneralLinkNotices } from "@/modules/general-link-registrations/repository";
import { queueNotices as queueStaffInvitationNotices } from "@/modules/staff-invitations/repository";

const ON = { deliveryMode: "EXTERNAL_EMAIL", deliveryReason: "ON", senderName: "IMSDA Events", senderEmail: "no-reply@imsda-events.test", replyToEmail: null };
const PAUSED = { ...ON, deliveryMode: "LOCAL_CAPTURE", deliveryReason: "PAUSED" };
const DISABLED = { ...ON, deliveryMode: "DISABLED" };

function tx() {
  return {
    messageOutbox: {
      findUnique: vi.fn(async () => null),
      update: vi.fn(),
      upsert: vi.fn(async ({ create }: { create: { status: string } }) => ({ id: "message-1", status: create.status })),
    },
  };
}

const generalLinkDigest = {
  kind: "STAFF_PENDING_DIGEST", recipientKind: "INTERNAL" as const, email: "staff@imsda-events.test", name: null,
  subject: "Teams waiting", bodyText: "Synthetic body.", dedupeKey: "general-link:STAFF_PENDING_DIGEST:event-1:1:staff@imsda-events.test", skipIfQueued: true,
};
const officeDigest = {
  kind: "OFFICE_DIGEST", recipientKind: "INTERNAL" as const, email: "staff@imsda-events.test", name: null,
  subject: "Registrations waiting", bodyText: "Synthetic body.", idempotencyKey: "staff-invitation:office-digest:event-1:1:staff@imsda-events.test",
  registrationId: null, digestUntil: new Date("2026-11-30T12:15:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadEventEmailSettings.mockResolvedValue(ON);
});

describe("general link staff digest (#1033)", () => {
  const run = async (settings: unknown) => {
    mocks.loadEventEmailSettings.mockResolvedValue(settings);
    const pendingKinds = new Set<string>();
    await queueGeneralLinkNotices(tx() as never, { eventId: "event-1", registrationId: null, submissionId: "sub-1", notices: [generalLinkDigest], pendingKinds });
    return pendingKinds;
  };

  it("reports the digest as waiting to leave when email is on", async () => {
    expect((await run(ON)).has("STAFF_PENDING_DIGEST")).toBe(true);
  });

  it("does not, when the event's email is paused or disabled", async () => {
    expect((await run(PAUSED)).size).toBe(0);
    expect((await run(DISABLED)).size).toBe(0);
  });
});

describe("staff invitation office digest (#1033)", () => {
  const run = async (settings: unknown) => {
    mocks.loadEventEmailSettings.mockResolvedValue(settings);
    const pendingKinds = new Set<string>();
    await queueStaffInvitationNotices(tx() as never, { eventId: "event-1", registrationId: "reg-1", notices: [officeDigest], pendingKinds });
    return pendingKinds;
  };

  it("reports the digest as waiting to leave when email is on", async () => {
    expect((await run(ON)).has("OFFICE_DIGEST")).toBe(true);
  });

  it("does not, when the event's email is paused or disabled", async () => {
    expect((await run(PAUSED)).size).toBe(0);
    expect((await run(DISABLED)).size).toBe(0);
  });

  it("counts a digest still waiting that was refreshed in place", async () => {
    const client = tx();
    client.messageOutbox.findUnique.mockResolvedValueOnce({ id: "waiting", status: "PENDING" } as never);
    const pendingKinds = new Set<string>();
    await queueStaffInvitationNotices(client as never, { eventId: "event-1", registrationId: "reg-1", notices: [officeDigest], pendingKinds });
    expect(client.messageOutbox.update).toHaveBeenCalledTimes(1);
    expect(pendingKinds.has("OFFICE_DIGEST")).toBe(true);
  });
});

describe("the feed write is gated on a waiting digest (#1033)", () => {
  it("is written only behind the pending check in both repositories", () => {
    const general = readFileSync("modules/general-link-registrations/repository.ts", "utf8");
    const staff = readFileSync("modules/staff-invitations/repository.ts", "utf8");
    expect(general).toMatch(/pendingKinds\.has\("STAFF_PENDING_DIGEST"\)\) \{\s+await recordAlertFeedItem/);
    expect(staff).toMatch(/pendingKinds\.has\("OFFICE_DIGEST"\)\) \{\s+await recordAlertFeedItem/);
  });
});
