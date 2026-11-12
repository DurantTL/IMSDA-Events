import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AttendeeConfigurationWorkspace } from "@/components/attendee-configuration-workspace";
import { pageOwnsHeader } from "@/components/page-header-routes";
import { staffPageTitles } from "@/components/staff-navigation";
import { pageTitleExpressions } from "./helpers/page-sources-1772";

// #1586 part 2: the inside of Attendee setup. Synthetic data only.
const type = { id: "t1", code: "ADULT", label: "Adult", description: "", sortOrder: 0, isActive: true, minimumAge: null, maximumAge: null };
const grouping = { id: "c1", kind: "TRACK" as const, code: "WORSHIP", label: "Worship", description: "", sortOrder: 0, isActive: true };
const render = (props: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(AttendeeConfigurationWorkspace, {
  eventId: "event_7", eventName: "Synthetic Retreat", initialTypes: [type], initialClassifications: [grouping], canCreate: true, ...props,
}));

describe("Attendee setup layout (#1586)", () => {
  it("draws its own h1 from the page, titled like the menu item, with no eyebrow or hidden duplicate", () => {
    const page = readFileSync(path.join(process.cwd(), "app/(workspace)/more/attendee-configuration/page.tsx"), "utf8");
    expect(pageTitleExpressions(page)).toEqual(["staffPageTitles.attendeeSetup"]);
    expect(staffPageTitles.attendeeSetup).toBe("Attendee setup");
    const markup = render();
    expect(markup).not.toMatch(/<h1/);
    expect(markup).not.toContain("duplicate-page-title");
    expect(markup).not.toContain("Event configuration");
  });

  it("is listed so the shell draws no second h1", () => {
    expect(pageOwnsHeader("/more/attendee-configuration")).toBe(true);
  });

  it("links two anchors to the two sections", () => {
    const page = readFileSync(path.join(process.cwd(), "app/(workspace)/more/attendee-configuration/page.tsx"), "utf8");
    expect(page).toContain('href="#attendee-types"');
    expect(page).toContain('href="#attendee-groupings"');
    const markup = render();
    expect(markup).toContain('id="attendee-types"');
    expect(markup).toContain('id="attendee-groupings"');
  });

  it("has one filled button and the grouping button outlined", () => {
    const markup = render();
    expect(markup.match(/class="primary-button"/g)).toHaveLength(1);
    expect(markup).toMatch(/class="primary-button"[^>]*>Add attendee type</);
    expect(markup).toMatch(/class="secondary-button"[^>]*>Add grouping</);
  });

  it("says prices live in the registration form, linking only for a viewer who can open it", () => {
    const withLink = render({ canManageForms: true });
    expect(withLink).toContain("Prices are set in the");
    expect(withLink).toContain('href="/registration-builder?event=event_7"');
    const without = render();
    expect(without).toContain("Prices are set in the");
    expect(without).not.toContain("/registration-builder");
  });

  it("shows a short empty state for each section, apart from the error alert", () => {
    const markup = render({ initialTypes: [], initialClassifications: [] });
    expect(markup).toContain("No attendee types yet");
    expect(markup).toContain("No categories, tracks, or departments yet");
    expect(markup).not.toContain('role="alert"');
  });

  it("keeps the new styles in the module with 44px anchors", () => {
    const css = readFileSync(path.join(process.cwd(), "components/attendee-configuration-workspace.module.css"), "utf8");
    expect(css).toMatch(/\.anchors a \{[^}]*min-height: 44px/);
  });
});
