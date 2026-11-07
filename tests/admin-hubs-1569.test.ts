import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AdminHub } from "@/components/admin-hub";
import { areaTabs, staffPlaceFor, tabIsOwned, type StaffAreaViewer } from "@/components/staff-areas";
import { adminHubs, systemSubpageTitle } from "@/components/system-navigation";
import {
  buildHubView,
  canOpenHub,
  cardRowSizes,
  neededMetrics,
  splitGroup,
  type AdminHubKey,
  type HubViewer,
  type MetricKey,
  type MetricValues,
} from "@/modules/system-admin/admin-hubs-model";

vi.mock("next/navigation", () => ({ usePathname: () => "/admin/hubs/events", useRouter: () => ({ push: vi.fn() }) }));

const hubs: AdminHubKey[] = ["events", "clubs", "people", "forms", "catalogs"];
const system: HubViewer = { isSystemAdmin: true, clubsAdmin: true, siteContentEditor: false };
const clubsAdmin: HubViewer = { isSystemAdmin: false, clubsAdmin: true, siteContentEditor: false };
const editor: HubViewer = { isSystemAdmin: false, clubsAdmin: false, siteContentEditor: true };
const nobody: HubViewer = { isSystemAdmin: false, clubsAdmin: false, siteContentEditor: false };

/** Every metric the hub needs, set to one value, so a test can change one at a time. */
function allMetrics(hub: AdminHubKey, viewer: HubViewer, value: number | null): MetricValues {
  return Object.fromEntries(neededMetrics(hub, viewer).map((key) => [key, value]));
}

const cardsOf = (hub: AdminHubKey, viewer: HubViewer, values: MetricValues) => buildHubView(hub, viewer, values).groups.flatMap((group) => group.cards);

