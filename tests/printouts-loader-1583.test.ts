import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({ getTeamSettings: vi.fn(), moduleState: vi.fn(), logError: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logError: dependencies.logError }));
vi.mock("@/modules/club-teams/settings-repository", () => ({ getTeamSettings: dependencies.getTeamSettings }));
vi.mock("@/modules/event-modules/service", () => ({ moduleState: dependencies.moduleState }));

import { loadPrintoutAvailability } from "@/modules/reporting/printouts-repository";

beforeEach(() => vi.clearAllMocks());

describe("Printouts availability loader (#1583)", () => {
  it("answers true and false from what it reads", async () => {
    dependencies.getTeamSettings.mockResolvedValue({});
    dependencies.moduleState.mockResolvedValue({ effective: new Set(["honors"]) });
    expect(await loadPrintoutAvailability("evt_1")).toEqual({ usesTeams: true, honorsOn: true });
    dependencies.getTeamSettings.mockResolvedValue(null);
    dependencies.moduleState.mockResolvedValue({ effective: new Set() });
    expect(await loadPrintoutAvailability("evt_1")).toEqual({ usesTeams: false, honorsOn: false });
  });

  it("answers unknown, and logs, when a read rejects", async () => {
    dependencies.getTeamSettings.mockRejectedValue(new Error("down"));
    dependencies.moduleState.mockRejectedValue(new Error("down"));
    expect(await loadPrintoutAvailability("evt_1")).toEqual({ usesTeams: null, honorsOn: null });
    expect(dependencies.logError).toHaveBeenCalledTimes(2);
  });
});
