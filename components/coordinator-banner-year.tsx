"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { YearBox } from "@/components/club-banner-year";
import { resolveAreaClubYear } from "@/modules/club-reports/area-club-year";
import { clubYearFor } from "@/modules/club-rosters/domain";

const dash = (year: string) => year.replace("-", "–");

/** The coordinator pages that read `?year=` (Overview, Monthly Records, Points, Club events); every other page shows the current club year. */
const YEAR_PAGES = /^\/account\/area-clubs\/(overview|reports|points|events)(\/|$)/;

/**
 * What the coordinator banner's year box says. Coordinator pages accept any "YYYY-YY" `?year=` (`resolveAreaClubYear`), unlike a club's
 * read-only roster years (`rosterYearView`), so the box uses that same rule and never contradicts the page under it.
 */
export function coordinatorBannerYearLabel(pathname: string | null, years: string[], now = new Date()) {
  const current = clubYearFor(now);
  const clubYear = pathname && YEAR_PAGES.test(pathname) && years.length === 1 ? resolveAreaClubYear(years[0], now) : current;
  return { label: clubYear === current ? "Current club year" : "Viewing", value: dash(clubYear) };
}

function YearFromUrl() {
  const { label, value } = coordinatorBannerYearLabel(usePathname(), useSearchParams().getAll("year"));
  return <YearBox label={label} value={value} />;
}

/** The club year in the coordinator banner, like the club banner's year box (#1555). */
export function CoordinatorBannerYear({ currentYear }: { currentYear: string }) {
  return (
    <Suspense fallback={<YearBox label="Current club year" value={dash(currentYear)} />}>
      <YearFromUrl />
    </Suspense>
  );
}
