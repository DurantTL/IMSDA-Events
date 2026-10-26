import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1221: the public Club forms page and the sign-in-aware club chooser behind its director links. Synthetic data only.
 */
const mocks = vi.hoisted(() => ({
  listEnabled: vi.fn(),
  getCurrentAttendee: vi.fn(),
  currentStaffActingContext: vi.fn(),
  attendeeSecondStepPending: vi.fn(),
  listDirectedClubs: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); },
  notFound: mocks.notFound,
}));
vi.mock("@/components/public-header-session-links", () => ({ PublicHeaderSessionLinks: () => null }));
vi.mock("@/modules/club-forms/public-index", () => ({ listEnabledPublicClubFormKeys: mocks.listEnabled }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee }));
vi.mock("@/modules/attendee-accounts/portal-second-step", () => ({ attendeeSecondStepPending: mocks.attendeeSecondStepPending }));
vi.mock("@/modules/attendee-accounts/return-redirect", () => ({
  attendeeSignInRedirectPath: async () => "/account/sign-in?next=%2Faccount%2Fclubs%2Fchoose",
  twoStepRedirectPath: async () => "/account/two-step",
}));
vi.mock("@/modules/organizations/staff-act-as", () => ({ currentStaffActingContext: mocks.currentStaffActingContext }));
vi.mock("@/modules/organizations/director-access", () => ({ listDirectedClubs: mocks.listDirectedClubs }));

import ChooseClubPage from "@/app/(public)/account/(portal)/clubs/choose/page";
import PublicClubFormsPage from "@/app/(public)/clubs/forms/page";
import { clubFormTemplateSeeds } from "@/modules/club-forms/definitions";
import {
  clubChooseDestination,
  clubChooseTargets,
  isClubChooseKey,
  NOT_AVAILABLE_LINE,
  PRIVATE_LINK_LINE,
  publicClubFormGroups,
  publicClubFormTemplateKeys,
  publicClubFormView,
} from "@/modules/club-forms/public-index-domain";

const allKeys = new Set(publicClubFormTemplateKeys);
const items = publicClubFormGroups.flatMap((group) => group.items);
const item = (id: string) => items.find((candidate) => candidate.id === id)!;

async function renderIndex(enabled: string[]) {
  mocks.listEnabled.mockResolvedValue(new Set(enabled));
  return renderToStaticMarkup(await PublicClubFormsPage());
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentAttendee.mockResolvedValue({ account: { id: "acct-1" } });
  mocks.currentStaffActingContext.mockResolvedValue(null);
  mocks.attendeeSecondStepPending.mockResolvedValue(false);
  mocks.listDirectedClubs.mockResolvedValue([]);
});

describe("the Club forms list's content (#1221)", () => {
  it("has the three groups and every item from the issue, in order", () => {
    expect(publicClubFormGroups.map((group) => [group.title, group.items.map((entry) => entry.name)])).toEqual([
      ["Beginning of year", ["New Club Application", "Yearly Club Registration", "Club Member Application", "Health Record", "TLT Application", "TLT Recommendation", "Staff Registration"]],
      ["End of year", ["Pathfinder of the Year", "TLT of the Year", "Year End Report"]],
      ["Ongoing", ["Permission Slip", "Transportation List", "Can Collecting Report", "Monthly Report", "Conference Patch & Pin Order", "Photo and Video Release"]],
    ]);
    for (const entry of items) expect(entry.who.length, entry.name).toBeGreaterThan(10);
  });

  it("names only club form templates that exist as seeds", () => {
    const seeds = new Set(clubFormTemplateSeeds.map((seed) => seed.key));
    for (const key of publicClubFormTemplateKeys) expect(seeds.has(key), key).toBe(true);
  });

  it("links New Club Application to the public registration, whatever the switches say", () => {
    expect(publicClubFormView(item("new-club"), new Set())).toMatchObject({ href: "/clubs/register", note: null });
  });

  it("sends director items through the chooser with an allowlisted key", () => {
    expect(publicClubFormView(item("yearly-registration"), allKeys).href).toBe("/account/clubs/choose?to=roster-next-year");
    expect(publicClubFormView(item("can-collecting"), allKeys).href).toBe("/account/clubs/choose?to=can-collecting-report");
    expect(publicClubFormView(item("patch-pin-order"), allKeys).href).toBe("/account/clubs/choose?to=orders");
    for (const entry of items) {
      const view = publicClubFormView(entry, allKeys);
      if (view.href?.startsWith("/account/clubs/choose")) expect(isClubChooseKey(new URL(view.href, "http://x").searchParams.get("to")), entry.name).toBe(true);
    }
  });

  it("says a private-link form is sent by the director, with no link, and a health record has no link or fields", () => {
    for (const id of ["tlt-application", "tlt-recommendation", "permission-slip", "photo-release", "member-application", "staff-registration"]) {
      expect(publicClubFormView(item(id), allKeys), id).toMatchObject({ href: null, note: PRIVATE_LINK_LINE });
    }
    expect(PRIVATE_LINK_LINE).toBe("Your club director sends this form by link.");
    expect(publicClubFormView(item("health-record"), allKeys)).toMatchObject({ href: null, note: null });
    expect(publicClubFormView(item("health-record"), allKeys).who).toMatch(/club director/i);
  });

  it("says Not available yet, with no link, for a form that is turned off", () => {
    for (const id of ["pathfinder-of-the-year", "can-collecting", "transportation-list", "tlt-recommendation", "photo-release"]) {
      expect(publicClubFormView(item(id), new Set()), id).toMatchObject({ href: null, note: NOT_AVAILABLE_LINE });
    }
    // Items with no club form behind them are never "not available".
    for (const id of ["yearly-registration", "year-end-report", "monthly-report", "patch-pin-order"]) {
      expect(publicClubFormView(item(id), new Set()).note, id).toBeNull();
      expect(publicClubFormView(item(id), new Set()).href, id).not.toBeNull();
    }
  });
});

