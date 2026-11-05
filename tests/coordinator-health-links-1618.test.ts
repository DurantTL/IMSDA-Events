import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveAreaHealthViewer: vi.fn(),
  listHealthEvents: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/coordinator-health/access", () => ({ resolveAreaHealthViewer: mocks.resolveAreaHealthViewer }));
vi.mock("@/modules/coordinator-health/repository", () => ({ listHealthEvents: mocks.listHealthEvents }));

import { areaHealthLinkEventIds } from "@/modules/coordinator-health/event-links";
import { AreaClubEvents } from "@/components/area-clubs-views";
import { CoordinatorClubEvents } from "@/components/coordinator-destinations";
import { accountPortalNavItems } from "@/components/account-portal-nav";
import { isAccountNavItemActive } from "@/components/account-nav-model";
import { coordinatorNavItems } from "@/components/area-clubs-subnav";
import type { AreaClubEvent } from "@/modules/club-reports/area-summary-repository";

const events: AreaClubEvent[] = [
  { id: "event-1", name: "Synthetic Camporee", startsAt: "2026-11-06T12:00:00Z", timezone: "America/Chicago", clubs: [{ organizationId: "c1", name: "Alpha Club", status: "REGISTERED", headcount: 12 }] },
  { id: "event-2", name: "Synthetic Camp Meeting", startsAt: "2026-09-01T12:00:00Z", timezone: "America/Chicago", clubs: [{ organizationId: "c1", name: "Alpha Club", status: "REGISTERED", headcount: 4 }] },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-06T15:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("which events get a Health information link (#1618)", () => {
  it("lists the events the health page lists, for an active coordinator with a verified second step", async () => {
    mocks.resolveAreaHealthViewer.mockResolvedValue({ kind: "AREA_COORDINATOR", accountId: "acct-1" });
    mocks.listHealthEvents.mockResolvedValue([{ id: "event-1" }]);
    expect(await areaHealthLinkEventIds()).toEqual(["event-1"]);
    expect(mocks.listHealthEvents).toHaveBeenCalledWith({ kind: "AREA_COORDINATOR", accountId: "acct-1" });
  });

  it("gives nothing, and reads nothing, to anyone the health page would refuse (not a coordinator, no second step, staff acting as one)", async () => {
    mocks.resolveAreaHealthViewer.mockResolvedValue(null);
    expect(await areaHealthLinkEventIds()).toEqual([]);
    expect(mocks.listHealthEvents).not.toHaveBeenCalled();
  });

  it("gives nothing for an event outside its window, because the page's own list leaves it out", async () => {
    mocks.resolveAreaHealthViewer.mockResolvedValue({ kind: "AREA_COORDINATOR", accountId: "acct-1" });
    mocks.listHealthEvents.mockResolvedValue([]);
    expect(await areaHealthLinkEventIds()).toEqual([]);
  });

  it("hides the links instead of failing the page when the read fails", async () => {
    mocks.resolveAreaHealthViewer.mockResolvedValue({ kind: "AREA_COORDINATOR", accountId: "acct-1" });
    mocks.listHealthEvents.mockRejectedValue(new Error("db down"));
    expect(await areaHealthLinkEventIds()).toEqual([]);
  });
});

describe("the Health information link next to Kitchen report (#1618)", () => {
  const coordinator = (healthEventIds?: string[]) => renderToStaticMarkup(createElement(CoordinatorClubEvents, { clearHref: "/x", events, query: "", healthEventIds }));
  const staff = (healthEventIds?: string[]) => renderToStaticMarkup(createElement(AreaClubEvents, { clubHref: (id: string) => `/c/${id}`, events, healthEventIds }));

  for (const [name, render] of [["Club coordination", coordinator], ["the staff club summary", staff]] as const) {
    it(`${name}: links only the eligible event, to its health sheet`, () => {
      const html = render(["event-1"]);
      expect(html).toContain('href="/account/area/health?event=event-1"');
      expect(html).not.toContain("event=event-2");
      expect(html.match(/Health information/g)).toHaveLength(1);
      expect(html).toContain('href="/account/area-clubs/kitchen/event-1"');
      expect(html).toContain('href="/account/area-clubs/kitchen/event-2"');
    });

    it(`${name}: shows no link when no event is eligible or the list was not given`, () => {
      expect(render([])).not.toContain("Health information");
      expect(render()).not.toContain("Health information");
    });
  }

  it("names the event for a screen reader", () => {
    expect(coordinator(["event-1"])).toContain('Health information<span class="sr-only">: Synthetic Camporee</span>');
  });
});

describe("the health page keeps Club coordination lit (#1618)", () => {
  it("lights Club coordination in the menu and only Overview in the tabs", () => {
    const menu = accountPortalNavItems({ hasAccount: true, directedClubCount: 0, areaCoordinator: true, actingRole: null });
    const item = menu.find((entry) => entry.label === "Club coordination")!;
    expect(isAccountNavItemActive("/account/area/health", item)).toBe(true);
    expect(item.alsoMatchPrefix).toContain("/account/area/health");
    const lit = coordinatorNavItems().filter((tab) => isAccountNavItemActive("/account/area/health", tab));
    expect(lit.map((tab) => tab.label)).toEqual(["Overview"]);
  });
});
