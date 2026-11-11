import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { clubsAdminGroups, clubsAdminHomeItem } from "@/components/staff-navigation";
import { staffPlaceFor } from "@/components/staff-areas";
import {
  buildHubView,
  canOpenHub,
  mergeLoneCards,
  neededMetrics,
  type HubViewer,
  type MetricValues,
} from "@/modules/system-admin/admin-hubs-model";

const system: HubViewer = { isSystemAdmin: true, clubsAdmin: true, siteContentEditor: false, healthImport: true };
const clubsAdmin: HubViewer = { isSystemAdmin: false, clubsAdmin: true, siteContentEditor: false, healthImport: true };
const clubsAdminNoHealth: HubViewer = { ...clubsAdmin, healthImport: false };
const nobody: HubViewer = { isSystemAdmin: false, clubsAdmin: false, siteContentEditor: false };

const all = (viewer: HubViewer, value: number | null): MetricValues => Object.fromEntries(neededMetrics("club-administration", viewer).map((key) => [key, value]));
const view = (viewer: HubViewer, value: number | null = 2) => buildHubView("club-administration", viewer, all(viewer, value));
const titles = (viewer: HubViewer) => view(viewer).groups.map((group) => [group.title, group.cards.map((card) => card.title)]);

describe("Club administration uses the hub pattern (#1568)", () => {
  it("groups every destination as the approved mockup does, with the registries' titles", () => {
    expect(titles(system)).toEqual([
      ["Clubs", ["Club summary", "Clubs and churches", "New club applications", "Club member transfers", "Sterling Volunteers"]],
      ["Records and points", ["Monthly Records", "Club Year-End Reports", "Points"]],
      ["Club events and forms", ["Club events", "Club forms", "Public club forms page"]],
      ["People", ["Club leaders", "People & access"]],
      ["Catalogs and imports", ["Honor catalog", "Club supply catalog", "Conference club orders", "Import clubs", "Import health records"]],
    ]);
    // Titles the Clubs registry names come from it, not from a second copy.
    const registry = new Map([clubsAdminHomeItem, ...clubsAdminGroups.flatMap((group) => group.items)].map((item) => [item.href, item.label]));
    for (const card of view(system).groups.flatMap((group) => group.cards)) {
      if (registry.has(card.href)) expect(card.title, card.href).toBe(registry.get(card.href));
    }
  });

  it("makes Review applications the one main action and adds no numbers of its own", () => {
    const result = view(system);
    expect(result.action).toEqual({ href: "/admin/clubs/applications", label: "Review applications", primary: true });
    expect(result.stats).toEqual([]);
    expect(result.title).toBe("Club administration");
  });

  it("links only to pages that exist", () => {
    for (const card of view(system).groups.flatMap((group) => group.cards)) {
      const file = path.join("app/(workspace)", `${card.href.split(/[?#]/)[0]}/page.tsx`);
      expect(existsSync(file), card.href).toBe(true);
    }
  });

  it("drops what a Clubs Administrator cannot open, and Import health records while the feature is off", () => {
    expect(titles(clubsAdmin)[0]).toEqual(["Clubs", ["Club summary", "New club applications", "Club member transfers", "Sterling Volunteers"]]);
    const hrefs = (viewer: HubViewer) => view(viewer).groups.flatMap((group) => group.cards.map((card) => card.href));
    expect(hrefs(clubsAdmin)).not.toContain("/admin/organizations");
    expect(hrefs(clubsAdmin)).toContain("/admin/clubs/health-import");
    expect(hrefs(clubsAdminNoHealth)).not.toContain("/admin/clubs/health-import");
    expect(hrefs({ ...system, healthImport: undefined })).not.toContain("/admin/clubs/health-import");
    expect(titles(clubsAdminNoHealth).at(-1)).toEqual(["Catalogs and imports", ["Honor catalog", "Club supply catalog", "Conference club orders", "Import clubs"]]);
  });

  it("never leaves a lone card in a group, whatever the gates remove", () => {
    for (const viewer of [system, clubsAdmin, clubsAdminNoHealth]) {
      for (const group of view(viewer).groups) expect(group.cards.length, `${group.title}`).toBeGreaterThanOrEqual(2);
    }
    expect(mergeLoneCards([{ title: "A", cards: [1] }, { title: "B", cards: [2, 3] }])).toEqual([{ title: "B", cards: [1, 2, 3] }]);
    expect(mergeLoneCards([{ title: "A", cards: [1, 2] }, { title: "B", cards: [3] }, { title: "C", cards: [4, 5, 6] }])).toEqual([{ title: "A", cards: [1, 2, 3] }, { title: "C", cards: [4, 5, 6] }]);
    expect(mergeLoneCards([{ title: "Only", cards: [1] }])).toEqual([{ title: "Only", cards: [1] }]);
  });

  it("shows each card's status in words, and Unavailable for a number that could not be read", () => {
    const statuses = (value: number | null) => Object.fromEntries(view(system, value).groups.flatMap((group) => group.cards).map((card) => [card.title, card.status?.text ?? null]));
    expect(statuses(2)).toMatchObject({ "Club summary": "2 late", "Monthly Records": "2 late", "New club applications": "2 waiting", "Club member transfers": "2 open", "Club leaders": "2 current leaders · 2 invites waiting", "Honor catalog": "2 honors" });
    const unreadable = statuses(null);
    for (const title of ["Club summary", "Clubs and churches", "Monthly Records", "New club applications", "Club member transfers", "Club leaders", "Club forms", "Honor catalog"]) {
      expect(unreadable[title], title).toBe("Unavailable");
    }
    // A number that was never asked for is never read as zero or "None".
    expect(Object.values(buildHubView("club-administration", system, {}).groups.flatMap((group) => group.cards.map((card) => card.status?.text ?? "Unavailable")))).not.toContain("None late");
  });

  it("reads only the numbers its shown cards need", () => {
    expect(neededMetrics("club-administration", clubsAdmin).sort()).toEqual(["applicationsWaiting", "clubFormsOn", "clubInvitesWaiting", "clubLeaders", "honors", "lateRecords", "openTransfers"]);
    expect(neededMetrics("club-administration", system)).toContain("clubs");
    expect(neededMetrics("club-administration", nobody)).toEqual([]);
  });

  it("opens for system administrators and Clubs Administrators only", () => {
    expect(canOpenHub("club-administration", system)).toBe(true);
    expect(canOpenHub("club-administration", clubsAdmin)).toBe(true);
    expect(canOpenHub("club-administration", nobody)).toBe(false);
  });

  it("keeps the Clubs tab's Club administration overview lit and the page's own sections", () => {
    expect(staffPlaceFor("/admin/clubs")).toEqual({ area: "clubs", tab: "club-administration", view: "/admin/clubs", inEvent: false });
    const source = readFileSync("app/(workspace)/admin/clubs/page.tsx", "utf8");
    for (const id of ['id="new-clubs"', 'id="registered-clubs"', 'id="club-events"', 'id="quick-actions"', "ClubApplicationApprove", 'data-testid="clubs-admin-cards"']) expect(source, id).toContain(id);
    expect(source).toContain('<AdminHub view={hubViewForYear} />');
  });
});
