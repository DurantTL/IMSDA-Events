import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  eventId: string;
  email: string;
  firstName: string;
  lastName: string;
  group: "STAFF";
  linkVersion: number;
  linkIssuedAt: Date;
  sentAt: Date | null;
  sendCount: number;
  lastMessageId: string | null;
  revokedAt: Date | null;
  registeredAt: Date | null;
  registrationId: string | null;
  supersededAt: Date | null;
};

const state = vi.hoisted(() => ({ rows: [] as unknown[], messages: [] as unknown[], staleReads: [] as Date[] }));

const event = {
  id: "event-1", slug: "synthetic-event", name: "Synthetic Event", startsAt: new Date("2027-03-01T15:00:00Z"), endsAt: new Date("2027-03-03T15:00:00Z"),
  timezone: "America/Chicago", isPublished: true, archivedAt: null, lifecycleState: null, audience: "GENERAL", supportContact: "office@example.test",
};

function rows() {
  return state.rows as Row[];
}

function matches(row: Row, where: Record<string, unknown>) {
  return Object.entries(where).every(([key, want]) => {
    if (want && typeof want === "object" && "in" in (want as object)) return ((want as { in: unknown[] }).in).includes(row[key as keyof Row]);
    return (row[key as keyof Row] ?? null) === want;
  });
}

function apply(row: Row, data: Record<string, unknown>) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === "object" && "increment" in (value as object)) (row as Record<string, unknown>)[key] = (row[key as keyof Row] as number) + (value as { increment: number }).increment;
    else (row as Record<string, unknown>)[key] = value;
  }
}

const fake = {
  event: { findUnique: async () => event },
  registrationForm: { findFirst: async () => null },
  staffInvitation: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      const row = rows().find((entry) => entry.id === where.id);
      // A test can queue earlier window starts for the next reads, as if another change landed between the reads.
      const queued = state.staleReads.shift();
      return row ? { ...row, ...(queued ? { linkIssuedAt: queued } : {}), event } : null;
    },
    findFirst: async ({ where }: { where: Record<string, unknown> }) => rows().find((row) => matches(row, where)) ?? null,
    findMany: async ({ where }: { where: Record<string, unknown> }) => rows().filter((row) => matches(row, where)),
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const hits = rows().filter((row) => matches(row, where));
      for (const row of hits) apply(row, data);
      return { count: hits.length };
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = rows().find((entry) => entry.id === where.id)!;
      apply(row, data);
      return row;
    },
    findUniqueOrThrow: async ({ where }: { where: { id: string } }) => rows().find((entry) => entry.id === where.id)!,
  },
  messageOutbox: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      state.messages.push(data);
      return { id: `message-${state.messages.length}` };
    },
  },
  auditLog: { create: async () => ({}) },
  $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(fake),
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => fake }));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ APP_BASE_URL: "https://events.example.test" }) }));
vi.mock("@/modules/communications/effective-delivery", () => ({ loadEventEmailSettings: async () => null }));
vi.mock("@/modules/notifications/settings", () => ({ isNotificationEnabled: async () => false }));

import {
  INVITATION_LINK_DAYS,
  INVITATION_STATUS_LABEL,
  invitationLinkExpired,
  invitationStatus,
} from "@/modules/staff-invitations/domain";
import { invitationStatusWhere } from "@/modules/staff-invitations/list-query";
import { invitationToken } from "@/modules/staff-invitations/link";
import {
  copyInvitationLink,
  getInvitationExperience,
  previewInvitationSend,
  reissueInvitation,
  sendInvitations,
  StaffInvitationError,
  staffInvitationErrorStatus,
  submitInvitationRegistration,
} from "@/modules/staff-invitations/repository";

const DAY = 24 * 60 * 60 * 1000;
const issued = new Date("2027-01-04T12:00:00Z");
const at = (days: number, extraMs = 0) => new Date(issued.getTime() + days * DAY + extraMs);

function makeRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "invite-synthetic-01", eventId: "event-1", email: "ada@example.test", firstName: "Ada", lastName: "Synthetic", group: "STAFF", linkVersion: 1,
    linkIssuedAt: issued, sentAt: null, sendCount: 0, lastMessageId: null, revokedAt: null, registeredAt: null, registrationId: null, supersededAt: null,
    ...overrides,
  };
}

