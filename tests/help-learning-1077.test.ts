import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSearchDestinations,
  searchDestinations,
  type DestinationSearchContext,
} from "@/components/destination-search-model";
import { requiredPermissionFor, staffSubpageTitle } from "@/components/staff-navigation";
import { glossaryTerms } from "@/modules/help/glossary";
import { docUrl, helpDestinations, helpGuides } from "@/modules/help/guides";
import {
  askAdministratorText,
  unavailableText,
  canSeeGuide,
  filterGuides,
  guideForViewer,
  guideLinksForViewer,
  visibleGuides,
  type HelpViewer,
} from "@/modules/help/visibility";
import { eventPermissions, type EventPermission } from "@/modules/access/permissions";

/** Help & learning (#1077). Synthetic ids only. */

const root = process.cwd();

function pageRoutes(): string[] {
  const routes: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/^page\.(tsx|ts|jsx|js)$/.test(name)) {
        const segments = relative(join(root, "app"), dir).split(sep).filter((segment) => segment && !/^\(.*\)$/.test(segment));
        routes.push(`/${segments.join("/")}`);
      }
    }
  };
  walk(join(root, "app"));
  return routes;
}

function routeExists(path: string, routes: readonly string[]): boolean {
  const parts = path.split("/").filter(Boolean);
  return routes.some((route) => {
    const routeParts = route.split("/").filter(Boolean);
    return routeParts.length === parts.length && routeParts.every((part, index) => /^\[.+\]$/.test(part) || part === parts[index]);
  });
}

const eventStaff = (permissions: EventPermission[]): HelpViewer => ({ isSystemAdmin: false, selectedEventId: "evt_synthetic", permissions });
const admin: HelpViewer = { isSystemAdmin: true, selectedEventId: "evt_synthetic", permissions: [...eventPermissions] };
const noEvent: HelpViewer = { isSystemAdmin: false, selectedEventId: "", permissions: [] };
const ids = (viewer: HelpViewer) => visibleGuides(viewer).map((guide) => guide.id);

