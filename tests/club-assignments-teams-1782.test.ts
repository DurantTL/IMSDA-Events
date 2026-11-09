import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A club registered as a named team (#809) shows its event assignment on the staff club page (#1782). Before, the page
 * looked up the assignment by the empty team key only, so a named team's assignment was never found. Synthetic data only.
 */

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ clubEventAssignment: { findMany: mocks.findMany } }) }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/modules/registrations/amendments-repository", () => ({ currentRegistrationAnswers: vi.fn() }));

import { listClubAssignmentsForClub } from "@/modules/club-registrations/assignments-repository";

const empty = { campsiteLocation: "", campsiteNotes: "", dutyLabel: "", dutyDay: "", dutyTime: "", activityLabel: "", notes: "" };
const row = (teamKey: string, teamName: string | null, fields: Partial<typeof empty>) => ({
  id: `assignment-${teamKey || "club"}`,
  ...empty,
  ...fields,
  clubEventRegistration: { teamKey, teamName },
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listClubAssignmentsForClub", () => {
  it("reads every team's assignment for live registrations only, not just the unnamed one", async () => {
    mocks.findMany.mockResolvedValue([]);
    await listClubAssignmentsForClub("event-1", "club-1");
    const where = mocks.findMany.mock.calls[0][0].where;
    expect(where).toEqual({
      eventId: "event-1",
      organizationId: "club-1",
      clubEventRegistration: { registration: { status: { in: ["SUBMITTED", "CONFIRMED"] } } },
    });
    expect(JSON.stringify(where)).not.toContain("teamKey");
  });

  it("returns a named team's assignment with its team name", async () => {
    mocks.findMany.mockResolvedValue([row("eagles", "Sample Eagles", { campsiteLocation: "Field C, site 12" })]);
    const assignments = await listClubAssignmentsForClub("event-1", "club-1");
    expect(assignments).toEqual([
      expect.objectContaining({ teamKey: "eagles", teamName: "Sample Eagles", fields: expect.objectContaining({ campsiteLocation: "Field C, site 12" }) }),
    ]);
  });

  it("returns one per team for a club with two teams, and leaves out a team with nothing set", async () => {
    mocks.findMany.mockResolvedValue([
      row("eagles", "Sample Eagles", { dutyLabel: "Flag raising" }),
      row("hawks", "Sample Hawks", { activityLabel: "Campfire singing" }),
      row("owls", "Sample Owls", {}),
    ]);
    const assignments = await listClubAssignmentsForClub("event-1", "club-1");
    expect(assignments.map((entry) => entry.teamName)).toEqual(["Sample Eagles", "Sample Hawks"]);
  });

  it("keeps the unnamed registration's assignment with no team name", async () => {
    mocks.findMany.mockResolvedValue([row("", null, { campsiteLocation: "Field A" })]);
    const assignments = await listClubAssignmentsForClub("event-1", "club-1");
    expect(assignments).toEqual([expect.objectContaining({ teamKey: "", teamName: null })]);
  });
});

describe("the staff club page", () => {
  const source = readFileSync(path.join(process.cwd(), "app/(workspace)/more/clubs/[organizationId]/page.tsx"), "utf8");

  it("lists every team's assignment instead of looking up the unnamed one", () => {
    expect(source).toContain("listClubAssignmentsForClub(event.id, organizationId)");
    expect(source).not.toContain("getClubAssignmentForClub");
  });

  it("names each team only when there is more than one or the one team is named", () => {
    expect(source).toContain("assignments.length > 1 || assignments.some((entry) => entry.teamName)");
    expect(source).toMatch(/showTeamNames && <p className="quiet-copy"><strong translate="no">\{assignment\.teamName \?\? club\.name\}<\/strong><\/p>/);
  });
});
