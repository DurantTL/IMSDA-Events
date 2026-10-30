import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** #1245: the Events Administrator pill counts the dashboard's "Need attention" total, with a count-only read. Synthetic data only. */

const mocks = vi.hoisted(() => ({ regCount: vi.fn(), regFindMany: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ registration: { count: mocks.regCount, findMany: mocks.regFindMany } }) }));

import { countEventsAdminWaiting } from "@/modules/events/events-admin-home-repository";
import { buildEventsAdminHome, type EventsAdminEventSource } from "@/modules/events/events-admin-home-model";

const now = new Date("2026-10-26T18:00:00.000Z");
const source = (id: string, overrides: Partial<EventsAdminEventSource>): EventsAdminEventSource => ({
  id, slug: id, name: `Synthetic ${id}`, startsAt: new Date("2026-11-20T15:00:00Z"), endsAt: new Date("2026-11-22T15:00:00Z"), timezone: "America/Chicago",
  location: "Synthetic Camp", capacity: 100, isPublished: true, archivedAt: null, lifecycleState: null, registrationOpensOn: "2026-01-01", registrationClosesOn: "2026-11-15",
  waitlistEnabled: false, registrations: [], attendeeCount: 0, checkedInCount: 0, activeStaffCount: 1, publishedFormCount: 1, waitingCount: 0,
  importIssueCount: 0, importWarningCount: 0, deliveryIssueCount: 0, billingMode: "ATTENDEE_PAY", draftRegistrationCount: 0, failedEmailCount: 0, ...overrides,
});
const reg = (totalAmountCents: number, paidCents = 0, refundedCents = 0) => ({
  status: "CONFIRMED", totalAmountCents,
  payments: paidCents > 0 ? [{ amountCents: paidCents, refunds: refundedCents > 0 ? [{ amountCents: refundedCents }] : [] }] : [],
});
// The same data twice: as dashboard sources, and as the rows the count-only read returns for the attendee-paid event.
const sources = [
  source("a", { registrations: [reg(10000), reg(10000, 10000), reg(10000, 10000, 2500)], draftRegistrationCount: 3 }),
  source("b", { billingMode: "DEFERRED_ORGANIZATION_INVOICE", registrations: [reg(10000)], draftRegistrationCount: 1 }),
];
const row = (total: string, paid?: string, refunded?: string) => ({
  totalAmount: total,
  payments: paid ? [{ amount: paid, refunds: refunded ? [{ amount: refunded }] : [] }] : [],
});

beforeEach(() => {
  mocks.regCount.mockReset();
  mocks.regFindMany.mockReset();
});

describe("countEventsAdminWaiting", () => {
  it("equals the dashboard's Need attention total for the same data, with a count-only read", async () => {
    mocks.regCount.mockResolvedValue(4);
    mocks.regFindMany.mockResolvedValue([row("100.00"), row("100.00", "100.00"), row("100.00", "100.00", "25.00")]);
    const count = await countEventsAdminWaiting(["a", "b"], now);
    expect(count).toBe(buildEventsAdminHome(sources, now).counts.needAttention);
    // Two open balances on the attendee-paid event plus four drafts; the church-billed event's balance is not counted.
    expect(count).toBe(2 + 4);
  });

  it("asks only for the assigned, current events, and never reads outbox, attendees or check-ins", async () => {
    mocks.regCount.mockResolvedValue(0);
    mocks.regFindMany.mockResolvedValue([]);
    await countEventsAdminWaiting(["a", "b"], now);
    const scope = { id: { in: ["a", "b"] }, archivedAt: null, endsAt: { gte: now } };
    expect(mocks.regCount.mock.calls[0]![0].where).toEqual({ status: "DRAFT", event: scope });
    expect(mocks.regFindMany.mock.calls[0]![0].where).toEqual({
      status: { in: ["SUBMITTED", "CONFIRMED"] },
      event: { ...scope, billingMode: { not: "DEFERRED_ORGANIZATION_INVOICE" } },
    });
    expect(Object.keys(mocks.regFindMany.mock.calls[0]![0].select).sort()).toEqual(["payments", "totalAmount"]);
  });

  it("reads nothing for no assigned events, and lets a failed read reach the caller", async () => {
    await expect(countEventsAdminWaiting([], now)).resolves.toBe(0);
    expect(mocks.regCount).not.toHaveBeenCalled();
    mocks.regCount.mockRejectedValue(new Error("synthetic outage"));
    mocks.regFindMany.mockResolvedValue([]);
    await expect(countEventsAdminWaiting(["a"], now)).rejects.toThrow("synthetic outage");
  });

  it("is set on the pill only for an Events Administrator, and left off when it fails, never shown as zero", () => {
    const source = readFileSync(join(process.cwd(), "components/workspace-shell.tsx"), "utf8");
    expect(source).toContain("eventAdminEventIds.length > 0");
    expect(source).toMatch(/countEventsAdminWaiting\(eventAdminEventIds[^\n]*adminRoleCounts\.EVENTS_ADMIN = count[^\n]*\.catch\(\(\) => undefined\)/);
  });
});
