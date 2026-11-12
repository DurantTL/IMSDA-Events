import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { pageOwnsHeader } from "@/components/page-header-routes";
import { staffPageTitles } from "@/components/staff-navigation";
import { TagConfigurationWorkspace } from "@/components/tag-configuration-workspace";
import { pageTitleExpressions } from "./helpers/page-sources-1772";

// #1586 part 5: the inside of Tags. Synthetic data only.
const tag = { id: "t1", name: "VIP", color: "#4F46E5", description: "", isActive: true };
const render = (props: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(TagConfigurationWorkspace, {
  eventId: "event_7", initialTags: [tag], canCreate: true, ...props,
}));
const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("Tags layout (#1586)", () => {
  it("takes its h1 from the page, titled like the menu item, with no eyebrow or hidden duplicate", () => {
    const page = read("app/(workspace)/more/tags/page.tsx");
    expect(pageTitleExpressions(page)).toEqual(expect.arrayContaining(["staffPageTitles.tags"]));
    expect(staffPageTitles.tags).toBe("Tags");
    const markup = render();
    expect(markup).not.toMatch(/<h1/);
    expect(markup).not.toContain("duplicate-page-title");
    expect(markup).not.toContain("Event configuration");
  });

  it("is listed, and the restricted branch keeps a titled header", () => {
    expect(pageOwnsHeader("/more/tags")).toBe(true);
    expect(read("app/(workspace)/more/tags/page.tsx").match(/<PageHeader /g)).toHaveLength(2);
  });

  it("has one filled button, Add tag, and gives the form its own heading", () => {
    const markup = render();
    expect(markup.match(/class="primary-button"/g)).toHaveLength(1);
    expect(markup).toMatch(/class="primary-button"[^>]*>Add tag</);
    expect(markup).toMatch(/<h2[^>]*>Add a tag</);
    expect(render({ canCreate: false })).not.toContain("Add a tag");
  });

  it("keeps the usage note and quiets the empty state", () => {
    expect(render()).toContain('href="/people?event=event_7"');
    const empty = render({ initialTags: [] });
    expect(empty).toContain("No tags yet");
    expect(empty).not.toContain('role="status"');
  });

  it("keeps 44px targets and a stacked colour row on a phone, in the module", () => {
    const css = read("components/tag-configuration-workspace.module.css");
    expect(css).toMatch(/\.colorInput \{[^}]*min-height: 44px/);
    expect(css).toMatch(/\.rowActions :global\(\.secondary-button\) \{[^}]*min-height: 44px/);
    expect(css).toMatch(/@media \(max-width: 639px\)[\s\S]*\.colorRow \{ grid-template-columns: minmax\(0, 1fr\)/);
  });
});
