import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EventPatchesWorkspace } from "@/components/event-patches-workspace";
import { pageOwnsHeader } from "@/components/page-header-routes";
import { staffPageTitles } from "@/components/staff-navigation";
import { pageTitleExpressions } from "./helpers/page-sources-1772";

// #1586 part 4: the inside of Event patches. Synthetic data only.
const item = { itemId: "i1", name: "Pathfinder Camporee patch", section: "PATCHES_PINS", catalogNumber: null };
const render = (props: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(EventPatchesWorkspace, {
  eventId: "event_7", initial: { linked: [], choices: [item], isClubEvent: true }, ...props,
} as never));
const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("Event patches layout (#1586)", () => {
  it("takes its h1 from the page, titled like the menu item, with no eyebrow or duplicate heading", () => {
    const page = read("app/(workspace)/more/event-patches/page.tsx");
    expect(pageTitleExpressions(page)).toEqual(expect.arrayContaining(["staffPageTitles.eventPatches"]));
    expect(staffPageTitles.eventPatches).toBe("Event patches");
    const markup = render();
    expect(markup).not.toMatch(/<h1/);
    expect(markup).not.toContain("Club ministries");
    expect(markup).not.toMatch(/<h2[^>]*>Event patches</);
  });

  it("is listed, and the restricted branches keep a titled header", () => {
    expect(pageOwnsHeader("/more/event-patches")).toBe(true);
    const page = read("app/(workspace)/more/event-patches/page.tsx");
    expect(page.match(/<PageHeader /g)).toHaveLength(3);
  });

  it("has one filled button", () => {
    expect(render().match(/class="primary-button"/g)).toHaveLength(1);
    expect(render()).toMatch(/Link to this event/);
  });

  it("links the catalog only for a viewer who can open it, and says directors confirm", () => {
    const withLink = render({ canOpenCatalog: true });
    expect(withLink).toContain('href="/admin/club-supplies"');
    expect(withLink).toContain("confirm before anything is ordered");
    const without = render();
    expect(without).not.toContain("/admin/club-supplies");
    expect(without).toContain("Club supply catalog");
    expect(without).toContain("confirm before anything is ordered");
  });

  it("shows an empty state, not a plain sentence, when nothing is linked", () => {
    const markup = render();
    expect(markup).toContain("No patch or pin linked yet");
    expect(markup).not.toContain("Nothing is linked yet.");
    expect(markup).not.toContain('role="status"');
    expect(markup).toContain("Patches and pins for this event (0)");
  });

  it("gives Unlink a 44px target and stacks the controls on a phone, in the module", () => {
    const css = read("components/club-supplies.module.css");
    expect(css).toMatch(/\.unlinkButton \{[^}]*min-height: 44px/);
    expect(css).toMatch(/\.patchActions > :global\(\.primary-button\) \{[^}]*width: 100%/);
    const linked = render({ initial: { linked: [item], choices: [item], isClubEvent: true } });
    expect(linked).toContain("Unlink");
  });
});