const tokenOf = (row: Row) => invitationToken(row);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at(0));
  state.rows = [makeRow()];
  state.messages = [];
  state.staleReads = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the 14-day link window (#1787)", () => {
  it("is 14 days, and ends exactly at the 14-day mark", () => {
    expect(INVITATION_LINK_DAYS).toBe(14);
    expect(invitationLinkExpired({ linkIssuedAt: issued }, at(14, -1))).toBe(false);
    expect(invitationLinkExpired({ linkIssuedAt: issued }, at(14))).toBe(true);
    expect(invitationLinkExpired({ linkIssuedAt: issued }, at(14, 1))).toBe(true);
    expect(invitationLinkExpired({ linkIssuedAt: issued }, at(0))).toBe(false);
  });

  it("shows Link expired for an unregistered, unrevoked, expired invitation only", () => {
    const base = { revokedAt: null, registeredAt: null, approval: null, sentAt: null, linkIssuedAt: issued, message: null } as const;
    expect(INVITATION_STATUS_LABEL.EXPIRED).toBe("Link expired");
    expect(invitationStatus(base, at(14, -1))).toBe("NOT_SENT");
    expect(invitationStatus(base, at(14))).toBe("EXPIRED");
    expect(invitationStatus({ ...base, sentAt: issued }, at(15))).toBe("EXPIRED");
    expect(invitationStatus({ ...base, sentAt: issued, revokedAt: issued }, at(15))).toBe("REVOKED");
    expect(invitationStatus({ ...base, registeredAt: issued, approval: "WAITING" }, at(30))).toBe("REGISTERED");
    expect(invitationStatus({ ...base, registeredAt: issued, approval: "APPROVED" }, at(30))).toBe("APPROVED");
  });

  it("filters the list by the same cutoff, so each open invitation is in exactly one status", () => {
    const cutoff = at(0);
    const now = at(14);
    expect(invitationStatusWhere("EXPIRED", now)).toEqual({ revokedAt: null, registeredAt: null, linkIssuedAt: { lte: cutoff } });
    expect(invitationStatusWhere("NOT_SENT", now)).toMatchObject({ sentAt: null, linkIssuedAt: { gt: cutoff } });
    expect(invitationStatusWhere("SENT", now)).toMatchObject({ linkIssuedAt: { gt: cutoff } });
    expect(invitationStatusWhere("DELIVERY_FAILED", now)).toMatchObject({ linkIssuedAt: { gt: cutoff } });
  });
});

describe("opening and submitting through a link (#1787)", () => {
  it("opens just inside 14 days and says EXPIRED at 14 days", async () => {
    const token = tokenOf(makeRow());
    expect((await getInvitationExperience(token, at(14, -1))).state).toBe("OPEN");
    const expired = await getInvitationExperience(token, at(14));
    expect(expired).toEqual({ state: "EXPIRED", event: { name: "Synthetic Event", supportContact: "office@example.test" } });
  });

  it("keeps a registered invitation REGISTERED at any age", async () => {
    state.rows = [makeRow({ registeredAt: issued, registrationId: "reg-1" })];
    expect((await getInvitationExperience(tokenOf(rows()[0]!), at(30))).state).toBe("REGISTERED");
  });

  it("gives no new information for a link that is not genuine, revoked or replaced", async () => {
    const row = rows()[0]!;
    const token = tokenOf(row);
    expect(await getInvitationExperience(`${token}x`, at(30))).toEqual({ state: "UNAVAILABLE" });
    row.revokedAt = issued;
    expect(await getInvitationExperience(token, at(30))).toEqual({ state: "UNAVAILABLE" });
    row.revokedAt = null;
    row.supersededAt = issued;
    expect(await getInvitationExperience(token, at(30))).toEqual({ state: "UNAVAILABLE" });
  });

  it("re-checks expiry inside the submit transaction", async () => {
    const token = tokenOf(makeRow());
    // The first read (before the transaction) sees a fresh window; the one inside it sees the window had run out.
    state.staleReads = [at(10), issued];
    const error = await submitInvitationRegistration(token, { firstName: "Ada", lastName: "Synthetic" }, at(14)).catch((caught: unknown) => caught);
    expect((error as StaffInvitationError).code).toBe("INVITATION_EXPIRED");
    expect(rows()[0]!.registeredAt).toBeNull();
  });

  it("refuses a submission through an expired link with INVITATION_EXPIRED (410)", async () => {
    const token = tokenOf(makeRow());
    const error = await submitInvitationRegistration(token, { firstName: "Ada", lastName: "Synthetic" }, at(14)).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StaffInvitationError);
    expect((error as StaffInvitationError).code).toBe("INVITATION_EXPIRED");
    expect((error as StaffInvitationError).message).toMatch(/expired/i);
    expect(staffInvitationErrorStatus("INVITATION_EXPIRED")).toBe(410);
    expect(rows()[0]!.registeredAt).toBeNull();
  });
});

