import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccessRestricted } from "@/components/access-restricted";
import { NotAvailableForEvent } from "@/components/not-available-for-event";
import { glossaryTerms } from "@/modules/help/glossary";
import { routeHasPage } from "@/modules/help/guide-check";
import { listPageRoutes } from "@/modules/help/guide-check-files";
import { helpGuides } from "@/modules/help/guides";
import { findPortalGuide, portalDestinations, portalGuides, reservedPortalGuideIds } from "@/modules/help/portal-guides";
import {
  portalAudiences,
  portalGuideForViewer,
  portalGuideLinksForViewer,
  portalUnavailableText,
  visiblePortalGuides,
  type PortalHelpViewer,
} from "@/modules/help/portal-visibility";

/** Portal help (#1259). Synthetic ids only. */

const root = process.cwd();
const none: PortalHelpViewer = { hasAccount: true, directedClubs: [], isAreaCoordinator: false, acting: null };
const director = (...clubs: Array<[string, "DIRECTOR" | "DEPUTY" | "REGISTRAR" | "REPORTER"]>): PortalHelpViewer => ({
  ...none,
  directedClubs: clubs.map(([organizationId, role]) => ({ organizationId, role })),
});
const coordinator: PortalHelpViewer = { ...none, isAreaCoordinator: true };
const ids = (viewer: PortalHelpViewer) => visiblePortalGuides(viewer).map((guide) => guide.id);
const forAudience = (audience: string) => portalGuides.filter((guide) => guide.audience === audience).map((guide) => guide.id);

