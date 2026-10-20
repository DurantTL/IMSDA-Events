import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ listEventBackgroundFlags: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/modules/background-checks/repository", () => ({ listEventBackgroundFlags: mocks.listEventBackgroundFlags }));

import { loadDirectorSterlingFollowUp } from "@/modules/background-checks/director-follow-up";
import { mergeSterlingHeldIds, offlineCheckInErrorMessage, sterlingSyncDroppedNotice } from "@/modules/checkin/domain";

beforeEach(() => vi.clearAllMocks());

describe("held list after page load (#874)", () => {
  it("adds anyone the server refused since load, without duplicates", () => {
    expect(mergeSterlingHeldIds(["a1"], ["a2", "a1"])).toEqual(["a1", "a2"]);
    expect(mergeSterlingHeldIds([], [])).toEqual([]);
  });

  it("explains saved check-ins dropped by automatic sync, and says nothing for none", () => {
    expect(sterlingSyncDroppedNotice(0)).toBe("");
    expect(sterlingSyncDroppedNotice(1)).toContain("1 saved check-in was not recorded: Sterling Volunteers check needed before check-in");
    expect(sterlingSyncDroppedNotice(3)).toContain("3 saved check-ins were not recorded");
    expect(offlineCheckInErrorMessage("STERLING_CHECK_NEEDED")).toBe("Sterling Volunteers check needed before check-in.");
  });

  it("is wired: a refusal adds to the held set, auto sync counts drops, an override clears the saved item, the scanner takes the real permission", () => {
    const hook = readFileSync("components/use-offline-check-in-queue.ts", "utf8");
    expect(hook).toContain("setHeldAttendeeIds((current) => mergeSterlingHeldIds(current, [item.attendeeId]))");
    expect(hook).toContain("if (autoSyncRef.current) setSyncDroppedCount");
    expect(hook).toContain("queueRef.current.filter((entry) => entry.attendeeId === attendeeId)");
    expect(hook).toContain("Not confirmed \\u2014 check the row or try again.");
    const scanner = readFileSync("components/check-in-scanner.tsx", "utf8");
    expect(scanner).toContain("canOverride={canCheckIn}");
    expect(scanner).not.toMatch(/canOverride\s*\n/);
    expect(readFileSync("components/check-in-workspace.tsx", "utf8")).toContain("mergeSterlingHeldIds(backgroundFlaggedAttendeeIds, heldAttendeeIds)");
  });
});

describe("director follow-up loader (#874)", () => {
  const flag = { attendeeId: "a1", firstName: "Dana", lastName: "Example", attendeeType: "Adult", state: "EXPIRED", expiresOn: "2026-09-01", contactEmail: "x@example.test", issuesNote: "note", clubName: "Club" };

  it("gives a registrar or reporter (no birth-date capability) nothing, and reads nothing", async () => {
    await expect(loadDirectorSterlingFollowUp({ eventId: "e1", organizationId: "o1", registered: true, capabilities: { seeBirthDates: false } })).resolves.toBeNull();
    expect(mocks.listEventBackgroundFlags).not.toHaveBeenCalled();
  });

  it("gives nothing before the club is registered", async () => {
    await expect(loadDirectorSterlingFollowUp({ eventId: "e1", organizationId: "o1", registered: false, capabilities: { seeBirthDates: true } })).resolves.toBeNull();
    expect(mocks.listEventBackgroundFlags).not.toHaveBeenCalled();
  });

  it("scopes to the club without contact or notes, and returns status fields only", async () => {
    mocks.listEventBackgroundFlags.mockResolvedValue({ adults: 1, lastDay: "2026-10-04", people: [flag] });
    const people = await loadDirectorSterlingFollowUp({ eventId: "e1", organizationId: "o1", registered: true, capabilities: { seeBirthDates: true } });
    expect(mocks.listEventBackgroundFlags).toHaveBeenCalledWith("e1", { organizationId: "o1" });
    expect(people).toEqual([{ attendeeId: "a1", firstName: "Dana", lastName: "Example", attendeeType: "Adult", state: "EXPIRED" }]);
  });

  it("returns null at an event that isn't youth or children's", async () => {
    mocks.listEventBackgroundFlags.mockResolvedValue(null);
    await expect(loadDirectorSterlingFollowUp({ eventId: "e1", organizationId: "o1", registered: true, capabilities: { seeBirthDates: true } })).resolves.toBeNull();
  });
});
