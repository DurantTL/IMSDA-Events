import { describe, expect, it } from "vitest";
import { pageOwnsHeader, pagesWithOwnHeader } from "@/components/page-header-routes";
import { headerDefinitionFiles, pageTitleExpressions, reachFrom, routeOf, source, workspacePages } from "./helpers/page-sources-1772";

// #1772 (site rule D1): the staff shell skips its own h1 for exactly the pages that draw a titled PageHeader. Synthetic data only.
const concrete = (route: string) => route.replace(/\[[^\]]+\]/g, "sample-id");

describe("the pages that draw their own header (#1772)", () => {
  const pages = workspacePages().map((file) => ({ file, route: routeOf(file) }));
  // A page owns its header when it, or a component it reaches, renders a titled PageHeader or page template.
  const rendersTitled = (file: string) => !headerDefinitionFiles(file) && pageTitleExpressions(source(file)).length > 0;
  const owners = pages.filter(({ file }) => [...reachFrom([file])].some(rendersTitled)).map(({ route }) => route).sort();

  it("lists every staff page that renders a titled PageHeader or page template, and no other", () => {
    expect(pagesWithOwnHeader.map((entry) => entry.pattern).sort()).toEqual(owners);
  });

  it("makes the shell skip its h1 for each of them", () => {
    for (const route of owners) expect(pageOwnsHeader(concrete(route)), route).toBe(true);
  });

  it("keeps the shell's h1 for every other staff page, including static pages beside a dynamic one", () => {
    for (const { route } of pages) {
      if (owners.includes(route)) continue;
      expect(pageOwnsHeader(concrete(route)), route).toBe(false);
    }
  });

  it("matches whole segments only", () => {
    expect(pageOwnsHeader("/event-setup")).toBe(true);
    expect(pageOwnsHeader("/event-setup/")).toBe(true);
    expect(pageOwnsHeader("/event-setup/other")).toBe(false);
    expect(pageOwnsHeader("/more/clubs/org_1")).toBe(true);
    expect(pageOwnsHeader("/more/clubs/reports")).toBe(false);
    expect(pageOwnsHeader("/more/clubs")).toBe(false);
  });

  it("is read by the shell, which draws its own h1 only when the page does not", () => {
    const shell = source("components/app-shell.tsx");
    expect(shell).toContain("pageOwnsHeader(pathname)");
    expect(shell).toMatch(/\{!pageDrawsOwnHeader && \(\s*<header className=\{styles\.pageHeader\}>/);
    expect((shell.match(/<h1\b/g) ?? []).length).toBe(1);
  });
});
