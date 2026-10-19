import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ eventMealSelection: { findMany: mocks.findMany } }) }));

import { loadStaffMealServiceCounts } from "@/modules/meals/staff-coverage";

const service = (id: string, date: string, time: string) => ({ id, name: `Service ${id}`, serviceDate: date, startTime: time, mealType: "SUPPER" as const });
const selection = (id: string, attendee: string | null, serviceRow: ReturnType<typeof service> | null, group: "STAFF" | "PASTOR" | "VOLUNTEER" | null) => ({
  id,
  registrationAttendeeId: attendee,
  service: serviceRow,
  registration: { staffInvitation: group ? { group } : null },
});

describe("loadStaffMealServiceCounts (#1027)", () => {
  beforeEach(() => mocks.findMany.mockReset());

  it("asks only for active conference-paid selections of live, approved staff registrations at a real service", async () => {
    mocks.findMany.mockResolvedValue([]);
    await loadStaffMealServiceCounts("event-1");
    expect(mocks.findMany).toHaveBeenCalledTimes(1);
    const { where, select } = mocks.findMany.mock.calls[0][0];
    expect(where).toEqual({
      eventId: "event-1",
      status: "ACTIVE",
      payer: "CONFERENCE",
      serviceId: { not: null },
      service: { is: { status: "ACTIVE" } },
      registration: { is: { status: { in: ["SUBMITTED", "CONFIRMED"] }, staffInvitation: { is: { approval: "APPROVED" } } } },
    });
    // Names, codes and contact details are never read.
    expect(JSON.stringify(select)).not.toMatch(/firstName|lastName|email|confirmationCode|profileSnapshot|contactSnapshot/);
  });

  it("counts each person once per service and splits by group", async () => {
    const supper = service("supper", "2027-06-16", "17:30");
    mocks.findMany.mockResolvedValue([
      selection("s1", "a1", supper, "STAFF"),
      selection("s2", "a2", supper, "STAFF"),
      selection("s3", "a2", supper, "STAFF"),
      selection("s4", "a3", supper, "PASTOR"),
      selection("s5", "a4", service("breakfast", "2027-06-16", "07:30"), "VOLUNTEER"),
      // Not staff, or not at a service: never counted.
      selection("s6", "a5", supper, null),
      selection("s7", "a6", null, "STAFF"),
    ]);
    const counts = await loadStaffMealServiceCounts("event-1");
    expect(counts.map((entry) => [entry.serviceId, entry.counts.STAFF, entry.counts.PASTOR, entry.counts.VOLUNTEER, entry.total])).toEqual([
      ["breakfast", 0, 0, 1, 1],
      ["supper", 2, 1, 0, 3],
    ]);
  });
});
