import { safeReturnTo } from "@/lib/return-to";
import { clubSummaryAnchors, clubSummaryHref } from "@/modules/club-reports/club-directory-domain";
import type { HubCard } from "@/modules/system-admin/admin-hubs-model";

/**
 * Links around the selected club page (#1587): pure, no database access, no authorization of its own beyond the gate it
 * is handed. A `from` is only ever followed when it rebuilds to one of the two known parents (the club directory, or the
 * club's own page), from whitelisted parts; anything else (another host, another path, an API route, an unknown view)
 * is dropped and the page's default back link is used.
 */
const CLUB_YEAR = /^\d{4}-\d{2}$/;
const DIRECTORY_PATH = "/admin/clubs/summary";
const MAX_PAGE = 1000;
const PLACEHOLDER_ORIGIN = "https://same-site.invalid";

/**
 * Parses a same-site relative path. Only the path part is run through `safeReturnTo` (so an external URL, a protocol-relative
 * URL, a backslash or an API route is refused); the query is never trusted as is, callers rebuild from whitelisted parts, so
 * a search such as "100%" or "a//b" inside it does not lose the return.
 */
function parseSafe(from: string | null | undefined): URL | null {
  if (typeof from !== "string" || from.length === 0) return null;
  const queryAt = from.indexOf("?");
  const pathPart = queryAt === -1 ? from : from.slice(0, queryAt);
  if (safeReturnTo(pathPart, "") !== pathPart) return null;
  try {
    const url = new URL(from, PLACEHOLDER_ORIGIN);
    return url.origin === PLACEHOLDER_ORIGIN && url.pathname === pathPart ? url : null;
  } catch {
    return null;
  }
}

/** The directory URL a club page may go back to: `/admin/clubs/summary` with year, search, filter and page, rebuilt; else null. */
export function directoryReturnHref(from: string | null | undefined): string | null {
  const url = parseSafe(from);
  if (!url || url.pathname !== DIRECTORY_PATH) return null;
  const params = url.searchParams;
  const view = params.get("view");
  if (view !== null && view !== "directory") return null;
  const clubYear = params.get("year");
  if (!clubYear || !CLUB_YEAR.test(clubYear)) return null;
  const page = Number(params.get("page") ?? 1);
  return clubSummaryHref({
    clubYear,
    query: (params.get("q") ?? "").trim().slice(0, 80),
    attention: params.get("attention") === "needs-attention",
    page: Number.isInteger(page) && page >= 1 && page <= MAX_PAGE ? page : 1,
  });
}

/** The selected club's page, with its year and, when it was opened from the directory, the way back to that exact directory view. */
export function clubPageHref(organizationId: string, clubYear: string, directoryHref?: string | null): string {
  const params = new URLSearchParams({ year: clubYear });
  if (directoryHref) params.set("from", directoryHref);
  return `/admin/organizations/${encodeURIComponent(organizationId)}/club?${params.toString()}`;
}

/**
 * The club page a directors, profile or report page may go back to: this club's own page only, with a valid year and a valid
 * directory `from` kept, rebuilt. A bare `/admin/organizations/<id>/club` (the link every page used before the year was carried) still works.
 */
export function clubPageReturnHref(from: string | null | undefined, organizationId: string): string | null {
  const url = parseSafe(from);
  const path = `/admin/organizations/${encodeURIComponent(organizationId)}/club`;
  if (!url || url.pathname !== path) return null;
  const clubYear = url.searchParams.get("year");
  if (!clubYear || !CLUB_YEAR.test(clubYear)) return path;
  return clubPageHref(organizationId, clubYear, directoryReturnHref(url.searchParams.get("from")));
}

/** What the viewer may open. Both gates are checked again by each target page; this only hides what they could not reach. */
export type ClubLinksViewer = {
  /** `canAdministerClubOrganization` for this club: directors, profile and honors. */
  canAdministerClub: boolean;
  /** `hasClubsAdministration`: the Club summary's Monthly Records. */
  clubsAdministration: boolean;
};

/**
 * The "This club" cards: the destinations the page already linked, in the hub card shape. Plain descriptions, no status
 * (no read on this page supplies one), so nothing here can show a number that was not read. A card the viewer could not
 * open is left out; one to four cards, so the row always fills.
 */
export function clubRelatedCards(input: { organizationId: string; clubName: string; clubActive?: boolean; clubYear: string; directoryHref?: string | null; viewer: ClubLinksViewer }): HubCard[] {
  const { organizationId, clubName, clubYear, viewer } = input;
  const id = encodeURIComponent(organizationId);
  const from = encodeURIComponent(clubPageHref(organizationId, clubYear, input.directoryHref));
  const cards: HubCard[] = [];
  if (viewer.canAdministerClub) {
    cards.push({ href: `/admin/organizations/${id}/directors?from=${from}`, title: "Club admins", description: "Who can sign in to run this club as its director.", status: null });
    cards.push({ href: `/admin/organizations/${id}/profile?from=${from}`, title: "Club profile", description: "The club's name, sponsoring church and contact details.", status: null });
    cards.push({ href: `/admin/organizations/${id}/club/honors?year=${encodeURIComponent(clubYear)}`, title: "Honors", description: "Honors this club's members have earned. View only.", status: null });
  }
  // The records view lists active clubs only, so an inactive club would not be found there: no card.
  if (viewer.clubsAdministration && input.clubActive !== false) {
    cards.push({
      href: `${clubSummaryHref({ clubYear, view: "records", query: clubName })}#${clubSummaryAnchors.records}`,
      title: "Monthly Records",
      description: "This club's monthly reports for the club year, found by its name.",
      status: null,
    });
  }
  return cards;
}
