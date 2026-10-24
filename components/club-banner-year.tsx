"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { rosterYearView } from "@/modules/club-rosters/domain";

const dash = (year: string) => year.replace("-", "–");

/** What the banner's year box says for a `?year=` value: the same validation the roster applies (`rosterYearView`), so a bad value is just the current year. */
export function clubBannerYearLabel(yearParam: string | null | undefined, now = new Date()) {
  const view = rosterYearView(yearParam ?? undefined, now);
  if (!view.readOnly) return { label: "Current club year", value: dash(view.clubYear) };
  if (view.clubYear === view.nextClubYear) return { label: "Next club year", value: `${dash(view.clubYear)} (read-only)` };
  return { label: "Viewing", value: `${dash(view.clubYear)} (read-only)` };
}

function YearBox({ label, value }: { label: string; value: string }) {
  return (
    <p className="club-banner-year">
      <span>{label}</span>
      <strong>{value}</strong>
    </p>
  );
}

function YearFromUrl() {
  // Match the page: rosterYearView only accepts a single year value, so a repeated ?year= means the current year.
  const years = useSearchParams().getAll("year");
  const { label, value } = clubBannerYearLabel(years.length === 1 ? years[0]! : null);
  return <YearBox label={label} value={value} />;
}

/** The club year in the banner: the current year, or the read-only past or next year the page was opened for with `?year=`. */
export function ClubBannerYear({ currentYear }: { currentYear: string }) {
  return (
    <Suspense fallback={<YearBox label="Current club year" value={dash(currentYear)} />}>
      <YearFromUrl />
    </Suspense>
  );
}