describe("Admin hub model (#1569)", () => {
  it("builds the five hubs with a title, intro, one action and card groups for a system administrator", () => {
    for (const hub of hubs) {
      const view = buildHubView(hub, system, allMetrics(hub, system, 2));
      expect(view.title, hub).toBe(adminHubs[hub].title);
      expect(view.description.length, hub).toBeGreaterThan(10);
      expect(view.action, hub).not.toBeNull();
      expect(view.groups.length, hub).toBeGreaterThan(0);
    }
    expect(buildHubView("events", system, allMetrics("events", system, 1)).action).toEqual({ href: "/event-setup", label: "Create an event" });
    expect(buildHubView("clubs", system, allMetrics("clubs", system, 1)).action?.href).toBe("/admin/clubs/applications");
    expect(buildHubView("forms", system, allMetrics("forms", system, 1)).action?.href).toBe("/admin/forms");
    expect(buildHubView("catalogs", system, allMetrics("catalogs", system, 1)).action?.href).toBe("/admin/readiness");
  });

  it("shows the real destination titles and descriptions from the registry", () => {
    const cards = cardsOf("clubs", system, allMetrics("clubs", system, 1));
    expect(cards.map((card) => card.title)).toEqual(["Clubs and churches", "Club summary", "Club leaders", "Monthly Records", "New club applications", "Club member transfers"]);
    expect(cardsOf("events", system, allMetrics("events", system, 1)).map((card) => card.title)).toContain("Event module requests");
  });

  it("shows empty states as real zeros with their own words, never as unavailable", () => {
    const view = buildHubView("clubs", system, allMetrics("clubs", system, 0));
    expect(view.stats.map((stat) => stat.display)).toEqual(["0", "0", "0", "0"]);
    const statuses = Object.fromEntries(view.groups.flatMap((group) => group.cards).map((card) => [card.title, card.status?.text]));
    expect(statuses["New club applications"]).toBe("None waiting");
    expect(statuses["Club summary"]).toBe("None late");
    expect(statuses["Club member transfers"]).toBe("None open");
    expect(buildHubView("catalogs", system, allMetrics("catalogs", system, 0)).groups.flatMap((group) => group.cards).find((card) => card.title === "System readiness")?.status).toEqual({ tone: "ok", text: "All ready" });
  });

  it("keeps the unit with each count, singular and plural, and keeps distinct counts distinct", () => {
    const one = buildHubView("clubs", system, allMetrics("clubs", system, 1));
    expect(one.stats.map((stat) => stat.label)).toEqual(["Active club", "Application waiting", "Late Monthly Record", "Open member transfer"]);
    const many = buildHubView("clubs", system, { clubs: 42, applicationsWaiting: 4, lateRecords: 3, openTransfers: 1, clubLeaders: 168 });
    expect(many.stats.map((stat) => [stat.display, stat.label])).toEqual([["42", "Active clubs"], ["4", "Applications waiting"], ["3", "Late Monthly Records"], ["1", "Open member transfer"]]);
    const texts = many.groups.flatMap((group) => group.cards).map((card) => card.status?.text);
    expect(texts).toEqual(["42 active clubs", "3 late", "168 current leaders", "3 late", "4 waiting", "1 open"]);
    expect(new Set(many.stats.map((stat) => stat.key)).size).toBe(many.stats.length);
  });

  it("shows a failed read as Unavailable on that number and card only, and the rest keep their data", () => {
    const values: MetricValues = { ...allMetrics("clubs", system, 3), applicationsWaiting: null };
    const view = buildHubView("clubs", system, values);
    const stat = (key: MetricKey) => view.stats.find((entry) => entry.key === key)!;
    expect(stat("applicationsWaiting")).toMatchObject({ value: null, display: "Unavailable" });
    expect(stat("clubs")).toMatchObject({ value: 3, display: "3" });
    const cards = view.groups.flatMap((group) => group.cards);
    expect(cards.find((card) => card.title === "New club applications")?.status).toEqual({ tone: "draft", text: "Unavailable" });
    expect(cards.find((card) => card.title === "Club leaders")?.status?.text).toBe("3 current leaders");
  });

  it("never turns an unread or unreadable value into a healthy zero or All ready", () => {
    for (const hub of hubs) {
      for (const value of [null, undefined]) {
        const values = value === null ? allMetrics(hub, system, null) : {};
        const view = buildHubView(hub, system, values);
        for (const stat of view.stats) expect(stat, `${hub}/${stat.key}`).toMatchObject({ value: null, display: "Unavailable" });
        for (const card of view.groups.flatMap((group) => group.cards)) {
          if (card.status) expect(card.status, `${hub}/${card.title}`).toEqual({ tone: "draft", text: "Unavailable" });
        }
      }
    }
    // Readiness: one unreadable half is enough to stop "All ready".
    const partial = cardsOf("catalogs", system, { ...allMetrics("catalogs", system, 0), readinessToConfirm: null }).find((card) => card.title === "System readiness");
    expect(partial?.status?.text).toBe("Unavailable");
    expect(cardsOf("catalogs", system, { ...allMetrics("catalogs", system, 0), readinessToConfirm: 2 }).find((card) => card.title === "System readiness")?.status).toEqual({ tone: "soon", text: "2 to confirm" });
  });

  it("uses status words, not colour alone", () => {
    for (const hub of hubs) {
      for (const value of [0, 1, 5]) {
        for (const card of cardsOf(hub, system, allMetrics(hub, system, value))) if (card.status) expect(card.status.text).toMatch(/[A-Za-z]{3}/);
      }
    }
  });

  it("shows each restricted role only the cards it can open, and reads only their data", () => {
    // A Clubs Administrator: the club forms and the catalogs clubs choose from, nothing system-only.
    expect(canOpenHub("forms", clubsAdmin)).toBe(true);
    expect(cardsOf("forms", clubsAdmin, allMetrics("forms", clubsAdmin, 1)).map((card) => card.href)).toEqual(["/admin/club-forms", "/admin/club-forms/public-page"]);
    expect(neededMetrics("forms", clubsAdmin)).toEqual(["clubFormsOn"]);
    const catalogs = cardsOf("catalogs", clubsAdmin, allMetrics("catalogs", clubsAdmin, 1)).map((card) => card.href);
    expect(catalogs).toEqual(["/admin/honors", "/admin/club-supplies", "/admin/organizations/background-checks"]);
    expect(neededMetrics("catalogs", clubsAdmin)).toEqual(["honors"]);
    expect(buildHubView("forms", clubsAdmin, { clubFormsOn: 2 }).action?.href).toBe("/admin/club-forms");
    // A site content editor: one card, no numbers.
    const editorView = buildHubView("catalogs", editor, {});
    expect(editorView.groups.flatMap((group) => group.cards).map((card) => card.href)).toEqual(["/admin/site-content"]);
    expect(editorView.stats).toEqual([]);
    expect(neededMetrics("catalogs", editor)).toEqual([]);
    expect(editorView.action?.href).toBe("/admin/site-content");
    // Nobody else, and the system-only hubs, can open anything.
    for (const hub of hubs) expect(canOpenHub(hub, nobody), hub).toBe(false);
    for (const hub of ["events", "clubs", "people"] as const) {
      expect(canOpenHub(hub, clubsAdmin), hub).toBe(false);
      expect(canOpenHub(hub, editor), hub).toBe(false);
      expect(canOpenHub(hub, system), hub).toBe(true);
    }
    expect(canOpenHub("forms", editor)).toBe(false);
  });

  it("asks only for the numbers a shown card or number needs", () => {
    const needed = new Set(neededMetrics("catalogs", system));
    expect(needed.has("readinessAttention")).toBe(true);
    expect(neededMetrics("people", system).sort()).toEqual(["invitesWaiting", "staffLogins"]);
    // Health records: no break-glass or legal-hold number is read.
    expect(JSON.stringify(neededMetrics("people", system))).not.toMatch(/glass|hold/i);
  });

  it("has an access gate that matches each Admin tab", () => {
    const viewers: Record<string, HubViewer> = { system, clubsAdmin, editor, nobody };
    for (const [name, hubViewer] of Object.entries(viewers)) {
      const staffViewer: StaffAreaViewer = {
        isSystemAdmin: hubViewer.isSystemAdmin,
        held: [...(hubViewer.clubsAdmin ? (["CLUBS_ADMIN"] as const) : [])],
        activeRole: null,
        hasEvents: false,
        siteContentEditor: hubViewer.siteContentEditor,
        healthImport: true,
        clubYear: null,
        counts: {},
      };
      const tabKeys = new Set(areaTabs("admin", staffViewer).map((tab) => tab.key));
      for (const hub of hubs) expect(tabKeys.has(`hub-${hub}`), `${name}/${hub}`).toBe(canOpenHub(hub, hubViewer));
    }
  });

  it("offers links only: a card and the action are anchors, with no form, button or write", () => {
    for (const hub of hubs) {
      const html = renderToStaticMarkup(createElement(AdminHub, { view: buildHubView(hub, system, allMetrics(hub, system, 1)) }));
      expect(html, hub).not.toMatch(/<form|<button|method="post"/i);
      expect((html.match(/<a /g) ?? []).length, hub).toBeGreaterThanOrEqual(3);
    }
  });

  it("renders a long name without a fixed width, and Unavailable in words", () => {
    const view = buildHubView("clubs", system, allMetrics("clubs", system, null));
    view.groups[0]!.cards[0]!.title = "A".repeat(200);
    const html = renderToStaticMarkup(createElement(AdminHub, { view }));
    expect(html).toContain("A".repeat(200));
    expect(html).toContain("Unavailable");
    expect(html).toContain("could not be read just now");
    const css = readFileSync(path.join(process.cwd(), "components/admin-hub.module.css"), "utf8");
    expect(css).toContain("overflow-wrap: anywhere");
    expect(html).toMatch(/class="status-chip (green|coral|purple|gold|neutral)/);
    expect(css).not.toMatch(/overflow-x:\s*(auto|scroll)/);
    expect(css).not.toMatch(/white-space:\s*nowrap/);
  });
});

describe("Admin hub card layout (#1569)", () => {
  it("fills every row: 1, 2, 3 and 4 across, 5 as 3 + 2 and 6 as 3 + 3", () => {
    expect(cardRowSizes(1)).toEqual([1]);
    expect(cardRowSizes(2)).toEqual([2]);
    expect(cardRowSizes(3)).toEqual([3]);
    expect(cardRowSizes(4)).toEqual([4]);
    expect(cardRowSizes(5)).toEqual([3, 2]);
    expect(cardRowSizes(6)).toEqual([3, 3]);
    for (let size = 1; size <= 12; size += 1) {
      const rows = cardRowSizes(size);
      expect(rows.reduce((sum, row) => sum + row, 0)).toBe(size);
      expect(rows.every((row) => row >= 2) || size === 1).toBe(true);
    }
  });

  it("splits a group of more than six cards in two, and leaves six or fewer whole", () => {
    const cards = (n: number) => Array.from({ length: n }, (_, index) => index);
    expect(splitGroup({ title: "G", cards: cards(6) })).toHaveLength(1);
    const split = splitGroup({ title: "G", cards: cards(7) });
    expect(split.map((group) => group.cards.length)).toEqual([4, 3]);
    expect(splitGroup({ title: "G", cards: cards(12) }).map((group) => group.cards.length)).toEqual([6, 6]);
    for (const hub of hubs) {
      for (const group of buildHubView(hub, system, {}).groups) expect(group.cards.length).toBeLessThanOrEqual(6);
    }
  });

  it("fits the stats to their count with the shared metric grid, so no row has a lone card", () => {
    const css = readFileSync(path.join(process.cwd(), "components/admin-hub.module.css"), "utf8");
    const html = renderToStaticMarkup(createElement(AdminHub, { view: buildHubView("clubs", system, allMetrics("clubs", system, 1)) }));
    expect(html).toContain('class="metric-grid ');
    expect(html).toContain('data-count="4"');
    expect(html).toContain("metric-card");
    expect(css).not.toContain("auto-fit");
    expect(css).toMatch(/ul\.stats\[data-count="4"\]\s*\{\s*grid-template-columns:\s*repeat\(4/);
    expect(css).toMatch(/@media \(max-width: 1024px\)\s*\{\s*ul\.stats\[data-count="4"\]\s*\{\s*grid-template-columns:\s*repeat\(2/);
    expect(css).toMatch(/@media \(max-width: 600px\)\s*\{\s*ul\.stats\[data-count\]\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
    for (const count of [1, 2, 3]) expect(css).toContain(`ul.stats[data-count="${count}"]`);
    // Chip colours come from the shared .status-chip, not a copy.
    expect(css).not.toMatch(/data-tone/);
  });

  it("never says all ready, or zero needing attention, while a readiness check could not be read", () => {
    const base = allMetrics("catalogs", system, 0);
    const card = (values: MetricValues) => cardsOf("catalogs", system, values).find((entry) => entry.title === "System readiness")?.status;
    expect(card({ ...base, readinessUnknown: 2 })).toEqual({ tone: "soon", text: "2 could not be read" });
    expect(card({ ...base, readinessUnknown: null })).toEqual({ tone: "draft", text: "Unavailable" });
    expect(card({ ...base, readinessUnknown: 0 })).toEqual({ tone: "ok", text: "All ready" });
    const stat = (values: MetricValues) => buildHubView("catalogs", system, values).stats.find((entry) => entry.key === "readinessAttention")!;
    expect(stat({ ...base, readinessUnknown: 1 })).toMatchObject({ display: "0", note: "1 check could not be read" });
    expect(stat({ ...base, readinessUnknown: null }).note).toBe("Some checks could not be read");
    expect(stat(base).note).toBeNull();
    expect(neededMetrics("catalogs", system)).toContain("readinessUnknown");
  });

  it("styles the grids by count, four become two by two on an iPad, and one per row on a phone", () => {
    const css = readFileSync(path.join(process.cwd(), "components/admin-hub.module.css"), "utf8");
    expect(css).toMatch(/\.cards\[data-count="4"\]\s*\{\s*grid-template-columns:\s*repeat\(4/);
    expect(css).toMatch(/@media \(max-width: 1024px\)\s*\{\s*\.cards\[data-count="4"\]\s*\{\s*grid-template-columns:\s*repeat\(2/);
    expect(css).toMatch(/@media \(max-width: 600px\)[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);
    expect(css).toMatch(/data-count="5"\]\s*>\s*li:nth-child\(n \+ 4\)\s*\{\s*grid-column:\s*span 3/);
    // The staff text floor and tap target rules.
    expect(css).toContain("max(var(--type-staff-floor, 0px), 0.875rem)");
    expect(css).toContain("--touch-target");
    expect(css).not.toMatch(/\.sr-only|visually-?hidden/i);
  });
});

describe("Admin hub routes and tabs (#1569)", () => {
  it("opens each Admin tab on its hub, and marks that tab as the current place", () => {
    const viewer: StaffAreaViewer = { isSystemAdmin: true, held: ["CLUBS_ADMIN", "SYSTEM_ADMIN"], activeRole: "SYSTEM_ADMIN", hasEvents: true, siteContentEditor: false, healthImport: true, clubYear: null, counts: {} };
    const tabs = areaTabs("admin", viewer);
    for (const hub of hubs) {
      const tab = tabs.find((candidate) => candidate.key === `hub-${hub}`)!;
      expect(tab.href).toBe(adminHubs[hub].href);
      expect(tab.views).toEqual([]);
      expect(tabIsOwned("admin", tab)).toBe(true);
      expect(staffPlaceFor(adminHubs[hub].href)).toMatchObject({ area: "admin", tab: `hub-${hub}`, inEvent: false });
      expect(systemSubpageTitle(adminHubs[hub].href)).toBe(adminHubs[hub].title);
    }
  });

  it("has a page for every hub that checks the viewer, and the topbar title matches the page title", () => {
    for (const hub of hubs) {
      const source = readFileSync(path.join(process.cwd(), `app/(workspace)/admin/hubs/${hub}/page.tsx`), "utf8");
      expect(source).toContain(`hub="${hub}"`);
      expect(source).toContain(`title: "${adminHubs[hub].title}"`);
    }
    const shared = readFileSync(path.join(process.cwd(), "app/(workspace)/admin/hubs/hub-page.tsx"), "utf8");
    expect(shared).toContain("staffLoginRedirectPath");
    expect(shared).toContain('redirect("/no-access")');
    expect(shared).toContain("canOpenHub(hub, viewer)");
  });
});
