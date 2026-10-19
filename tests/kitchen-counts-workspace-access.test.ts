import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  listEventsForUser: vi.fn(),
  findActiveMembership: vi.fn(),
  readLastUsedEventId: vi.fn(),
  resolveEventContext: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`REDIRECT:${path}`); }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: vi.fn(), useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/events/repository", () => ({ listEventsForUser: mocks.listEventsForUser, findActiveMembership: mocks.findActiveMembership, isClubAudienceEvent: vi.fn() }));
vi.mock("@/modules/events/last-used-event", () => ({ readLastUsedEventId: mocks.readLastUsedEventId }));

import { requirePermission } from "@/modules/access/authorization";
import { holdsKitchenCountsOnly, rolePermissions } from "@/modules/access/permissions";
import { mobileNavigationOrder, orderedMobileTabs, orderedSidebarItems, sidebarSections, staffSubpageTitle } from "@/components/staff-navigation";
import { resolveEventContext } from "@/modules/events/selection";

const staff = { id: "usr_kitchen", email: "kitchen@imsda-events.test", displayName: "Synthetic Kitchen", globalRole: null };
const event = (id: string) => ({
  id, slug: id, name: `Event ${id}`, startsAt: new Date("2027-04-09T00:00:00Z"), endsAt: new Date("2027-04-11T00:00:00Z"), timezone: "America/Chicago",
  location: null, capacity: null, isPublished: true, archivedAt: null,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-28T12:00:00.000Z"));
  vi.clearAllMocks();
  mocks.getCurrentSession.mockResolvedValue({ user: staff });
  mocks.readLastUsedEventId.mockResolvedValue(null);
  // Kitchen staff on event A only.
  mocks.listEventsForUser.mockResolvedValue([event("evtA")]);
  mocks.findActiveMembership.mockImplementation(async (_user: string, eventId: string) =>
    eventId === "evtA" ? { eventId, userId: staff.id, role: "KITCHEN_STAFF", status: "ACTIVE", permissions: [] } : null);
});

describe("kitchen staff in the event workspace (#1029)", () => {
  it("is sent to the counts page from any workspace page, including the dashboard they land on after signing in", async () => {
    await expect(resolveEventContext("evtA")).rejects.toThrow("REDIRECT:/more/kitchen-report/counts?event=evtA");
    // No event named: the one event they have is chosen, and the redirect still carries it.
    await expect(resolveEventContext(undefined)).rejects.toThrow("REDIRECT:/more/kitchen-report/counts?event=evtA");
  });

  it("opens the counts page itself, and other roles are not redirected", async () => {
    const kitchen = await resolveEventContext("evtA", { allowKitchenCountsOnly: true });
    expect(kitchen.permissions).toEqual(["MANAGE_KITCHEN_COUNTS"]);
    mocks.findActiveMembership.mockResolvedValue({ eventId: "evtA", userId: staff.id, role: "READ_ONLY_STAFF", status: "ACTIVE", permissions: [] });
    await expect(resolveEventContext("evtA")).resolves.toMatchObject({ permissions: ["VIEW_EVENT"] });
    mocks.findActiveMembership.mockResolvedValue({ eventId: "evtA", userId: staff.id, role: "KITCHEN_STAFF", status: "ACTIVE", permissions: ["VIEW_REPORTS"] });
    await expect(resolveEventContext("evtA")).resolves.toMatchObject({ permissions: ["MANAGE_KITCHEN_COUNTS", "VIEW_REPORTS"] });
  });

  it("refuses kitchen staff of event A on event B, in the workspace and on the save and CSV routes' permission check", async () => {
    // The workspace never substitutes another event: B is not theirs, so the picker opens.
    await expect(resolveEventContext("evtB", { allowKitchenCountsOnly: true })).rejects.toThrow("REDIRECT:/select-event?unavailable=1");
    const session = { user: staff };
    await expect(requirePermission(session, "evtB", "MANAGE_KITCHEN_COUNTS", mocks.findActiveMembership)).rejects.toMatchObject({ status: 403, code: "EVENT_ACCESS_DENIED" });
    await expect(requirePermission(session, "evtA", "MANAGE_KITCHEN_COUNTS", mocks.findActiveMembership)).resolves.toBeTruthy();
    await expect(requirePermission(session, "evtA", "VIEW_EVENT", mocks.findActiveMembership)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(requirePermission(session, "evtA", "VIEW_REPORTS", mocks.findActiveMembership)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("holds the kitchen counts permission alone, by the one definition the redirect uses", () => {
    expect(holdsKitchenCountsOnly(rolePermissions.KITCHEN_STAFF)).toBe(true);
    expect(holdsKitchenCountsOnly([])).toBe(false);
    for (const role of ["EVENT_ADMIN", "READ_ONLY_STAFF", "CHECK_IN_STAFF"] as const) expect(holdsKitchenCountsOnly(rolePermissions[role])).toBe(false);
  });
});

describe("pages that would show event data without the event view permission", () => {
  const kitchenOnly = { event: { id: "evtA", name: "Synthetic Camp", slug: "syn", timezone: "America/Chicago" }, permissions: ["MANAGE_KITCHEN_COUNTS"], user: staff, events: [] };
  const search = { searchParams: Promise.resolve({ event: "evtA" }) };
  const pages = [
    ["/overview", () => import("@/app/(workspace)/overview/page")],
    ["/communications", () => import("@/app/(workspace)/communications/page")],
    ["/more", () => import("@/app/(workspace)/more/page")],
    ["/more/features", () => import("@/app/(workspace)/more/features/page")],
  ] as const;

  for (const [path, load] of pages) {
    it(`${path} is restricted for a viewer without VIEW_EVENT and reads nothing`, async () => {
      vi.resetModules();
      vi.doMock("@/modules/events/selection", () => ({ resolveEventContext: async () => kitchenOnly }));
      const { renderToStaticMarkup } = await import("react-dom/server");
      const page = (await load()).default as (props: typeof search) => Promise<React.ReactElement>;
      const html = renderToStaticMarkup(await page(search));
      expect(html).toContain("restricted");
      expect(html).not.toContain("Synthetic Camp");
      vi.doUnmock("@/modules/events/selection");
    });
  }
});

describe("navigation for kitchen staff", () => {
  const kitchen = new Set(["MANAGE_KITCHEN_COUNTS"] as const);
  const counts = "/more/kitchen-report/counts";

  it("shows kitchen staff only the Kitchen counts item, as a sidebar item and a phone tab", () => {
    const items = orderedSidebarItems(kitchen, false);
    expect(items.map((item) => item.href)).toEqual([counts]);
    expect(orderedMobileTabs(items).map((item) => item.href)).toEqual([counts]);
    expect(sidebarSections(kitchen).flatMap((view) => view.items.map((item) => item.label))).toEqual(["Kitchen counts"]);
    expect((mobileNavigationOrder as readonly string[]).includes(counts)).toBe(true);
    expect(staffSubpageTitle(counts)).toBe("Kitchen counts");
  });

  it("does not add the item (or lose the dashboard) for anyone with the event view", () => {
    for (const role of ["EVENT_ADMIN", "REGISTRATION_MANAGER", "READ_ONLY_STAFF"] as const) {
      const hrefs = orderedSidebarItems(new Set(rolePermissions[role]), true).map((item) => item.href);
      expect(hrefs).toContain("/overview");
      expect(hrefs).not.toContain(counts);
    }
  });
});
