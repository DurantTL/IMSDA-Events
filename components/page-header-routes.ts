/**
 * The staff pages that draw their own `PageHeader` title (#1772), and so their own `h1`. The staff shell
 * (`components/app-shell.tsx`) draws the `h1` for every other page, so it consults this list and skips its own for these;
 * a page is never given two. The list is static, so the server render and the first client render agree and nothing
 * flashes. `tests/page-header-routes-1772.test.ts` keeps it and the pages that render a titled `PageHeader` (or a page
 * template) in step, both ways.
 *
 * `pattern` is a staff route; `[name]` is one dynamic segment. `notSegments` lists the static folders that share a
 * dynamic segment's place and are not this page (for example `/more/clubs/reports`).
 */
export type PageOwnsHeaderRoute = { pattern: string; notSegments?: readonly string[] };

export const pagesWithOwnHeader: readonly PageOwnsHeaderRoute[] = [
  { pattern: "/communications" },
  { pattern: "/communications/scheduled" },
  { pattern: "/community" },
  { pattern: "/event-setup" },
  { pattern: "/event-setup/from-template" },
  { pattern: "/event-setup/copy" },
  { pattern: "/more/reports/printouts" },
  { pattern: "/admin/club-supplies/conference-orders" },
  { pattern: "/more/clubs/[organizationId]", notSegments: ["reports"] },
];

function segmentsOf(path: string) {
  return path.split("?")[0].split("#")[0].split("/").filter(Boolean);
}

/** Whether the page at this pathname draws its own `h1` (so the shell must not). */
export function pageOwnsHeader(pathname: string, routes: readonly PageOwnsHeaderRoute[] = pagesWithOwnHeader): boolean {
  const actual = segmentsOf(pathname);
  return routes.some(({ pattern, notSegments = [] }) => {
    const expected = segmentsOf(pattern);
    if (expected.length !== actual.length) return false;
    return expected.every((segment, index) => (
      segment.startsWith("[") && segment.endsWith("]")
        ? !notSegments.includes(actual[index]!)
        : segment === actual[index]
    ));
  });
}
