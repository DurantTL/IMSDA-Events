import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/more/lodging", useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

import { LodgingViewsStrip } from "@/components/lodging-views-strip";
import { lodgingNightsLine, lodgingViewAccess, lodgingViews } from "@/modules/lodging/lodging-views-model";

const read = (path: string) => readFileSync(path, "utf8");
const labels = (views: ReturnType<typeof lodgingViews>) => views.map((view) => view.label);

describe("lodgingViews (#1578)", () => {
  it("gives an event administrator who manages registrations all three pages, in order, with ?event", () => {
    const views = lodgingViews("ev 1", { inventory: true, registrations: true }, "requests");
    expect(labels(views)).toEqual(["Inventory", "Requests", "Assignments"]);
    expect(views.map((view) => view.href)).toEqual([
      "/more/lodging?event=ev%201",
      "/more/lodging/requests?event=ev%201",
      "/more/lodging/assignments?event=ev%201",
    ]);
    expect(views.filter((view) => view.current).map((view) => view.key)).toEqual(["requests"]);
  });

  it("leaves out a page the viewer cannot open instead of linking a closed page (#1735)", () => {
    expect(labels(lodgingViews("e", { inventory: false, registrations: true }))).toEqual(["Requests", "Assignments"]);
    expect(labels(lodgingViews("e", { inventory: true, registrations: false }))).toEqual(["Inventory"]);
    expect(lodgingViews("e", { inventory: false, registrations: false })).toEqual([]);
  });

  it("marks no page current without one, and works the access out from event permissions", () => {
    expect(lodgingViews("e", { inventory: true, registrations: true }).some((view) => view.current)).toBe(false);
    expect(lodgingViewAccess(["MANAGE_REGISTRATION"])).toEqual({ inventory: false, registrations: true });
    expect(lodgingViewAccess(["CONFIGURE_EVENT"])).toEqual({ inventory: true, registrations: false });
  });

  it("renders the strip with its label and the current page, and nothing for one page", () => {
    const markup = renderToStaticMarkup(createElement(LodgingViewsStrip, { eventId: "e1", access: { inventory: true, registrations: true }, current: "inventory" }));
    expect(markup).toContain('aria-label="Lodging pages"');
    expect(markup).toContain('href="/more/lodging/assignments?event=e1"');
    expect(markup).toContain('aria-current="page"');
    expect(renderToStaticMarkup(createElement(LodgingViewsStrip, { eventId: "e1", access: { inventory: true, registrations: false }, current: "inventory" }))).toBe("");
  });
});

describe("lodgingNightsLine (#1578)", () => {
  it("names the window and the count, for many nights, one night and none", () => {
    expect(lodgingNightsLine(["2027-06-15", "2027-06-16", "2027-06-17"])).toBe("Jun 15 to Jun 17, 3 nights");
    expect(lodgingNightsLine(["2027-06-15"])).toBe("Jun 15, 1 night");
    expect(lodgingNightsLine([])).toBe("no bookable nights");
  });
});

describe("page wiring (#1578)", () => {
  it("puts the strip on every state of all three pages, and the ad-hoc back links are gone", () => {
    const inventory = read("app/(workspace)/more/lodging/page.tsx");
    const requests = read("app/(workspace)/more/lodging/requests/page.tsx");
    const assignments = read("app/(workspace)/more/lodging/assignments/page.tsx");
    expect(inventory.match(/\{strip\}/g)?.length).toBe(2);
    expect(requests.match(/\{strip\}/g)?.length).toBe(3);
    expect(assignments.match(/\{strip\}/g)?.length).toBe(3);
    expect(inventory).toContain('current="inventory"');
    expect(requests).toContain('current="requests"');
    expect(assignments).toContain('current="assignments"');
    for (const source of [requests, assignments]) {
      expect(source).not.toContain("Back to lodging");
      expect(source).not.toContain("BackLink");
    }
  });

  it("draws each header on the shared pattern with no old intro block", () => {
    for (const file of ["components/lodging-workspace.tsx", "components/lodging-requests-workspace.tsx", "components/lodging-assignments-workspace.tsx"]) {
      const source = read(file);
      expect(source, file).toContain("<StaffPageHeader");
      expect(source, file).not.toContain("page-intro");
      expect(source, file).not.toContain("duplicate-page-title");
    }
  });
});
