import { clubsAdminYearPaths } from "@/components/staff-navigation";
import { clubYearFor, clubYearOptions } from "@/modules/club-rosters/domain";

const CLUB_YEAR = /^\d{4}-\d{2}$/;

/** `?year=` when it is a club year like "2026-27", else `null`: the same test as `resolveAreaClubYear`, which is server-only. */
export function requestedClubYear(value: string | null | undefined): string | null {
  return value && CLUB_YEAR.test(value) ? value : null;
}

/**
 * The Clubs sidebar's club-year picker (#1245): where the form goes, the years to choose from and the one selected.
 * A page that reads `?year=` stays where it is; any other page goes to the dashboard. The selected year is the valid
 * `?year=`, else the current club year, as `resolveAreaClubYear` decides for the pages.
 */
export function clubYearSelectorModel(pathname: string, requestedYear: string | null | undefined, now: Date) {
  const requested = requestedClubYear(requestedYear);
  const selected = requested ?? clubYearFor(now);
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return {
    action: clubsAdminYearPaths.includes(path) ? path : "/admin/clubs",
    selected,
    /** The year the year-aware sidebar links carry: only one the URL actually has. */
    linkYear: requested,
    options: clubYearOptions(selected, now),
  };
}
