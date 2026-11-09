import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resolveClubOversight: vi.fn(), listClubAssignments: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/club-rosters/event-oversight", () => ({ resolveClubOversight: mocks.resolveClubOversight }));
vi.mock("@/modules/club-registrations/assignments-repository", () => ({ listClubAssignments: mocks.listClubAssignments }));
vi.mock("@/components/club-assignments-workspace", () => ({ ClubAssignmentsWorkspace: () => null }));
vi.mock("@/components/event-clubs-views-strip", () => ({ EventClubsViewsStrip: () => null }));
vi.mock("@/components/access-restricted", () => ({ AccessRestricted: () => null }));
vi.mock("@/components/not-available-for-event", () => ({ NotAvailableForEvent: () => null }));

import ClubAssignmentsPage from "@/app/(workspace)/more/club-assignments/page";
import { AccessRestricted } from "@/components/access-restricted";
import { ClubAssignmentsWorkspace } from "@/components/club-assignments-workspace";
import { NotAvailableForEvent } from "@/components/not-available-for-event";

type El = { type?: unknown; props?: { children?: unknown } };
function types(node: unknown): unknown[] {
  const el = node as El;
  const kids = el?.props?.children;
  const list = Array.isArray(kids) ? kids : kids === undefined ? [] : [kids];
  return [el?.type, ...list.flatMap(types)];
}
const context = (permissions: string[], clubEvent: boolean) => ({ event: { id: "e1", name: "Sample Camporee" }, permissions, allowed: clubEvent, clubEvent });
const run = () => ClubAssignmentsPage({ searchParams: Promise.resolve({ event: "e1" }) });

describe("/more/club-assignments states (#1582)", () => {
  beforeEach(() => { mocks.resolveClubOversight.mockReset(); mocks.listClubAssignments.mockReset().mockResolvedValue([]); });

  it("shows access restricted, before the club-event check, without registration management", async () => {
    mocks.resolveClubOversight.mockResolvedValue(context([], false));
    const found = types(await run());
    expect(found).toContain(AccessRestricted);
    expect(found).not.toContain(NotAvailableForEvent);
    expect(mocks.listClubAssignments).not.toHaveBeenCalled();
  });

  it("shows not available for a manager on a non-club event", async () => {
    mocks.resolveClubOversight.mockResolvedValue(context(["MANAGE_REGISTRATION"], false));
    const found = types(await run());
    expect(found).toContain(NotAvailableForEvent);
    expect(found).not.toContain(AccessRestricted);
    expect(mocks.listClubAssignments).not.toHaveBeenCalled();
  });

  it("shows the workspace for a manager on a club event", async () => {
    mocks.resolveClubOversight.mockResolvedValue(context(["MANAGE_REGISTRATION"], true));
    expect(types(await run())).toContain(ClubAssignmentsWorkspace);
  });
});
