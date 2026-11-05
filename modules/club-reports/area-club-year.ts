import { clubYearFor } from "@/modules/club-rosters/domain";

/** `?year=` for the cross-club views: a club year like "2026-27", else the current one. Client-safe, so the coordinator banner shows the same year the page queries (#1555). */
export function resolveAreaClubYear(requested: string | undefined, now = new Date()) {
  return requested && /^\d{4}-\d{2}$/.test(requested) ? requested : clubYearFor(now);
}
