import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  viewer: vi.fn(),
  read: vi.fn(),
  record: vi.fn(),
  secondStep: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
vi.mock("@/components/leader-directory", () => ({ LeaderDirectory: () => null }));
vi.mock("@/components/account-page-banner", () => ({ AccountPageBanner: () => null }));
vi.mock("@/modules/attendee-accounts/portal-second-step", () => ({ requireAttendeeSecondStep: mocks.secondStep }));
vi.mock("@/modules/leader-directory/access", () => ({ currentLeaderDirectoryViewer: mocks.viewer }));
vi.mock("@/modules/leader-directory/repository", () => ({ readLeaderDirectory: mocks.read, recordLeaderDirectoryView: mocks.record }));

import LeaderDirectoryPage from "@/app/(public)/account/(portal)/leader-directory/page";
import { accountPortalNavItems } from "@/components/account-portal-nav";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue({ entries: [], total: 0 });
});

describe("the leader directory page (#1707)", () => {
  it("answers not found without reading anyone when the viewer does not qualify", async () => {
    mocks.viewer.mockResolvedValue(null);
    await expect(LeaderDirectoryPage({ searchParams: Promise.resolve({ q: "casey" }) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("reads and audits one view for a qualifying viewer", async () => {
    mocks.viewer.mockResolvedValue({ accountId: "acct-1" });
    await expect(LeaderDirectoryPage({ searchParams: Promise.resolve({ q: "casey", role: "DEPUTY" }) })).resolves.toBeTruthy();
    expect(mocks.read).toHaveBeenCalledWith({ q: "casey", role: "DEPUTY" });
    expect(mocks.record).toHaveBeenCalledTimes(1);
  });
});

describe("the account menu link (#1707)", () => {
  const base = { hasAccount: true, directedClubCount: 1, areaCoordinator: false, actingRole: null } as const;
  it("shows the link only when the directory is open to the account", () => {
    expect(accountPortalNavItems({ ...base, leaderDirectory: true }).map((item) => item.href)).toContain("/account/leader-directory");
    expect(accountPortalNavItems({ ...base, leaderDirectory: false }).map((item) => item.href)).not.toContain("/account/leader-directory");
    expect(accountPortalNavItems(base).map((item) => item.href)).not.toContain("/account/leader-directory");
  });
  it("never shows it during a staff act-as", () => {
    expect(accountPortalNavItems({ ...base, actingRole: "CLUB_DIRECTOR", leaderDirectory: true }).map((item) => item.href)).not.toContain("/account/leader-directory");
  });
});
