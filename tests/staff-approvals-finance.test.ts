import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invitationFindMany: vi.fn(), selectionFindMany: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    staffInvitation: { findMany: mocks.invitationFindMany },
    eventMealSelection: { findMany: mocks.selectionFindMany },
  }),
}));

import { listStaffApprovalsForFinance } from "@/modules/staff-invitations/finance-approvals";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("staff approvals on the finance report", () => {
  it("lists each approval with who approved it, the worker, the date and the conference-paid meals recorded", async () => {
    mocks.invitationFindMany.mockResolvedValue([
      {
        id: "inv-1",
        group: "PASTOR",
        decidedAt: new Date("2026-11-03T15:00:00Z"),
        decidedBy: { displayName: "Pat Approver" },
        registrationId: "reg-1",
        registration: { confirmationCode: "ABC123", contactSnapshot: { firstName: "Sam", lastName: "Worker" } },
      },
      {
        id: "inv-2",
        group: "VOLUNTEER",
        decidedAt: new Date("2026-11-04T15:00:00Z"),
        decidedBy: null,
        registrationId: "reg-2",
        registration: { confirmationCode: "DEF456", contactSnapshot: { firstName: "Lee", lastName: "Helper" } },
      },
    ]);
    mocks.selectionFindMany.mockResolvedValue([
      { registrationId: "reg-1", quantity: 2, conferenceRateCents: 1000 },
      { registrationId: "reg-1", quantity: 1, conferenceRateCents: 500 },
    ]);

    const result = await listStaffApprovalsForFinance("event-1");

    expect(mocks.invitationFindMany.mock.calls[0][0].where).toMatchObject({ eventId: "event-1", approval: "APPROVED" });
    expect(mocks.selectionFindMany.mock.calls[0][0].where).toMatchObject({ eventId: "event-1", payer: "CONFERENCE", status: "ACTIVE" });
    expect(result.rows).toEqual([
      { id: "inv-1", approvedBy: "Pat Approver", worker: "Sam Worker", group: "PASTOR", decidedAt: "2026-11-03T15:00:00.000Z", confirmationCode: "ABC123", conferenceMeals: 3, conferenceMealCents: 2500 },
      { id: "inv-2", approvedBy: null, worker: "Lee Helper", group: "VOLUNTEER", decidedAt: "2026-11-04T15:00:00.000Z", confirmationCode: "DEF456", conferenceMeals: 0, conferenceMealCents: 0 },
    ]);
    expect(result.totals).toEqual({ approvals: 2, conferenceMeals: 3, conferenceMealCents: 2500 });
  });

  it("returns an empty list without reading meals when nothing was approved", async () => {
    mocks.invitationFindMany.mockResolvedValue([]);
    const result = await listStaffApprovalsForFinance("event-1");
    expect(result).toEqual({ rows: [], totals: { approvals: 0, conferenceMeals: 0, conferenceMealCents: 0 } });
    expect(mocks.selectionFindMany).not.toHaveBeenCalled();
  });
});
