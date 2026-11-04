import { beforeEach, describe, expect, it, vi } from "vitest";

/** #1562: staff settings for the public Club forms page. Synthetic data only. */
const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  rejectCrossOriginRequest: vi.fn(),
  isActiveClubsAdministrator: vi.fn(),
  getState: vi.fn(),
  save: vi.fn(),
  discard: vi.fn(),
  publish: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/admin-roles", () => ({ isActiveClubsAdministrator: mocks.isActiveClubsAdministrator }));
vi.mock("@/modules/club-forms/public-index-settings", () => ({
  getPublicClubFormsAdminState: mocks.getState,
  savePublicClubFormsDraft: mocks.save,
  discardPublicClubFormsDraft: mocks.discard,
  publishPublicClubFormsDraft: mocks.publish,
}));
vi.mock("@/modules/club-rosters/api-errors", () => ({
  RosterBodyError: class RosterBodyError extends Error { readonly code = "INVALID_JSON_BODY"; },
  readRosterJson: async (request: Request) => request.json(),
}));

import { DELETE, GET, PUT } from "@/app/api/admin/club-forms/public-page/route";
import { POST as PUBLISH } from "@/app/api/admin/club-forms/public-page/publish/route";
import { publicClubFormGroups, publicClubFormView } from "@/modules/club-forms/public-index-domain";
import {
  applyPublicClubFormsSettings,
  changedPublicClubFormsKeys,
  completePublicClubFormsSettings,
  defaultPublicClubFormsIntro,
  defaultPublicClubFormsSettings,
  parsePublicClubFormsSettings,
  publicClubFormsIntro,
  type PublicClubFormsSettings,
} from "@/modules/club-forms/public-index-settings-domain";

const allIds = publicClubFormGroups.flatMap((group) => group.items.map((item) => item.id));
const settingsWith = (patch: (settings: PublicClubFormsSettings) => void) => {
  const settings = defaultPublicClubFormsSettings();
  patch(settings);
  return settings;
};
const idsOf = (groups: ReturnType<typeof applyPublicClubFormsSettings>) => groups.flatMap((group) => group.items.map((item) => item.id));

describe("overlaying settings on the fixed list (#1562)", () => {
  it("with nothing stored or the defaults stored, the page is exactly today's", () => {
    expect(applyPublicClubFormsSettings(null)).toEqual(publicClubFormGroups);
    expect(applyPublicClubFormsSettings(defaultPublicClubFormsSettings())).toEqual(publicClubFormGroups);
    expect(publicClubFormsIntro(null)).toBe(defaultPublicClubFormsIntro);
  });

  it("does not list a hidden form", () => {
    const groups = applyPublicClubFormsSettings(settingsWith((s) => { s.items.find((i) => i.id === "photo-release")!.shown = false; }));
    expect(idsOf(groups)).not.toContain("photo-release");
    expect(idsOf(groups)).toHaveLength(allIds.length - 1);
  });

  it("moves a form to another group and follows the stored order", () => {
    const groups = applyPublicClubFormsSettings(settingsWith((s) => {
      const moved = s.items.find((i) => i.id === "year-end-report")!;
      moved.groupId = "beginning";
      s.items.reverse();
    }));
    const beginning = groups.find((g) => g.id === "beginning")!;
    expect(beginning.items.map((i) => i.id)).toContain("year-end-report");
    // The list was reversed, so the form moved last in the stored order comes first.
    expect(beginning.items.findIndex((i) => i.id === "year-end-report")).toBeLessThan(beginning.items.findIndex((i) => i.id === "new-club"));
    expect(groups.find((g) => g.id === "end")!.items.map((i) => i.id)).not.toContain("year-end-report");
    expect(idsOf(groups)).toHaveLength(allIds.length);
  });

  it("shows the stored description in place of the built-in line", () => {
    const groups = applyPublicClubFormsSettings(settingsWith((s) => { s.items[0].description = "A short synthetic line."; }));
    expect(groups[0].items[0].who).toBe("A short synthetic line.");
  });

  it("ignores unknown ids and repeated ids, and shows a built-in form the settings never mention", () => {
    const stored: PublicClubFormsSettings = {
      intro: "Hello",
      items: [
        { id: "no-such-form", shown: true, groupId: "ongoing", description: "Ghost" },
        { id: "permission-slip", shown: true, groupId: "ongoing", description: "First" },
        { id: "permission-slip", shown: false, groupId: "end", description: "Repeat" },
      ],
    };
    const groups = applyPublicClubFormsSettings(stored);
    expect(idsOf(groups)).not.toContain("no-such-form");
    expect(idsOf(groups).filter((id) => id === "permission-slip")).toHaveLength(1);
    expect(idsOf(groups)).toHaveLength(allIds.length);
    expect(completePublicClubFormsSettings(stored).items).toHaveLength(allIds.length);
    expect(publicClubFormsIntro(stored)).toBe("Hello");
  });

  it("never adds a link: closed, private and off forms keep exactly today's views whatever the settings say", () => {
    const groups = applyPublicClubFormsSettings(settingsWith((s) => { s.items.forEach((i) => { i.groupId = "ongoing"; }); s.items.reverse(); }));
    const items = groups.flatMap((g) => g.items);
    const fixed = publicClubFormGroups.flatMap((g) => g.items);
    const open = new Map([["club_tlt_application", "OPEN_APPLICATION" as const]]);
    const enabled = new Set(fixed.flatMap((i) => (i.templateKey ? [i.templateKey] : [])));
    for (const item of items) {
      const original = fixed.find((candidate) => candidate.id === item.id)!;
      const { who: shownWho, ...rest } = item;
      const { who: originalWho, ...originalRest } = original;
      expect(shownWho).toBeTruthy();
      expect(originalWho).toBeTruthy();
      expect(rest).toEqual(originalRest);
      const withSettings = publicClubFormView(item, enabled, open, new Set(["club_tlt_application"]));
      const withoutSettings = publicClubFormView(original, enabled, open, new Set(["club_tlt_application"]));
      expect({ href: withSettings.href, note: withSettings.note }).toEqual({ href: withoutSettings.href, note: withoutSettings.note });
    }
    const off = publicClubFormView(items.find((i) => i.id === "can-collecting")!, new Set(), new Map());
    expect(off.href).toBeNull();
    expect(publicClubFormView(items.find((i) => i.id === "permission-slip")!, enabled, new Map()).href).toBeNull();
  });

  it("rejects settings that do not fit the rules", () => {
    expect(parsePublicClubFormsSettings(defaultPublicClubFormsSettings())).not.toBeNull();
    expect(parsePublicClubFormsSettings(settingsWith((s) => { s.items[0].groupId = "nowhere"; }))).toBeNull();
    expect(parsePublicClubFormsSettings(settingsWith((s) => { s.items[0].description = "  "; }))).toBeNull();
    expect(parsePublicClubFormsSettings(settingsWith((s) => { s.intro = ""; }))).toBeNull();
    expect(parsePublicClubFormsSettings(settingsWith((s) => { s.intro = "x".repeat(601); }))).toBeNull();
  });

  it("names what changed by form id and field only", () => {
    const after = settingsWith((s) => { s.intro = "New"; s.items[1].shown = false; s.items[2].description = "Other"; });
    expect(changedPublicClubFormsKeys(null, after)).toEqual(["intro", `${after.items[1].id}:shown`, `${after.items[2].id}:description`]);
  });
});

