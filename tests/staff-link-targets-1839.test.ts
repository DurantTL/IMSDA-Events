import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { linkedRoutesBySource } from "@/components/page-reachability";

// #1839: every staff link points at a real page. #1731 checks the other direction (every page has a link); this guard
// fails CI when a menu, hub card, tab, registry row or an in-page link in staff source names a route with no page.tsx or
// route.ts behind it. Source-level only: the browser crawl in the #1839 PR covers what each role is shown.

const appDir = join(process.cwd(), "app");

/** Every page.tsx and route.ts under app/, as a route pattern with [segments] kept. */
function appRoutes(): string[] {
  const routes: string[] = [];
  const walk = (relative: string) => {
    for (const entry of readdirSync(join(appDir, relative), { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(relative, entry.name));
      else if (/^(page\.tsx|route\.ts)$/.test(entry.name)) {
        const segments = relative.split(/[\\/]/).filter((segment) => segment && !/^\(.*\)$/.test(segment) && !segment.startsWith("@"));
        routes.push(`/${segments.join("/")}`);
      }
    }
  };
  walk("");
  return routes;
}

const routePatterns = appRoutes().map(
  (route) =>
    new RegExp(
      `^${route
        .replace(/\[\[\.\.\.[^\]]+\]\]/g, ".*")
        .replace(/\[\.\.\.[^\]]+\]/g, ".+")
        .replace(/\[[^\]]+\]/g, "[^/]+")}/?$`,
    ),
);

/** A link's path, without query, hash or a trailing query built in a template (`/more/lodging${eventQuery}`). */
function linkPath(href: string): string {
  return href
    .split("?")[0]
    .split("#")[0]
    .replace(/([^/])\$\{[^}]*\}.*$/, "$1")
    .replace(/\$\{[^}]*\}/g, "[x]");
}

const hasRoute = (href: string, patterns = routePatterns) => {
  const path = linkPath(href);
  return patterns.some((pattern) => pattern.test(path.replace(/\[[^\]]+\]/g, "x")));
};

/** The first path segments of the staff workspace (`/admin`, `/more`, `/people`, ...). */
const staffSegments = readdirSync(join(appDir, "(workspace)"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

/**
 * Staff-route strings in source that are not links: title prefixes, examples of a missing page, and docs of other
 * routes. Each has a reason, and the test fails when one is no longer in its file so the list cannot go stale.
 */
const notLinks: ReadonlyArray<{ file: string; text: string; why: string }> = [
  { file: "app/(workspace)/not-found.tsx", text: "/more/nonexistent", why: "An example of a missing address in the not-found copy." },
  { file: "components/app-shell.tsx", text: "/more/*", why: "A comment-style pattern for every More page, not a link." },
  { file: "components/staff-navigation.ts", text: "/more/*", why: "A pattern naming every More page, not a link." },
  { file: "components/staff-navigation.ts", text: "/more/reports/clubs/packet", why: "A page-title prefix for the club packet pages under it." },
  { file: "components/staff-navigation.ts", text: "/more/health-records/", why: "A page-title prefix for each health record." },
  { file: "modules/help/walkthrough-images.ts", text: "/help/walkthroughs/<guideId>/<nn>-<stepId>-<kind>.webp", why: "Documents the static image names in public/, not a page link." },
];

function sourceFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && path !== "app/api") walk(path);
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(path);
    }
  };
  for (const dir of ["app/(workspace)", "components", "modules"]) walk(dir);
  return files;
}

/** Quoted strings in a source file that start with a staff segment, e.g. "/admin/clubs" or `/more/lodging${q}`. */
function staffHrefsIn(source: string, segments: readonly string[] = staffSegments): string[] {
  const starts = new RegExp(`^/(${segments.map((segment) => segment.replace(/[-]/g, "\\-")).join("|")})(?=$|[/?#$])`);
  return [...source.matchAll(/["'`](\/[a-z][^"'`\s]*)["'`]/g)].map((match) => match[1]).filter((text) => starts.test(text));
}

describe("every staff link points at a real page (#1839)", () => {
  it("finds the staff workspace segments and routes", () => {
    expect(staffSegments).toEqual(expect.arrayContaining(["admin", "more", "people", "overview"]));
    expect(routePatterns.length).toBeGreaterThan(300);
  });

  it("menus, hub cards, tabs, the rail and the registries only link to real routes", () => {
    const missing = Object.entries(linkedRoutesBySource()).flatMap(([source, set]) => [...set].filter((route) => !hasRoute(route)).map((route) => `${source}: ${route}`));
    expect(missing).toEqual([]);
  });

  it("in-page links in staff source only point at real routes", () => {
    const missing: string[] = [];
    for (const file of sourceFiles()) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      for (const href of staffHrefsIn(source)) {
        if (hasRoute(href)) continue;
        if (notLinks.some((entry) => entry.file === file && entry.text === href)) continue;
        missing.push(`${file}: ${href}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("keeps every not-a-link entry real", () => {
    for (const entry of notLinks) {
      expect(readFileSync(join(process.cwd(), entry.file), "utf8"), `${entry.file} still has ${entry.text}`).toContain(entry.text);
      expect(hasRoute(entry.text), `${entry.text} is a real route now; drop it from notLinks`).toBe(false);
      expect(staffHrefsIn(`"${entry.text}"`), `${entry.text} is not scanned; drop it from notLinks`).toEqual([entry.text]);
    }
  });

  it("fails for a link to a missing page and passes the same link once the page exists", () => {
    const source = 'const a = <Link href="/admin/brand-new-page" />; const b = `/more/lodging${eventQuery}`; const c = "/admin/clubs/summary?view=records#x";';
    const hrefs = staffHrefsIn(source);
    expect(hrefs).toEqual(["/admin/brand-new-page", "/more/lodging${eventQuery}", "/admin/clubs/summary?view=records#x"]);
    expect(hrefs.filter((href) => !hasRoute(href))).toEqual(["/admin/brand-new-page"]);
    expect(hasRoute("/admin/brand-new-page", [...routePatterns, /^\/admin\/brand-new-page\/?$/])).toBe(true);
    expect(hasRoute("/admin/events/${event.id}/nope")).toBe(false);
  });
});

describe("links the #1839 crawl found wrongly shown", () => {
  const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

  it("New club applications shows Platform settings (Notification address) to system administrators only", () => {
    // The link moved from the page header into the queue's intro (#1589); the page still decides who sees it.
    expect(read("app/(workspace)/admin/clubs/applications/page.tsx")).toContain('const showSettingsLink = viewer === "SYSTEM_ADMIN";');
    expect(read("components/staff-club-applications.tsx")).toContain('{showSettingsLink && <>{" · "}<Link href="/admin/settings">Notification address</Link></>}');
    expect(read("app/(workspace)/admin/settings/page.tsx")).toContain("SYSTEM_ADMIN");
  });

  it("the System report opens the events list, not the Events Administrator dashboard a system administrator is sent away from", () => {
    const providers = read("modules/system-admin/system-report/providers.ts");
    expect(providers).toContain('"/admin/events", "Open events")');
    expect(providers).not.toContain('"/events-admin"');
  });
});
