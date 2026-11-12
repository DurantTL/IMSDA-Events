import { beforeEach, describe, expect, it, vi } from "vitest";

// A club's kind (#1517) changes wording only: Sterling status is computed from the roster's adult and staff
// members, never from the kind, so an Adventurer club's adults and staff are covered exactly like a Pathfinder club's.

vi.mock("server-only", () => ({}));

const findMany = vi.fn();
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ clubRosterMember: { findMany } }) }));

import { clubRosterComplianceStatuses, clubsComplianceReminderCounts } from "@/modules/background-checks/repository";

function member(id: string, attendeeType: string, check: { complianceStatus: string | null; expiresOn: string | null; issuesNote: string | null } | null, organizationId = "club-1") {
  return { id, organizationId, personId: `person-${id}`, attendeeType, sealedBirthDate: null, organization: { name: "Synthetic Club", parentOrganization: { name: "Synthetic Church" } }, person: { firstName: "Sam", lastName: id, emails: [], backgroundCheckMatch: check ? { entry: check } : null } };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-12T12:00:00Z"));
});

describe("Sterling status for Adventurer clubs (#1517)", () => {
  it("asks for adults and staff of any club, with no club kind in the query", async () => {
    findMany.mockResolvedValue([]);
    await clubRosterComplianceStatuses("adventurer-club-1", "2026", { includeNotes: false });
    const where = findMany.mock.calls[0]![0].where as Record<string, unknown>;
    expect(where).toEqual({ organizationId: "adventurer-club-1", clubYear: "2026", status: "ACTIVE", attendeeType: { in: ["ADULT", "STAFF"] } });
    expect(JSON.stringify(where)).not.toMatch(/clubKind|sourceOrgType/);
  });

  it("reports the same status for the adults and staff of an Adventurer club", async () => {
    findMany.mockResolvedValue([
      member("staff-clear", "STAFF", { complianceStatus: "CLEAR", expiresOn: null, issuesNote: null }),
      member("adult-bad", "ADULT", { complianceStatus: "NOT_COMPLIANT", expiresOn: null, issuesNote: null }),
      member("staff-none", "STAFF", { complianceStatus: null, expiresOn: null, issuesNote: null }),
    ]);
    const result = await clubRosterComplianceStatuses("adventurer-club-1", "2026", { includeNotes: false });
    expect(result.statuses["staff-clear"]?.state).toBe("CLEAR");
    expect(result.statuses["adult-bad"]?.state).toBe("NOT_COMPLIANT");
    expect(result.notInCompliance).toBe(1);
  });

  it("counts reminders for several clubs by roster type only, with no club kind in the query", async () => {
    findMany.mockResolvedValue([]);
    await clubsComplianceReminderCounts(["pathfinder-club-1", "adventurer-club-1"], "2026");
    const where = findMany.mock.calls[0]![0].where as Record<string, unknown>;
    expect(where.attendeeType).toEqual({ in: ["ADULT", "STAFF"] });
    expect(JSON.stringify(where)).not.toMatch(/clubKind|sourceOrgType/);
  });
});