describe("copying, reissuing and sending again (#1787)", () => {
  it("refuses to copy an expired link and copies one still inside its window", async () => {
    state.rows = [makeRow()];
    await expect(copyInvitationLink("event-1", "user-1", rows()[0]!.id, at(14))).rejects.toMatchObject({ code: "INVITATION_UNAVAILABLE", message: "That link has expired. Send it again or reissue it to get a new one." });
    const copied = await copyInvitationLink("event-1", "user-1", rows()[0]!.id, at(14, -1));
    expect(copied.url).toContain(encodeURIComponent(tokenOf(rows()[0]!)));
  });

  it("restarts the 14 days on a reissue and kills the earlier copy", async () => {
    const oldToken = tokenOf(makeRow());
    const reissued = await reissueInvitation("event-1", "user-1", rows()[0]!.id, at(20));
    expect(rows()[0]!.linkIssuedAt).toEqual(at(20));
    expect(reissued.url).toContain(encodeURIComponent(tokenOf(rows()[0]!)));
    expect((await getInvitationExperience(oldToken, at(20))).state).toBe("UNAVAILABLE");
    expect((await getInvitationExperience(tokenOf(rows()[0]!), at(20 + 14, -1))).state).toBe("OPEN");
    expect((await getInvitationExperience(tokenOf(rows()[0]!), at(20 + 14))).state).toBe("EXPIRED");
  });

  it("lets staff send an expired, unregistered invitation again", async () => {
    const preview = await previewInvitationSend("event-1", [rows()[0]!.id], at(15));
    expect(preview.willSend).toBe(1);
    const sent = await sendInvitations("event-1", "user-1", { ids: [rows()[0]!.id], digest: preview.digest }, at(15));
    expect(sent.queued).toBe(1);
  });

  it("keeps the same link and restarts the window when it is sent again inside the window", async () => {
    const token = tokenOf(makeRow());
    const now = at(10);
    const preview = await previewInvitationSend("event-1", [rows()[0]!.id], now);
    await sendInvitations("event-1", "user-1", { ids: [rows()[0]!.id], digest: preview.digest }, now);
    expect(rows()[0]!.linkVersion).toBe(1);
    expect(rows()[0]!.linkIssuedAt).toEqual(now);
    expect((state.messages[0] as { bodyTextSnapshot: string }).bodyTextSnapshot).toContain(encodeURIComponent(token));
    // 14 days from the send, not from the first issue.
    expect((await getInvitationExperience(token, at(10 + 14, -1))).state).toBe("OPEN");
    expect((await getInvitationExperience(token, at(10 + 14))).state).toBe("EXPIRED");
  });

  it("leaves an expired link expired after a send again, and the email carries a new link that opens", async () => {
    const oldToken = tokenOf(makeRow());
    const now = at(20);
    const preview = await previewInvitationSend("event-1", [rows()[0]!.id], now);
    await sendInvitations("event-1", "user-1", { ids: [rows()[0]!.id], digest: preview.digest }, now);
    const row = rows()[0]!;
    expect(row.linkVersion).toBe(2);
    expect(row.linkIssuedAt).toEqual(now);
    expect(row.sendCount).toBe(1);
    const body = (state.messages[0] as { bodyTextSnapshot: string }).bodyTextSnapshot;
    expect(body).not.toContain(encodeURIComponent(oldToken));
    expect(body).toContain(encodeURIComponent(tokenOf(row)));
    expect((await getInvitationExperience(oldToken, now)).state).toBe("UNAVAILABLE");
    expect((await getInvitationExperience(oldToken, at(40))).state).toBe("UNAVAILABLE");
    expect((await getInvitationExperience(tokenOf(row), now)).state).toBe("OPEN");
  });

  it("does not send to a registered or revoked invitation", async () => {
    state.rows = [makeRow({ registeredAt: issued, registrationId: "reg-1" })];
    await expect(sendInvitations("event-1", "user-1", { ids: ["invite-synthetic-01"], digest: "x" }, at(30))).rejects.toMatchObject({ code: "NOTHING_TO_SEND" });
  });
});
