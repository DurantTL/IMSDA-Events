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
  { pattern: "/admin/events" },
  { pattern: "/communications" },
  { pattern: "/communications/scheduled" },
  { pattern: "/community" },
  { pattern: "/event-setup" },
  { pattern: "/event-setup/from-template" },
  { pattern: "/event-setup/copy" },
  { pattern: "/more/reports/printouts" },
  { pattern: "/more/issued-assets" },
  { pattern: "/more/issued-assets/closeout" },
  { pattern: "/more/merchandise" },
  { pattern: "/more/tags" },
  { pattern: "/more/event-settings" },
  { pattern: "/admin/club-supplies/conference-orders" },
  { pattern: "/admin/club-supplies" },
  { pattern: "/more/event-patches" },
  { pattern: "/more/recognitions" },
  { pattern: "/admin/honors" },
  { pattern: "/admin/master-award-rules" },
  { pattern: "/more/clubs/[organizationId]", notSegments: ["reports"] },
  { pattern: "/admin/club-forms" },
  { pattern: "/admin/club-forms/[templateKey]", notSegments: ["public-page"] },
  { pattern: "/more/club-forms" },
  { pattern: "/more/club-forms/[submissionId]" },
  { pattern: "/information-forms" },
  { pattern: "/information-forms/responses" },
  { pattern: "/admin/information-forms" },
  { pattern: "/admin/information-forms/[formId]/responses" },
  { pattern: "/admin/calendar" },
  { pattern: "/admin/site-content" },
  { pattern: "/admin/analytics" },
  { pattern: "/admin/organizations" },
  { pattern: "/admin/organizations/directory" },
  { pattern: "/admin/organizations/import" },
  { pattern: "/admin/organizations/map-locations" },
  { pattern: "/admin/organizations/[organizationId]/billing" },
  { pattern: "/admin/organizations/[organizationId]/church-clubs" },
  { pattern: "/admin/organizations/[organizationId]/location" },
  { pattern: "/admin/organizations/[organizationId]/pastor" },
  { pattern: "/admin/email" },
  { pattern: "/admin/feature-requests" },
  { pattern: "/admin/people" },
  { pattern: "/admin/people/[kind]/[id]" },
  { pattern: "/people" },
  { pattern: "/people/matches" },
  { pattern: "/admin/pauses" },
  { pattern: "/more/event-content" },
  { pattern: "/admin/readiness" },
  { pattern: "/admin/settings" },
  { pattern: "/admin/system-report" },
  { pattern: "/people/attendees" },
  { pattern: "/more/attendee-configuration" },
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
