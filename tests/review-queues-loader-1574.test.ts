import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const logError = vi.fn();
vi.mock("@/lib/logger", () => ({ logError: (...args: unknown[]) => logError(...args) }));

const countGuardianReviewItems = vi.fn();
vi.mock("@/modules/guardian-authority/repository", () => ({ countGuardianReviewItems: (...args: unknown[]) => countGuardianReviewItems(...args) }));
const listDirectoryReviewEntries = vi.fn();
vi.mock("@/modules/forms/directory-review", () => ({ listDirectoryReviewEntries: (...args: unknown[]) => listDirectoryReviewEntries(...args) }));
const countPendingTeams = vi.fn();
vi.mock("@/modules/general-link-registrations/repository", () => ({ countPendingTeams: (...args: unknown[]) => countPendingTeams(...args) }));
const listApprovals = vi.fn();
vi.mock("@/modules/staff-invitations/repository", () => ({ listApprovals: (...args: unknown[]) => listApprovals(...args) }));

const { loadReviewQueueMetrics } = await import("@/modules/review-queues/review-queues-repository");

const manager = { permissions: ["MANAGE_REGISTRATION" as const, "VIEW_SENSITIVE_DATA" as const], audience: "GENERAL" as const };

beforeEach(() => {
  logError.mockClear();
  countGuardianReviewItems.mockReset().mockResolvedValue(2);
  listDirectoryReviewEntries.mockReset().mockResolvedValue([{}, {}, {}]);
  countPendingTeams.mockReset().mockResolvedValue(4);
  listApprovals.mockReset().mockResolvedValue({ rows: [], counts: { WAITING: 5, APPROVED: 9, DECLINED: 1 } });
});

describe("Review queues loaders (#1574)", () => {
  it("reads each number for the one event, with the count the page itself shows", async () => {
    const values = await loadReviewQueueMetrics(manager, "evt_1");
    expect(values).toEqual({ responsibleAdults: 2, directoryEntries: 3, pendingTeams: 4, approvalsWaiting: 5 });
    for (const read of [countGuardianReviewItems, listDirectoryReviewEntries, countPendingTeams, listApprovals]) expect(read).toHaveBeenCalledWith("evt_1");
  });

  it("makes a failed read unavailable for its own number only, and logs it", async () => {
    countPendingTeams.mockRejectedValue(new Error("down"));
    countGuardianReviewItems.mockRejectedValue(new Error("down"));
    const values = await loadReviewQueueMetrics(manager, "evt_1");
    expect(values).toEqual({ responsibleAdults: null, directoryEntries: 3, pendingTeams: null, approvalsWaiting: 5 });
    expect(logError).toHaveBeenCalledTimes(2);
  });

  it("reads only what the viewer's cards need", async () => {
    expect(await loadReviewQueueMetrics({ permissions: ["VIEW_SENSITIVE_DATA"], audience: "GENERAL" }, "evt_1")).toEqual({ responsibleAdults: 2 });
    expect(countPendingTeams).not.toHaveBeenCalled();
    expect(listApprovals).not.toHaveBeenCalled();
    expect(listDirectoryReviewEntries).not.toHaveBeenCalled();
  });

  it("does not read the approvals of a club event, and reads nothing for a viewer with no card", async () => {
    await loadReviewQueueMetrics({ ...manager, audience: "CLUB" }, "evt_1");
    expect(listApprovals).not.toHaveBeenCalled();
    expect(await loadReviewQueueMetrics({ permissions: ["VIEW_EVENT"], audience: "GENERAL" }, "evt_1")).toEqual({});
    expect(countGuardianReviewItems).toHaveBeenCalledTimes(1);
  });
});
