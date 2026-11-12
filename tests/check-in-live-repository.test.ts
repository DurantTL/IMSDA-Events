import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({ getPrisma: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: dependencies.getPrisma }));

import { LIVE_CHANGES_LIMIT, applyLiveBalanceChanges, parseLiveCheckInChanges } from "@/modules/checkin/live-changes";
import { listCheckInChanges, liveRegistrationBalanceCents } from "@/modules/checkin/live-repository";

function rows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    registrationAttendeeId: `attendee_${index}`,
    checkedInAt: new Date(Date.UTC(2026, 9, 9, 14, 0, 0) - index * 1000),
    undoneAt: null,
  }));
}

function prismaReturning(found: ReturnType<typeof rows>, money: unknown[] = []) {
  const findMany = vi.fn().mockResolvedValue(found);
  const registrationFindMany = vi.fn().mockResolvedValue(money);
  dependencies.getPrisma.mockReturnValue({ checkIn: { findMany }, registration: { findMany: registrationFindMany } });
  return Object.assign(findMany, { registrationFindMany });
}

beforeEach(() => vi.clearAllMocks());

describe("live check-in delta (#825)", () => {
  it("answers with the changes and no truncation flag when everything fits", async () => {
    const findMany = prismaReturning(rows(3));
    const answer = await listCheckInChanges("event_1", new Date("2026-10-09T13:00:00Z"));
    expect(answer.changes).toHaveLength(3);
    expect("truncated" in answer).toBe(false);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: LIVE_CHANGES_LIMIT + 1 }));
  });

  it("says so when the limit is hit, so the client reloads the roster instead of trusting a partial list", async () => {
    prismaReturning(rows(LIVE_CHANGES_LIMIT + 1));
    const answer = await listCheckInChanges("event_1", new Date("2026-10-09T13:00:00Z"));
    expect(answer.truncated).toBe(true);
    expect(answer.changes).toHaveLength(LIVE_CHANGES_LIMIT);
  });

  it("an answer of exactly the limit is complete", async () => {
    prismaReturning(rows(LIVE_CHANGES_LIMIT));
    const answer = await listCheckInChanges("event_1", new Date("2026-10-09T13:00:00Z"));
    expect(answer.truncated).toBeUndefined();
  });

  it("the client keeps the flag when it parses the answer", () => {
    expect(parseLiveCheckInChanges({ now: "2026-10-09T14:00:00.000Z", changes: [], truncated: true }))
      .toEqual({ now: "2026-10-09T14:00:00.000Z", changes: [], balances: [], truncated: true });
    expect(parseLiveCheckInChanges({ now: "2026-10-09T14:00:00.000Z", changes: [], truncated: "yes" }))
      .toEqual({ now: "2026-10-09T14:00:00.000Z", changes: [], balances: [] });
  });
});

describe("live balance changes (#1577)", () => {
  const registration = (overrides: Record<string, unknown> = {}) => ({
    confirmationCode: "REG-AAAA1111",
    totalAmount: 100,
    event: { billingMode: "ATTENDEE_PAY" },
    payments: [{ amount: 40, refunds: [{ amount: 10 }] }],
    ...overrides,
  });

  it("asks only for this event's active registrations with a payment or refund written since", async () => {
    const findMany = prismaReturning([], [registration()]);
    const since = new Date("2026-10-09T13:00:00Z");
    const answer = await listCheckInChanges("event_1", since);
    expect(answer.balances).toEqual([["REG-AAAA1111", 7000]]);
    const where = findMany.registrationFindMany.mock.calls[0][0].where;
    expect(where.eventId).toBe("event_1");
    expect(where.status).toEqual({ in: ["SUBMITTED", "CONFIRMED"] });
    expect(where.OR).toEqual([
      { payments: { some: { updatedAt: { gte: since } } } },
      { payments: { some: { refunds: { some: { updatedAt: { gte: since } } } } } },
    ]);
    // Only succeeded payments and refunds count, as on the page load.
    const select = findMany.registrationFindMany.mock.calls[0][0].select;
    expect(select.payments.where).toEqual({ status: "SUCCEEDED" });
    expect(select.payments.select.refunds.where).toEqual({ status: "SUCCEEDED" });
  });

  it("is an empty list when nothing changed", async () => {
    prismaReturning([]);
    expect((await listCheckInChanges("event_1", new Date())).balances).toEqual([]);
  });

  it("shows 0 for a church-billed event, never below 0, and the full total when nothing is paid", () => {
    expect(liveRegistrationBalanceCents(registration({ event: { billingMode: "DEFERRED_ORGANIZATION_INVOICE" } }))).toBe(0);
    expect(liveRegistrationBalanceCents(registration({ payments: [{ amount: 150, refunds: [] }] }))).toBe(0);
    expect(liveRegistrationBalanceCents(registration({ payments: [] }))).toBe(10_000);
  });

  it("says the answer is incomplete when too many registrations changed", async () => {
    prismaReturning([], Array.from({ length: LIVE_CHANGES_LIMIT + 1 }, (_, index) => registration({ confirmationCode: `REG-${index}` })));
    const answer = await listCheckInChanges("event_1", new Date());
    expect(answer.truncated).toBe(true);
    expect(answer.balances).toHaveLength(LIVE_CHANGES_LIMIT);
  });

  it("the client parses balances defensively and treats an older answer as none", () => {
    expect(parseLiveCheckInChanges({ now: "2026-10-09T14:00:00.000Z", changes: [] })?.balances).toEqual([]);
    expect(parseLiveCheckInChanges({
      now: "2026-10-09T14:00:00.000Z",
      changes: [],
      balances: [["REG-1", 500], ["REG-2", -1], ["REG-3", 1.5], [1, 2], "x"],
    })?.balances).toEqual([["REG-1", 500]]);
  });

  it("applies a balance to everyone on the registration and keeps the array when nothing differs", () => {
    const arrivals = [
      { id: "a", confirmationCode: "REG-1", balanceCents: 500 },
      { id: "b", confirmationCode: "REG-1", balanceCents: 500 },
      { id: "c", confirmationCode: "REG-2", balanceCents: 0 },
    ];
    const updated = applyLiveBalanceChanges(arrivals, [["REG-1", 0]]);
    expect(updated.map((arrival) => arrival.balanceCents)).toEqual([0, 0, 0]);
    expect(applyLiveBalanceChanges(arrivals, [["REG-1", 500], ["REG-9", 3]])).toBe(arrivals);
    expect(applyLiveBalanceChanges(arrivals, [])).toBe(arrivals);
  });
});
