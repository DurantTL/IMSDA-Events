import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The two health pages' break-glass branch, and the form's posts (#1617). Synthetic data only. */

const mocks = vi.hoisted(() => ({
  viewer: { current: null as unknown },
  personId: vi.fn(),
  viewHealthRecord: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, redirect: vi.fn(), useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/modules/health-records/flag", () => ({ healthRecordsEnabled: () => true }));
vi.mock("@/modules/health-records/access", () => ({
  requireStaffHealthViewer: async () => mocks.viewer.current,
  requireHealthViewerForClub: async () => mocks.viewer.current,
}));
vi.mock("@/modules/health-records/repository", () => ({
  viewHealthRecord: mocks.viewHealthRecord,
  viewHealthEntryStatus: vi.fn(),
  listHealthRecordLinks: vi.fn(async () => []),
}));
vi.mock("@/modules/club-rosters/access", () => ({
  getRosterAccessStateForPage: async () => ({ state: "OPEN" }),
  RosterAccessError: class RosterAccessError extends Error {},
}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ clubRosterMember: { findFirst: async () => ({ personId: await mocks.personId() }) } }) }));
vi.mock("@/components/club-access-closed", () => ({ clubAccessClosed: () => null }));
vi.mock("@/components/role-setup-help", () => ({ ClubSetupHelp: () => null }));
vi.mock("@/components/back-link", () => ({ BackLink: ({ children }: { children: React.ReactNode }) => createElement("a", null, children) }));

import StaffHealthRecordPage from "@/app/(workspace)/more/health-records/[organizationId]/[memberId]/page";
import ClubMemberHealthPage from "@/app/(public)/account/(portal)/clubs/[organizationId]/roster/[memberId]/health/page";
import { BREAK_GLASS_REQUIRED_MESSAGE } from "@/modules/health-records/break-glass";
import { HealthRecordError } from "@/modules/health-records/errors";

const params = Promise.resolve({ organizationId: "club-1", memberId: "member-1" });
const FORM = "Reason for reading this record";

async function staffPage() {
  return renderToStaticMarkup(await StaffHealthRecordPage({ params, searchParams: Promise.resolve({}) }));
}
async function rosterPage() {
  return renderToStaticMarkup(await ClubMemberHealthPage({ params }));
}

beforeEach(() => {
  mocks.personId.mockReset().mockResolvedValue("person-1");
  mocks.viewHealthRecord.mockReset().mockRejectedValue(new HealthRecordError("BREAK_GLASS_REQUIRED", BREAK_GLASS_REQUIRED_MESSAGE));
});

type Case = [who: string, viewer: unknown, shown: boolean];
const suites: Array<[name: string, render: () => Promise<string>, cases: Case[]]> = [
  ["the staff health page", staffPage, [
    ["a system administrator", { kind: "SYSTEM_ADMIN", userId: "a1" }, true],
    ["a Clubs Administrator", { kind: "SYSTEM_ADMIN", userId: "c1", viaClubsAdministrator: true }, true],
    ["a health-role staff member", { kind: "HEALTH_ROLE", userId: "u1", eventIds: ["e1"] }, false],
  ]],
  ["the club roster health page", rosterPage, [
    ["a system administrator acting as director", { kind: "SYSTEM_ADMIN", userId: "a1", actAsId: "d1" }, true],
    ["a Clubs Administrator acting as director", { kind: "SYSTEM_ADMIN", userId: "c1", actAsId: "d1", viaClubsAdministrator: true }, true],
    ["a director", { kind: "CLUB_LEADER", organizationId: "club-1", accountId: "acc1" }, false],
  ]],
];

describe.each(suites)("%s", (_name, render, cases) => {
  it.each(cases)("%s: form shown is %s", async (_who, viewer, shown) => {
    mocks.viewer.current = viewer;
    const html = await render();
    expect(html).toContain(BREAK_GLASS_REQUIRED_MESSAGE);
    if (shown) {
      expect(html).toContain(FORM);
      expect(html).toContain("Start break-glass");
      expect(html).toContain("Break-glass access is required");
    } else {
      expect(html).not.toContain(FORM);
    }
  });

  it("shows no form when the member has no person id", async () => {
    mocks.viewer.current = cases[0][1];
    mocks.personId.mockResolvedValue(null);
    const html = await render();
    expect(html).toContain(BREAK_GLASS_REQUIRED_MESSAGE);
    expect(html).not.toContain(FORM);
  });
});
