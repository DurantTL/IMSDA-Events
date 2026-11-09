import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// #1731: the Roster page links to Roster health exactly when the Roster health page would open: the same check
// (`rosterHealthAvailable`, also used by `loadRosterHealth`). Synthetic data only.

const mocks = vi.hoisted(() => ({ isClubFeatureEnabled: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({}) }));
vi.mock("@/modules/club-features/repository", async () => {
  const actual = await vi.importActual<typeof import("@/modules/club-features/repository")>("@/modules/club-features/repository");
  return { ...actual, isClubFeatureEnabled: mocks.isClubFeatureEnabled };
});

import { rosterHealthAvailable } from "@/modules/club-features/roster-health";

const leader = { editProfile: true, guardians: true, seeBirthDates: true };
const registrar = { editProfile: false, guardians: false, seeBirthDates: false };

describe("the Roster page's link to Roster health (#1731)", () => {
  beforeEach(() => mocks.isClubFeatureEnabled.mockReset());

  it("is offered to a director or deputy of a club that switched the feature on", async () => {
    mocks.isClubFeatureEnabled.mockResolvedValue(true);
    expect(await rosterHealthAvailable("org_synthetic", leader)).toBe(true);
    expect(mocks.isClubFeatureEnabled).toHaveBeenCalledWith("org_synthetic", "roster-health-flags");
  });

  it("is not offered while the club has the feature off", async () => {
    mocks.isClubFeatureEnabled.mockResolvedValue(false);
    expect(await rosterHealthAvailable("org_synthetic", leader)).toBe(false);
  });

  it("is not offered to a registrar or reporter, and the feature is not even read for them", async () => {
    mocks.isClubFeatureEnabled.mockResolvedValue(true);
    expect(await rosterHealthAvailable("org_synthetic", registrar)).toBe(false);
    expect(await rosterHealthAvailable("org_synthetic", { ...leader, guardians: false })).toBe(false);
    expect(mocks.isClubFeatureEnabled).not.toHaveBeenCalled();
  });

  it("is drawn by the Roster page only behind that check", () => {
    const source = readFileSync(join(process.cwd(), "app/(public)/account/(portal)/clubs/[organizationId]/roster/page.tsx"), "utf8");
    expect(source).toContain("rosterHealthAvailable(organizationId, access.capabilities)");
    expect(source).toMatch(/\{showRosterHealth && \([\s\S]*?\/roster-health/);
  });
});
