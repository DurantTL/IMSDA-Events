import Link from "next/link";

/**
 * The roster page's prompt to start next year's roster (#414). Shown to a
 * club's director or deputy only (the page decides, and loads the counts) and
 * only while there are people to carry and the club hasn't confirmed. It never
 * changes anything; the director opens the checklist and confirms there.
 */
export function NextYearRosterOffer({
  organizationId,
  offer,
}: {
  organizationId: string;
  offer: { state: string; fromClubYear: string; toClubYear: string; candidates?: unknown[] } | null;
}) {
  if (!offer || offer.state !== "AVAILABLE") return null;
  const count = offer.candidates?.length ?? 0;
  return (
    <p className="inline-notice" role="status">
      {count} {count === 1 ? "person is" : "people are"} on the {offer.fromClubYear} roster and not yet on {offer.toClubYear}.{" "}
      <Link href={`/account/clubs/${organizationId}/roster/next-year`}>Start the {offer.toClubYear} roster</Link>.
    </p>
  );
}
