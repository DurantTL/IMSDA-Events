import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// #1558: the documentation site map. Every page file in app/ has exactly one row, in docs/SITE-MAP.md or (for staff
// workspace pages) the generated docs/STAFF-WORKSPACE-ROUTES.md, and neither document lists a page that no longer exists.
// Adding a page without a map entry fails here. Documentation only: menus and server guards are tested elsewhere.

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

/** Every page.tsx under app/, as the route it serves (route groups dropped, dynamic segments kept as `[name]`). */
function pageRoutes(): Map<string, string> {
  const routes = new Map<string, string>();
  const walk = (relative: string) => {
    for (const entry of readdirSync(join(process.cwd(), "app", relative), { withFileTypes: true })) {
      const next = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(next);
      else if (/^page\.(tsx|ts|jsx|js|mdx)$/.test(entry.name)) {
        const segments = relative.split("/").filter((segment) => segment && !/^\(.*\)$/.test(segment));
        const route = `/${segments.join("/")}`;
        expect(routes.has(route), `two page files serve ${route}`).toBe(false);
        routes.set(route, `app/${next}`);
      }
    }
  };
  walk("");
  return routes;
}

/** The route in the first column of each table row, for rows whose first cell is a code span starting with "/". */
function tableRoutes(file: string): string[] {
  return read(file)
    .split("\n")
    .map((line) => /^\| `(\/[^`?]*)` \|/.exec(line)?.[1])
    .filter((route): route is string => Boolean(route));
}

const pages = pageRoutes();
const siteMapRows = tableRoutes("docs/SITE-MAP.md");
const siteMap = [...new Set(siteMapRows)];
// The staff matrix repeats a few routes in its query-state table on purpose, so each route counts once there.
const staffMap = [...new Set(tableRoutes("docs/STAFF-WORKSPACE-ROUTES.md"))];

describe("documentation site map (#1558)", () => {
  it("finds the app's pages", () => {
    expect(pages.size).toBeGreaterThan(250);
  });

  it("lists every page exactly once across the site map and the staff route table", () => {
    const counts = new Map<string, number>();
    for (const route of [...siteMap, ...staffMap]) counts.set(route, (counts.get(route) ?? 0) + 1);
    const missing = [...pages.keys()].filter((route) => !counts.has(route)).map((route) => `${route} (${pages.get(route)})`);
    const twice = [...counts].filter(([, count]) => count > 1).map(([route]) => route);
    expect(missing, "add a row for each new page to docs/SITE-MAP.md, or rerun npx tsx docs/generate-staff-workspace-map.ts for a staff page").toEqual([]);
    expect(twice, "a page belongs in one map only").toEqual([]);
  });

  it("gives each page one row in the site map", () => {
    const repeated = siteMapRows.filter((route, index) => siteMapRows.indexOf(route) !== index);
    expect(repeated, "a page has one row in docs/SITE-MAP.md").toEqual([]);
  });

  it("lists no page that no longer exists", () => {
    const stale = [...siteMap, ...staffMap].filter((route) => !pages.has(route));
    expect(stale, "remove or rename map rows for deleted or moved pages").toEqual([]);
  });

  it("keeps the staff route table in step with the staff workspace pages", () => {
    const staffPages = [...pages].filter(([route, file]) => file.startsWith("app/(workspace)/") && route !== "/profile").map(([route]) => route);
    const notGenerated = staffPages.filter((route) => !staffMap.includes(route));
    expect(notGenerated, "rerun npx tsx docs/generate-staff-workspace-map.ts").toEqual([]);
  });

  it("links the staff route table from the site map", () => {
    expect(read("docs/SITE-MAP.md")).toContain("STAFF-WORKSPACE-ROUTES.md");
  });
});