describe("portal guide registry", () => {
  it("has unique, URL-safe ids that do not collide with a route below /account/help", () => {
    const all = portalGuides.map((guide) => guide.id);
    expect(new Set(all).size).toBe(all.length);
    for (const id of all) {
      expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(reservedPortalGuideIds).not.toContain(id);
    }
    expect(reservedPortalGuideIds).toContain("authenticator");
  });

  it("covers the attendee, director and coordinator tasks, with the fields every guide needs", () => {
    expect(forAudience("attendee")).toEqual(["find-my-registration"]);
    expect(forAudience("director")).toEqual([
      "director-choose-club",
      "director-monthly-record",
      "director-year-end-report",
      "director-getting-started",
      "director-two-step-sign-in",
      "director-leaders-and-invites",
      "director-roster-and-forms",
      "director-register-for-events",
      "director-orders-and-supplies",
      "director-honors-and-sterling",
    ]);
    expect(forAudience("coordinator")).toEqual([
      "coordinator-find-club",
      "coordinator-follow-records",
      "coordinator-team-approvals",
      "coordinator-getting-started",
      "coordinator-follow-up-clubs",
      "coordinator-points",
    ]);
    for (const guide of portalGuides) {
      for (const list of [guide.needs, guide.changes, guide.steps, guide.verify, guide.keywords]) expect(list.length, guide.id).toBeGreaterThan(0);
      expect(guide.next.trim(), guide.id).not.toBe("");
      expect(guide.lastReviewed, guide.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(guide.owner, guide.id).toMatch(/office|team|administrator|staff/i);
    }
  });

  it("points every destination at an existing page and only at portal or public pages", () => {
    const routes = listPageRoutes();
    for (const destination of Object.values(portalDestinations)) {
      expect(routeHasPage(destination.path, routes), destination.path).toBe(true);
      expect(destination.path, destination.id).toMatch(/^\/(account|recover-registration)/);
    }
    for (const guide of portalGuides) {
      for (const id of guide.destinationIds) expect(portalDestinations[id], `${guide.id}:${id}`).toBeDefined();
    }
  });

  it("never tells the reader to ask for system administrator rights", () => {
    for (const guide of portalGuides) {
      const text = [...guide.needs, ...guide.steps, guide.next].join("\n");
      expect(text, guide.id).not.toMatch(/(request|ask|apply|become|get)[^.]*system admin/i);
    }
  });

  it("states the authority boundary where it matters", () => {
    const find = (id: string) => findPortalGuide(id)!.steps.join(" ");
    expect(find("find-my-registration")).toMatch(/verified email/i);
    expect(find("director-choose-club")).toMatch(/Registrar:.*ages/);
    expect(find("director-choose-club")).toMatch(/Reporter:.*can't: see the roster/i);
    expect(findPortalGuide("director-monthly-record")!.needs.join(" ")).toMatch(/registrar cannot/i);
    expect(find("coordinator-find-club")).toMatch(/view only/i);
    expect(find("coordinator-team-approvals")).toMatch(/cannot approve or decline/i);
  });
});

describe("portal guide visibility", () => {
  it("gives an ordinary attendee only the attendee guide", () => {
    expect(portalAudiences(none)).toEqual(["attendee"]);
    expect(ids(none)).toEqual(forAudience("attendee"));
  });

  it("adds the director guides only for someone who directs a club, and the coordinator guides only for a coordinator", () => {
    expect(ids(director(["org_a", "DIRECTOR"]))).toEqual([...forAudience("attendee"), ...forAudience("director")]);
    expect(ids(coordinator)).toEqual([...forAudience("attendee"), ...forAudience("coordinator")]);
    expect(ids({ ...coordinator, directedClubs: [{ organizationId: "org_a", role: "DEPUTY" }] })).toEqual(portalGuides.map((guide) => guide.id));
  });

  it("gives a staff act-as the guide for the acted role only, with no attendee guide when there is no account", () => {
    const actingDirector: PortalHelpViewer = { hasAccount: false, directedClubs: [], isAreaCoordinator: false, acting: { role: "CLUB_DIRECTOR", organizationId: "org_a" } };
    const actingCoordinator: PortalHelpViewer = { hasAccount: false, directedClubs: [], isAreaCoordinator: false, acting: { role: "AREA_COORDINATOR" } };
    expect(ids(actingDirector)).toEqual(forAudience("director"));
    expect(ids(actingCoordinator)).toEqual(forAudience("coordinator"));
  });

  it("gives no guide to a viewer with no account and no act-as", () => {
    expect(ids({ hasAccount: false, directedClubs: [], isAreaCoordinator: false, acting: null })).toEqual([]);
  });

  it("answers a hidden guide exactly like an unknown id", () => {
    expect(portalGuideForViewer("director-monthly-record", none)).toBeUndefined();
    expect(portalGuideForViewer("coordinator-team-approvals", none)).toBeUndefined();
    expect(portalGuideForViewer("not-a-guide", none)).toBeUndefined();
    expect(portalGuideForViewer("find-my-registration", none)?.id).toBe("find-my-registration");
  });
});

describe("portal guide links", () => {
  const guide = (id: string) => findPortalGuide(id)!;
  const hrefs = (id: string, viewer: PortalHelpViewer) => portalGuideLinksForViewer(guide(id), viewer).links.map((link) => link.href);

  it("links an attendee to their own registration pages only", () => {
    expect(hrefs("find-my-registration", none)).toEqual(["/account", "/account/registrations", "/recover-registration"]);
  });

  it("resolves a club page to the viewer's own club when they direct exactly one", () => {
    expect(hrefs("director-monthly-record", director(["org_a", "DIRECTOR"]))).toEqual(["/account/clubs/org_a/records", "/account/clubs"]);
    expect(hrefs("director-choose-club", director(["org_a", "REPORTER"]))).toEqual(["/account/clubs", "/account/clubs/org_a"]);
  });

  it("links to the club chooser, never to a guessed club, when they direct several", () => {
    const result = portalGuideLinksForViewer(guide("director-monthly-record"), director(["org_a", "DIRECTOR"], ["org_b", "DEPUTY"]));
    expect(result.links.map((link) => link.href)).toEqual(["/account/clubs"]);
    expect(result.links[0]!.label).toBe("Choose your club");
    expect(JSON.stringify(result)).not.toContain("org_a");
  });

  it("does not link a page the club role cannot use, and counts it without naming it", () => {
    const registrar = portalGuideLinksForViewer(guide("director-monthly-record"), director(["org_a", "REGISTRAR"]));
    expect(registrar.links.map((link) => link.href)).toEqual(["/account/clubs"]);
    expect(registrar.unavailable).toBe(1);
    expect(portalUnavailableText).not.toMatch(/records|monthly/i);
    const onlyRegistrars = portalGuideLinksForViewer(guide("director-year-end-report"), director(["org_a", "REGISTRAR"], ["org_b", "REGISTRAR"]));
    expect(onlyRegistrars.links).toEqual([]);
    expect(onlyRegistrars.unavailable).toBe(1);
  });

  it("uses the acted club for a staff act-as director, and the coordinator's own pages for a coordinator", () => {
    const acting: PortalHelpViewer = { hasAccount: false, directedClubs: [], isAreaCoordinator: false, acting: { role: "CLUB_DIRECTOR", organizationId: "org_a" } };
    expect(hrefs("director-monthly-record", acting)[0]).toBe("/account/clubs/org_a/records");
    expect(hrefs("coordinator-team-approvals", coordinator)).toEqual(["/account/area-clubs/team-permissions"]);
    expect(hrefs("coordinator-follow-records", coordinator)).toEqual(["/account/area-clubs/reports", "/account/area-clubs/overview"]);
  });

  it("never links a coordinator page to a viewer who is not a coordinator", () => {
    const result = portalGuideLinksForViewer(guide("coordinator-team-approvals"), none);
    expect(result.links).toEqual([]);
    expect(result.unavailable).toBe(1);
  });

  it("leaves a club page out when there is no club to resolve it to", () => {
    const result = portalGuideLinksForViewer(guide("director-monthly-record"), { ...none, acting: { role: "CLUB_DIRECTOR", organizationId: null } });
    expect(result.links.map((link) => link.href)).toEqual(["/account/clubs"]);
    expect(result.unavailable).toBe(1);
  });
});

describe("guide text", () => {
  it("holds no email address, person's name or real event name in any staff or portal guide", () => {
    // The glossary names kinds of event in general words ("a retreat or a camp meeting"), so it is held to the first two rules only.
    const guideText = [...portalGuides, ...helpGuides]
      .flatMap((guide) => [guide.title, guide.summary, guide.next, guide.owner, ...guide.needs, ...guide.changes, ...guide.steps, ...guide.verify, ...guide.keywords])
      .join("\n");
    const text = `${guideText}\n${glossaryTerms.flatMap((entry) => [entry.term, entry.meaning]).join("\n")}`;
    expect(text).not.toMatch(/@/);
    expect(text).not.toMatch(/\b(Mr|Mrs|Ms|Dr|Pastor|Elder)\.? [A-Z][a-z]+/);
    expect(guideText).not.toMatch(/women'?s retreat|camp meeting|camporee|camp heritage|sunnydale|honors weekend|\bWR26\b/i);
  });
});

describe("the portal and its permitted next steps", () => {
  it("adds a Help tab to the portal layout for signed-in accounts, without a staff or system menu", () => {
    const layout = readFileSync(join(root, "app/(public)/account/(portal)/layout.tsx"), "utf8");
    expect(layout).toContain('href: "/account/help", label: "Help"');
    expect(layout).not.toMatch(/\/help"[^\n]*staff/i);
  });

  it("puts the portal hub below /account/help without colliding with the authenticator help page", () => {
    const routes = listPageRoutes();
    expect(routes).toContain("/account/help");
    expect(routes).toContain("/account/help/[guideId]");
    expect(routes).toContain("/account/help/authenticator");
    expect(routes.filter((route) => route === "/account/help")).toHaveLength(1);
  });

  it("links the shared permission and not-available states to the Help hub without naming a page", () => {
    const restricted = renderToStaticMarkup(createElement(AccessRestricted, { title: "Health information is restricted", detail: "Ask a system administrator." }));
    expect(restricted).toContain('href="/help"');
    expect(renderToStaticMarkup(createElement(NotAvailableForEvent, { reason: "Not for this event." }))).toContain('href="/help"');
    const noAccess = readFileSync(join(root, "app/no-access/page.tsx"), "utf8");
    expect(noAccess).toContain('href="/help"');
  });
});