describe("guide registry", () => {
  it("has the initial guides and the #1259 additions, with unique, URL-safe ids that do not collide with the glossary", () => {
    const all = helpGuides.map((guide) => guide.id);
    expect(all).toEqual([
      "choose-workspace",
      "create-or-copy-event",
      "invite-staff",
      "choose-staff-role",
      "publish-registration-form",
      "import-with-preview",
      "resolve-email-problem",
      "understand-system-readiness",
      "review-new-club-application",
      "inspect-system-health",
    ]);
    expect(new Set(all).size).toBe(all.length);
    for (const id of all) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(all).not.toContain("glossary");
  });

  it("gives every guide what the reader needs, what changes, how to verify, the next step and upkeep fields", () => {
    for (const guide of helpGuides) {
      expect(guide.title.trim(), guide.id).not.toBe("");
      expect(guide.summary.trim(), guide.id).not.toBe("");
      expect(guide.needs.length, guide.id).toBeGreaterThan(0);
      expect(guide.changes.length, guide.id).toBeGreaterThan(0);
      expect(guide.steps.length, guide.id).toBeGreaterThan(0);
      expect(guide.verify.length, guide.id).toBeGreaterThan(0);
      expect(guide.next.trim(), guide.id).not.toBe("");
      expect(guide.keywords.length, guide.id).toBeGreaterThan(0);
      expect(guide.owner.trim(), guide.id).not.toBe("");
      expect(guide.lastReviewed, guide.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("never tells the reader to ask for system administrator rights to follow along", () => {
    for (const guide of helpGuides) {
      for (const line of guide.needs) expect(line, guide.id).not.toMatch(/(request|ask|apply|become|get)[^.]*system admin/i);
    }
  });

  it("points every destination at an existing app page, with a permission on each event page", () => {
    const routes = pageRoutes();
    for (const destination of Object.values(helpDestinations)) {
      expect(routeExists(destination.path, routes), destination.path).toBe(true);
      if (destination.scope === "Event") expect(destination.permission, destination.id).toBeDefined();
      // Where the sidebar names a permission for the same page, the guide agrees with it.
      const nav = requiredPermissionFor(destination.path);
      if (nav) expect(destination.permission, destination.id).toBe(nav);
    }
    for (const guide of helpGuides) {
      for (const id of guide.destinationIds) expect(helpDestinations[id], `${guide.id}:${id}`).toBeDefined();
    }
  });

  it("points every related doc at a file that exists, as a GitHub link", () => {
    for (const guide of helpGuides) {
      for (const path of guide.relatedDocs) {
        expect(path, guide.id).toMatch(/^docs\/[A-Za-z0-9._/-]+\.md$/);
        expect(existsSync(join(root, path)), path).toBe(true);
        expect(docUrl(path)).toBe(`https://github.com/DurantTL/IMSDA-Events/blob/main/${path}`);
      }
    }
  });

  it("holds no email address and no person's name in any guide or glossary text", () => {
    const text = [
      ...helpGuides.flatMap((guide) => [guide.title, guide.summary, guide.next, guide.owner, ...guide.needs, ...guide.changes, ...guide.steps, ...guide.verify, ...guide.keywords]),
      ...glossaryTerms.flatMap((entry) => [entry.term, entry.meaning]),
    ].join("\n");
    expect(text).not.toMatch(/@/);
    expect(text).not.toMatch(/\b(Mr|Mrs|Ms|Dr|Pastor|Elder)\.? [A-Z][a-z]+/);
    // Owners are roles.
    for (const guide of helpGuides) expect(guide.owner).toMatch(/office|team|administrator|staff/i);
  });

  it("has a glossary of plain terms that includes the real event role names", () => {
    expect(glossaryTerms.length).toBeGreaterThanOrEqual(12);
    expect(glossaryTerms.length).toBeLessThanOrEqual(24);
    expect(new Set(glossaryTerms.map((entry) => entry.term)).size).toBe(glossaryTerms.length);
    const team = glossaryTerms.find((entry) => entry.term.startsWith("Team"));
    expect(team?.meaning).toContain("Event administrator");
    expect(team?.meaning).toContain("Kitchen staff");
  });
});

describe("who sees which guide", () => {
  it("never gives a System guide to anyone but a system administrator", () => {
    const systemIds = helpGuides.filter((guide) => guide.workspace === "System").map((guide) => guide.id);
    expect(systemIds.length).toBeGreaterThan(0);
    const everyPermission = eventStaff([...eventPermissions]);
    for (const viewer of [noEvent, eventStaff([]), everyPermission]) {
      for (const id of systemIds) {
        expect(ids(viewer)).not.toContain(id);
        expect(guideForViewer(id, viewer)).toBeUndefined();
      }
    }
    for (const id of systemIds) expect(ids(admin)).toContain(id);
  });

  it("shows an event guide only to staff with the permission its working page needs", () => {
    expect(ids(eventStaff(["MANAGE_CHECK_IN"]))).toEqual(["choose-workspace"]);
    expect(ids(eventStaff(["MANAGE_STAFF"]))).toEqual(["choose-workspace", "invite-staff", "choose-staff-role"]);
    expect(ids(eventStaff(["MANAGE_FORMS"]))).toEqual(["choose-workspace", "publish-registration-form"]);
    expect(ids(eventStaff(["MANAGE_IMPORTS"]))).toEqual(["choose-workspace", "import-with-preview"]);
    expect(ids(eventStaff(["MANAGE_COMMUNICATIONS"]))).toEqual(["choose-workspace", "resolve-email-problem"]);
    expect(ids(admin)).toEqual(helpGuides.map((guide) => guide.id));
  });

  it("ties each event guide's audience to the permission its main page needs", () => {
    for (const guide of helpGuides) {
      if (guide.audience.kind !== "event-permission") continue;
      const main = guide.destinationIds.map((id) => helpDestinations[id]).find((destination) => destination.scope === "Event");
      expect(main?.permission, guide.id).toBe(guide.audience.permission);
    }
  });

  it("gives staff with no event the general guide, and a system administrator with no event every guide", () => {
    expect(ids(noEvent)).toEqual(["choose-workspace"]);
    expect(ids({ ...admin, selectedEventId: "", permissions: [] })).toEqual(helpGuides.map((guide) => guide.id));
  });

  it("answers a hidden guide exactly like an unknown id", () => {
    expect(guideForViewer("create-or-copy-event", eventStaff(["MANAGE_STAFF"]))).toBeUndefined();
    expect(guideForViewer("no-such-guide", eventStaff(["MANAGE_STAFF"]))).toBeUndefined();
    expect(guideForViewer("invite-staff", eventStaff(["MANAGE_STAFF"]))?.id).toBe("invite-staff");
    expect(canSeeGuide({ audience: { kind: "everyone" } }, noEvent)).toBe(true);
  });
});

describe("links to working pages", () => {
  const invite = helpGuides.find((guide) => guide.id === "invite-staff")!;
  const email = helpGuides.find((guide) => guide.id === "resolve-email-problem")!;

  it("gives a system administrator every page, with the event added", () => {
    const { links, unavailable } = guideLinksForViewer(invite, admin);
    expect(unavailable).toBe(0);
    expect(links.map((link) => link.href)).toEqual([
      "/staff?event=evt_synthetic",
      "/admin/people?event=evt_synthetic",
      "/admin/clubs/invites?event=evt_synthetic",
    ]);
  });

  it("gives staff only the pages they can open and counts the rest without naming them", () => {
    const { links, unavailable } = guideLinksForViewer(email, eventStaff(["MANAGE_COMMUNICATIONS"]));
    expect(links.map((link) => link.href)).toEqual(["/communications?event=evt_synthetic"]);
    expect(unavailable).toBe(1);
    expect(askAdministratorText).toBe("Ask an administrator for this event if you need this.");
    expect(askAdministratorText).not.toMatch(/\/admin/);
    expect(unavailableText({ selectedEventId: "evt_synthetic" })).toBe(askAdministratorText);
    expect(unavailableText({ selectedEventId: "" })).toBe("Ask a system administrator if you need this.");
  });

  it("gives no event page without a selected event, and no System page to anyone but a system administrator", () => {
    expect(guideLinksForViewer(invite, { ...noEvent, permissions: ["MANAGE_STAFF"] }).links).toEqual([]);
    const forms = helpGuides.find((guide) => guide.id === "publish-registration-form")!;
    const links = guideLinksForViewer(forms, eventStaff(["MANAGE_FORMS"])).links.map((link) => link.href);
    expect(links.some((href) => href.startsWith("/admin"))).toBe(false);
  });
});

describe("hub filter", () => {
  it("filters on title, summary and keywords, and needs every word", () => {
    const all = helpGuides;
    expect(filterGuides(all, "")).toHaveLength(all.length);
    expect(filterGuides(all, "  ").length).toBe(all.length);
    expect(filterGuides(all, "bounced").map((guide) => guide.id)).toEqual(["resolve-email-problem"]);
    expect(filterGuides(all, "csv preview").map((guide) => guide.id)).toEqual(["import-with-preview"]);
    expect(filterGuides(all, "invite zzzz")).toEqual([]);
  });
});

describe("shell search hook", () => {
  const base: DestinationSearchContext = {
    isSystemAdmin: false,
    selectedEventId: "evt_synthetic",
    permissions: [],
    clubOversight: false,
    clubEvent: false,
    clubFormsAccess: false,
  };
  const adminContext: DestinationSearchContext = { ...base, isSystemAdmin: true, permissions: [...eventPermissions] };
  const find = (context: DestinationSearchContext, query: string) => searchDestinations(buildSearchDestinations(context), query);

  it("adds the hub, the glossary and each visible guide as Help results", () => {
    const help = buildSearchDestinations(adminContext).filter((destination) => destination.scope === "Help");
    expect(help.map((destination) => destination.href)).toEqual([
      "/help?event=evt_synthetic",
      ...helpGuides.map((guide) => `/help/${guide.id}?event=evt_synthetic`),
      "/help/glossary?event=evt_synthetic",
    ]);
  });

  it("finds the invite guide for a system administrator typing invite", () => {
    const results = find(adminContext, "invite");
    expect(results.some((result) => result.scope === "Help" && result.href === "/help/invite-staff?event=evt_synthetic")).toBe(true);
  });

  it("never lists a hidden guide for a narrow viewer", () => {
    const narrow = buildSearchDestinations({ ...base, permissions: ["MANAGE_CHECK_IN"] });
    const helpHrefs = narrow.filter((destination) => destination.scope === "Help").map((destination) => destination.href);
    expect(helpHrefs).toEqual(["/help?event=evt_synthetic", "/help/choose-workspace?event=evt_synthetic", "/help/glossary?event=evt_synthetic"]);
    const everything = JSON.stringify(narrow);
    for (const guide of helpGuides.filter((candidate) => candidate.id !== "choose-workspace")) {
      expect(everything).not.toContain(guide.id);
      expect(everything).not.toContain(guide.title);
    }
  });

  it("gives staff with no event the hub, the general guide and the glossary", () => {
    const results = buildSearchDestinations({ ...base, selectedEventId: "" }).filter((destination) => destination.scope === "Help");
    expect(results.map((destination) => destination.href)).toEqual(["/help", "/help/choose-workspace", "/help/glossary"]);
  });

  it("ranks a page above the guide for the same word", () => {
    const results = find(adminContext, "email");
    const pageIndex = results.findIndex((result) => result.scope === "System" && result.label === "Email");
    const guideIndex = results.findIndex((result) => result.scope === "Help" && result.href === "/help/resolve-email-problem?event=evt_synthetic");
    expect(pageIndex).toBe(0);
    expect(guideIndex).toBeGreaterThan(pageIndex);
    const eventOnly = find({ ...base, permissions: ["MANAGE_COMMUNICATIONS"] }, "email");
    expect(eventOnly[0].scope).toBe("Event");
  });

  it("labels the scope for screen readers", async () => {
    const { destinationScopeDescription, destinationScopeLabels } = await import("@/components/destination-search-model");
    expect(destinationScopeLabels.Help).toBe("Help");
    expect(destinationScopeDescription("Help")).toBe("Help & learning guide");
  });
});

describe("page titles", () => {
  it("names Help pages without lighting an unrelated item", () => {
    expect(staffSubpageTitle("/help")).toBe("Help & learning");
    expect(staffSubpageTitle("/help/invite-staff")).toBe("Help & learning");
    expect(staffSubpageTitle("/help/glossary")).toBe("Glossary");
  });
});