describe("the public page settings routes are for system administrators and Clubs Administrators only (#1562)", () => {
  const json = (method: string, body: unknown = {}) =>
    new Request("https://events.imsda.test/api/admin/club-forms/public-page", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const calls: Array<{ name: string; call: () => Promise<Response>; service: () => ReturnType<typeof vi.fn> }> = [
    { name: "read", call: () => GET(new Request("https://events.imsda.test/api/admin/club-forms/public-page")), service: () => mocks.getState },
    { name: "save draft", call: () => PUT(json("PUT", defaultPublicClubFormsSettings())), service: () => mocks.save },
    { name: "discard draft", call: () => DELETE(json("DELETE")), service: () => mocks.discard },
    { name: "publish", call: () => PUBLISH(json("POST")), service: () => mocks.publish },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rejectCrossOriginRequest.mockReturnValue(null);
    mocks.isActiveClubsAdministrator.mockResolvedValue(false);
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "admin-1", globalRole: "SYSTEM_ADMIN" } });
    mocks.getState.mockResolvedValue({});
    mocks.save.mockResolvedValue({ draftUpdatedAt: "2026-11-03T15:00:00.000Z" });
    mocks.discard.mockResolvedValue(undefined);
    mocks.publish.mockResolvedValue({ publishedAt: "2026-11-03T15:00:00.000Z" });
  });

  for (const route of calls) {
    it(`${route.name}: a system administrator may`, async () => {
      expect((await route.call()).status).toBe(200);
      expect(route.service()).toHaveBeenCalledTimes(1);
    });
    it(`${route.name}: an active Clubs Administrator may`, async () => {
      mocks.getCurrentSession.mockResolvedValue({ user: { id: "user-2", globalRole: "USER" } });
      mocks.isActiveClubsAdministrator.mockResolvedValue(true);
      expect((await route.call()).status).toBe(200);
    });
    it(`${route.name}: refuses anyone else`, async () => {
      mocks.getCurrentSession.mockResolvedValue({ user: { id: "user-3", globalRole: "USER" } });
      expect((await route.call()).status).toBe(403);
      expect(route.service()).not.toHaveBeenCalled();
    });
    it(`${route.name}: refuses a visitor who is not signed in`, async () => {
      mocks.getCurrentSession.mockResolvedValue({ user: null });
      expect([401, 403]).toContain((await route.call()).status);
      expect(route.service()).not.toHaveBeenCalled();
    });
  }

  for (const route of calls.filter((call) => call.name !== "read")) {
    it(`${route.name}: refuses a cross-origin request before doing anything`, async () => {
      mocks.rejectCrossOriginRequest.mockReturnValue(Response.json({ error: "CROSS_ORIGIN" }, { status: 403 }));
      expect((await route.call()).status).toBe(403);
      expect(route.service()).not.toHaveBeenCalled();
    });
  }
});

describe("the audit diff compares order within a group (#1562)", () => {
  it("flags only the forms that moved, not every form after them", () => {
    const after = settingsWith((s) => {
      const [first] = s.items.splice(0, 1);
      s.items.push({ ...first, groupId: "ongoing" });
    });
    expect(changedPublicClubFormsKeys(null, after)).toEqual(["new-club:group"]);
    const swapped = settingsWith((s) => { [s.items[0], s.items[1]] = [s.items[1], s.items[0]]; });
    expect(changedPublicClubFormsKeys(null, swapped).sort()).toEqual(["new-club:order", "yearly-registration:order"]);
  });
});
