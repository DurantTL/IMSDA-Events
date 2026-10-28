import { clubsAdminYearPaths } from "@/components/staff-navigation";
import { clubYearFor, clubYearOptions } from "@/modules/club-rosters/domain";

const CLUB_YEAR = /^\d{4}-\d{2}$/;

/** `?year=` when it is a club year like "2026-27", else `null`: the same test as `resolveAreaClubYear`, which is server-only. */
export function requestedClubYear(value: string | null | undefined): string | null {
  return value && CLUB_YEAR.test(value) ? value : null;
}

/**
 * The Clubs sidebar's club-year picker (#1245): where the form goes, the years to choose from and the one selected.
 * A page that reads `?year=` stays where it is, keeping its search, sort, report view and attention filter; any other page goes to the dashboard. The selected year is the valid
 * `?year=`, else the current club year, as `resolveAreaClubYear` decides for the pages.
 */
export function clubYearSelectorModel(pathname: string, requestedYear: string | null | undefined, now: Date, params?: { get(name: string): string | null }) {
  const requested = requestedClubYear(requestedYear);
  const selected = requested ?? clubYearFor(now);
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const stays = clubsAdminYearPaths.includes(path);
  // Directory/report selections ride along only when returning to this page; a new year starts at page one.
  const carry = stays ? (["q", "sort", "view", "attention"] as const).flatMap((name) => { const value = params?.get(name); return value ? [[name, value] as const] : []; }) : [];
  return {
    action: stays ? path : "/admin/clubs",
    carry,
    selected,
    /** The year the year-aware sidebar links carry: only one the URL actually has. */
    linkYear: requested,
    options: clubYearOptions(selected, now),
  };
}
