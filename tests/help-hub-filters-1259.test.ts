import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HelpSearch, type HubGuide } from "@/app/(workspace)/help/help-search";
import { helpGuides } from "@/modules/help/guides";
import {
  filterGuides,
  filterGuidesByWorkspace,
  visibleGuides,
  workspaceFilterLabels,
  workspaceFilterOptions,
  type HelpViewer,
} from "@/modules/help/visibility";
import { eventPermissions } from "@/modules/access/permissions";

/** Hub filters (#1259). Synthetic viewers only. */

const toHub = ({ id, title, summary, workspace, keywords }: (typeof helpGuides)[number]): HubGuide => ({ id, title, summary, workspace, keywords });
const admin: HelpViewer = { isSystemAdmin: true, selectedEventId: "evt_synthetic", permissions: [...eventPermissions] };
const noEvent: HelpViewer = { isSystemAdmin: false, selectedEventId: "", permissions: [] };
const adminGuides = visibleGuides(admin).map(toHub);
const noEventGuides = visibleGuides(noEvent).map(toHub);

describe("workspace filter", () => {
  it("offers System only to a viewer who has a System guide", () => {
    expect(workspaceFilterOptions(adminGuides)).toEqual(["all", "System", "Event"]);
    expect(workspaceFilterOptions(noEventGuides)).toEqual(["all", "Event"]);
    expect(noEventGuides.some((guide) => guide.workspace === "System")).toBe(false);
  });

  it("labels the choices with the group names the hub already shows", () => {
    expect(workspaceFilterLabels).toEqual({ all: "All", System: "System administration", Event: "Event workspace" });
  });

  it("filters by workspace and works together with the text filter", () => {
    expect(filterGuidesByWorkspace(adminGuides, "all")).toHaveLength(adminGuides.length);
    const system = filterGuidesByWorkspace(adminGuides, "System");
    expect(system.length).toBeGreaterThan(0);
    expect(system.every((guide) => guide.workspace === "System")).toBe(true);
    const event = filterGuidesByWorkspace(adminGuides, "Event");
    expect(event.every((guide) => guide.workspace === "Event")).toBe(true);
    expect(system.length + event.length).toBe(adminGuides.length);
    // "email" finds an Event guide and a System one; the workspace filter then narrows the same text match.
    const both = filterGuides(adminGuides, "club");
    expect(filterGuidesByWorkspace(both, "System").every((guide) => guide.workspace === "System")).toBe(true);
    expect(filterGuidesByWorkspace(filterGuides(adminGuides, "readiness"), "Event")).toEqual([]);
  });
});

describe("hub markup", () => {
  it("renders an accessible fieldset of radios with All selected, and every guide", () => {
    const html = renderToStaticMarkup(createElement(HelpSearch, { guides: adminGuides, selectedEventId: "evt_synthetic" }));
    expect(html).toContain("<fieldset");
    expect(html).toContain("<legend");
    expect(html).toContain("Show guides for");
    expect((html.match(/type="radio"/g) ?? []).length).toBe(3);
    expect(html).toMatch(/<input[^>]*checked=""[^>]*value="all"|<input[^>]*value="all"[^>]*checked=""/);
    expect(html).toContain(`${adminGuides.length} guides available.`);
  });

  it("leaves the System choice out when the viewer has no System guide", () => {
    const html = renderToStaticMarkup(createElement(HelpSearch, { guides: noEventGuides, selectedEventId: "" }));
    expect((html.match(/type="radio"/g) ?? []).length).toBe(2);
    expect(html).not.toContain("System administration");
  });
});