describe("the Club forms page (#1221)", () => {
  it("lists every form and links only what is available", async () => {
    const html = await renderIndex(publicClubFormTemplateKeys as string[]);
    for (const entry of items) expect(html, entry.name).toContain(entry.name.replace("&", "&amp;"));
    expect(html).toContain('href="/clubs/register"');
    expect(html).toContain('href="/account/clubs/choose?to=pathfinder-of-the-year"');
    expect(html).toContain(PRIVATE_LINK_LINE);
    expect(html).not.toContain(NOT_AVAILABLE_LINE);
    expect(html).toContain("<h1>Club forms</h1>");
  });

  it("shows Not available yet and drops the link when a form is off", async () => {
    const html = await renderIndex(publicClubFormTemplateKeys.filter((key) => key !== "can_collecting_report"));
    expect(html).toContain(NOT_AVAILABLE_LINE);
    expect(html).not.toContain("to=can-collecting-report");
    expect(html).toContain("to=transportation-list");
  });

  it("reads the on/off state through the narrow query only", async () => {
    await renderIndex([]);
    expect(mocks.listEnabled).toHaveBeenCalledTimes(1);
    expect(mocks.listEnabled).toHaveBeenCalledWith();
  });
});

describe("the club chooser (#1221)", () => {
  const render = (to?: string | string[]) => ChooseClubPage({ searchParams: Promise.resolve({ to }) });
  const club = (id: string, name: string) => ({ organizationId: id, name, role: "DIRECTOR", sponsoringChurch: null });

  it("only knows its allowlist: a path, a URL or an unknown key is a 404, never a redirect", async () => {
    for (const to of [undefined, "", "unknown", "//evil.example", "https://evil.example", "../../admin", "/account/clubs/x/roster", "constructor", "__proto__", "toString"]) {
      await expect(render(to), String(to)).rejects.toThrow("NOT_FOUND");
    }
    expect(mocks.getCurrentAttendee).not.toHaveBeenCalled();
    expect(isClubChooseKey("constructor")).toBe(false);
    expect(clubChooseDestination("club-1", "constructor")).toBeNull();
  });

  it("uses the first value when the key is repeated", async () => {
    mocks.listDirectedClubs.mockResolvedValue([club("club-1", "Example Pathfinders")]);
    await expect(render(["orders", "records"])).rejects.toThrow("REDIRECT /account/clubs/club-1/orders");
  });

  it("sends a signed-out visitor to sign-in, with the way back to the chooser", async () => {
    mocks.getCurrentAttendee.mockResolvedValue({ account: null });
    await expect(render("orders")).rejects.toThrow("REDIRECT /account/sign-in?next=%2Faccount%2Fclubs%2Fchoose");
  });

  it("goes straight to the form for a person who directs exactly one club", async () => {
    mocks.listDirectedClubs.mockResolvedValue([club("club-1", "Example Pathfinders")]);
    await expect(render("can-collecting-report")).rejects.toThrow("REDIRECT /account/clubs/club-1/forms/can_collecting_report/new");
  });

  it("shows a picker with one link per club for a person who directs several", async () => {
    mocks.listDirectedClubs.mockResolvedValue([club("club-1", "Example Pathfinders"), club("club-2", "Sample Adventurers")]);
    const html = renderToStaticMarkup(await render("roster-next-year"));
    expect(html).toContain('href="/account/clubs/club-1/roster/next-year"');
    expect(html).toContain('href="/account/clubs/club-2/roster/next-year"');
    expect(html).toContain("Example Pathfinders");
  });

  it("says plainly that there is no club when the person directs none", async () => {
    const html = renderToStaticMarkup(await render("orders"));
    expect(html).toContain("aren&#x27;t a director of a club");
    expect(html).not.toContain("href=\"/account/clubs/");
  });

  it("sends staff acting as a club director to that club, and holds back a person who owes the second step", async () => {
    mocks.getCurrentAttendee.mockResolvedValue({ account: null });
    mocks.currentStaffActingContext.mockResolvedValue({ role: "CLUB_DIRECTOR", organizationId: "club-9" });
    await expect(render("orders")).rejects.toThrow("REDIRECT /account/clubs/club-9/orders");

    mocks.currentStaffActingContext.mockResolvedValue(null);
    mocks.getCurrentAttendee.mockResolvedValue({ account: { id: "acct-1" } });
    mocks.attendeeSecondStepPending.mockResolvedValue(true);
    await expect(render("orders")).rejects.toThrow("REDIRECT /account/two-step");
  });

  it("maps every allowlisted key to a club-relative path that stays inside the club's own pages", () => {
    for (const [key, path] of Object.entries(clubChooseTargets)) {
      expect(path, key).toMatch(/^[a-z0-9_/-]+$/);
      expect(clubChooseDestination("club-1", key)).toBe(`/account/clubs/club-1/${path}`);
    }
    expect(clubChooseDestination("a/../b?x=1", "orders")).toBe("/account/clubs/a%2F..%2Fb%3Fx%3D1/orders");
  });
});
