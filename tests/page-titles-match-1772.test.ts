import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pageOwnsHeader } from "@/components/page-header-routes";
import { buildRouteMapping } from "@/components/route-mapping";
import { staffPageTitles, staffShellPageTitle } from "@/components/staff-navigation";
import { pageTitleExpressions, root, source } from "./helpers/page-sources-1772";

// #1772 (site rule D2): a page's title is the same words as the tab or hub card that opens it. Synthetic data only.
const rows = buildRouteMapping().filter((row) => (row.kind === "menu" || row.kind === "shell") && !row.route.includes("["));
const exceptions: Record<string, { title: string; label: string }> = JSON.parse(readFileSync(join(root, "tests/fixtures/title-label-exceptions-1772.json"), "utf8")).routes;
const pageFile = (route: string) => `app/(workspace)${route === "/" ? "" : route}/page.tsx`;

/** The words a title expression gives, or null for a dynamic one (a record's own name). */
function titleWords(expression: string): string | null {
  if (expression.startsWith('"')) return expression.slice(1, -1);
  const key = /^staffPageTitles\.(\w+)$/.exec(expression)?.[1];
  return key ? (staffPageTitles as Record<string, string>)[key] ?? null : null;
}

describe("a page's title is the label that opens it (#1772)", () => {
  it("holds for every page that draws its own title, against the route-mapping label and the title the shell used", () => {
    const owned = rows.filter((row) => pageOwnsHeader(row.route));
    expect(owned.length).toBeGreaterThan(0);
    for (const row of owned) {
      const words = pageTitleExpressions(source(pageFile(row.route))).map(titleWords).filter((value): value is string => value !== null);
      expect(words.length, `${row.route} gives a readable title`).toBeGreaterThan(0);
      for (const title of words) {
        expect(title, `${row.route} title`).toBe(row.label);
        expect(title, `${row.route} against the shell title`).toBe(staffShellPageTitle(row.route));
      }
    }
  });

  it("keeps the same words for a sub-page that is not in the menus (a reached page)", () => {
    for (const route of ["/event-setup/from-template"]) {
      const words = pageTitleExpressions(source(pageFile(route))).map(titleWords);
      expect(words).toEqual([staffShellPageTitle(route)]);
    }
  });

  it("holds for the pages outside the shell that draw their own title", () => {
    for (const [file, route] of [["app/archived-events/page.tsx", "/archived-events"], ["app/select-event/page.tsx", "/select-event"]] as const) {
      const words = pageTitleExpressions(source(file)).map(titleWords);
      expect(words, file).toHaveLength(1);
      const row = rows.find((candidate) => candidate.route === route);
      if (row) expect(words[0], route).toBe(row.label);
    }
  });

  it("holds for every page the shell titles, except today's reviewed list, which only shrinks", () => {
    // Pages outside `app/(workspace)` (such as /archived-events) are not titled by the shell; they are checked above.
    const shellTitled = rows.filter((row) => !pageOwnsHeader(row.route) && existsSync(join(root, pageFile(row.route))));
    const mismatches = Object.fromEntries(
      shellTitled
        .filter((row) => staffShellPageTitle(row.route) !== row.label)
        .map((row) => [row.route, { title: staffShellPageTitle(row.route), label: row.label }]),
    );
    // A new mismatch fails; an old one that now matches (or moved to a page that draws its own title) must leave the list.
    expect(Object.keys(mismatches).filter((route) => !(route in exceptions)), "new mismatches").toEqual([]);
    expect(Object.keys(exceptions).filter((route) => !(route in mismatches)), "exceptions that no longer mismatch").toEqual([]);
    for (const [route, entry] of Object.entries(exceptions)) expect(mismatches[route], route).toEqual(entry);
  });
});
