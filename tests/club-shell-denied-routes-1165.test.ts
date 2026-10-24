import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A hidden menu item is not authorization (#1165): a direct request to a page
 * the role's menu does not list is still refused by the page itself, before it
 * loads anything. Synthetic ids only.
 */

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  loaders: {
    listRoster: vi.fn(),
    listEnabledClubFormTemplates: vi.fn(),
    listRosterChoices: vi.fn(),
    listSubmissionsForViewer: vi.fn(),
    listClubFormLinks: vi.fn(),
    getClubProfile: vi.fn(),
    listClubTeam: vi.fn(),
    listPendingClubTeamInvites: vi.fn(),
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/modules/club-rosters/access", () => ({ getRosterAccessStateForPage: mocks.access }));
vi.mock("@/modules/club-rosters/repository", () => ({ listRoster: mocks.loaders.listRoster }));
vi.mock("@/modules/club-forms/templates", () => ({ listEnabledClubFormTemplates: mocks.loaders.listEnabledClubFormTemplates }));
vi.mock("@/modules/club-forms/submissions", () => ({ listRosterChoices: mocks.loaders.listRosterChoices, listSubmissionsForViewer: mocks.loaders.listSubmissionsForViewer }));
vi.mock("@/modules/club-forms/links", () => ({ listClubFormLinks: mocks.loaders.listClubFormLinks }));
vi.mock("@/modules/organizations/club-profile-repository", () => ({ getClubProfile: mocks.loaders.getClubProfile, listSponsorOptions: vi.fn() }));
vi.mock("@/modules/organizations/director-grants-repository", () => ({ listClubTeam: mocks.loaders.listClubTeam }));
vi.mock("@/modules/club-imports/invites", () => ({ listPendingClubTeamInvites: mocks.loaders.listPendingClubTeamInvites }));

import ClubFormsPage from "@/app/(public)/account/(portal)/clubs/[organizationId]/forms/page";
import ClubInfoPage from "@/app/(public)/account/(portal)/clubs/[organizationId]/club-info/page";
import ClubRosterPage from "@/app/(public)/account/(portal)/clubs/[organizationId]/roster/page";
import { clubCapabilities } from "@/modules/organizations/director-grants-domain";

const club = (role: "REGISTRAR" | "REPORTER") => ({ organizationId: "club-1", name: "Sample Pathfinders", role, sponsoringChurch: null });
const params = Promise.resolve({ organizationId: "club-1" });
const search = Promise.resolve({});
const noneLoaded = () => { for (const loader of Object.values(mocks.loaders)) expect(loader).not.toHaveBeenCalled(); };

beforeEach(() => vi.clearAllMocks());

describe("direct requests to routes outside a role's menu (#1165)", () => {
  it("answers a registrar's request for /forms with the leaders-only notice and loads no form data", async () => {
    mocks.access.mockResolvedValue({ state: "OPEN", club: club("REGISTRAR"), capabilities: clubCapabilities("REGISTRAR"), actor: { kind: "ATTENDEE", accountId: "a1", sessionId: "s1" } });
    const tree = await ClubFormsPage({ params, searchParams: search });
    expect(JSON.stringify(tree)).toContain("kept by the club");
    noneLoaded();
  });

  it("answers a registrar's request for /club-info with the leaders-only notice and loads no settings or team", async () => {
    mocks.access.mockResolvedValue({ state: "OPEN", club: club("REGISTRAR"), capabilities: clubCapabilities("REGISTRAR"), actor: { kind: "ATTENDEE", accountId: "a1", sessionId: "s1" } });
    const tree = await ClubInfoPage({ params });
    expect(JSON.stringify(tree)).toContain("Only the club");
    noneLoaded();
  });

  it("renders nothing for a reporter's request for /roster and loads no roster", async () => {
    // The real capability rule is what turns a reporter into NO_ROSTER (modules/club-rosters/access.ts).
    expect(clubCapabilities("REPORTER").roster).toBe(false);
    mocks.access.mockResolvedValue({ state: "NO_ROSTER", club: club("REPORTER"), capabilities: clubCapabilities("REPORTER") });
    expect(await ClubRosterPage({ params, searchParams: search })).toBeNull();
    noneLoaded();
  });
});
