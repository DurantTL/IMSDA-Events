/**
 * #2038: a club registration's team name reaches staff lists. The registration query loads the club registration, and
 * the record carries "Team (Club)", the club alone without a team, or null for a registration that is not a club's.
 * Synthetic data only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({ registration: { findMany: mocks.findMany } }),
}));

import { listRegistrations } from "@/modules/registrations/repository";

function baseRegistration(overrides: Record<string, unknown> = {}) {
  return {
    id: "reg_1",
    eventId: "evt_pbe",
    confirmationCode: "REG-TEAM-1",
    status: "SUBMITTED",
    totalAmount: "0.00",
    contactSnapshot: {},
    submittedAt: new Date("2026-11-01T00:00:00.000Z"),
    createdAt: new Date("2026-11-01T00:00:00.000Z"),
    updatedAt: new Date("2026-11-01T00:00:00.000Z"),
    accountHolderPerson: { id: "per_1", firstName: "Dana", lastName: "Director", normalizedEmail: "dana@example.test", phone: "(515) 555-0100" },
    attendees: [],
    payments: [],
    adjustments: [],
    operations: [],
    publicFormSubmission: null,
    clubRegistration: null,
    event: { billingMode: "STANDARD", attendeeTypes: [] },
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("registration.clubTeamLabel (#2038)", () => {
  it("asks the database for the club registration's team and club name", async () => {
    mocks.findMany.mockResolvedValue([]);
    await listRegistrations("evt_pbe");
    expect(mocks.findMany.mock.calls[0]![0].include.clubRegistration).toEqual({
      select: { teamName: true, organization: { select: { name: true } } },
    });
  });

  it("is the team and its club for a named team", async () => {
    mocks.findMany.mockResolvedValue([baseRegistration({ clubRegistration: { teamName: "Bible Bees", organization: { name: "Demo Eagles Club" } } })]);
    const [registration] = await listRegistrations("evt_pbe");
    expect(registration!.clubTeamLabel).toBe("Bible Bees (Demo Eagles Club)");
  });

  it("is the club alone when the event has no teams", async () => {
    mocks.findMany.mockResolvedValue([baseRegistration({ clubRegistration: { teamName: null, organization: { name: "Demo Eagles Club" } } })]);
    const [registration] = await listRegistrations("evt_pbe");
    expect(registration!.clubTeamLabel).toBe("Demo Eagles Club");
  });

  it("is null for a registration that is not a club's", async () => {
    mocks.findMany.mockResolvedValue([baseRegistration()]);
    const [registration] = await listRegistrations("evt_pbe");
    expect(registration!.clubTeamLabel).toBeNull();
  });
});
