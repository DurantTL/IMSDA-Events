import type { Metadata } from "next";
import Link from "next/link";
import { AccessRestricted } from "@/components/access-restricted";
import { MealCloseout } from "@/components/meal-closeout";
import { staffPageTitles } from "@/components/staff-navigation";
import { resolveEventContext } from "@/modules/events/selection";
import { loadMealCloseout } from "@/modules/meals/closeout-repository";

export const metadata: Metadata = { title: staffPageTitles.mealCloseout };

/**
 * Meal money closeout (#212). MANAGE_FINANCE only, checked on the server: it holds amounts, so the Kitchen staff role and
 * report-only roles cannot open it, and nothing on the page links out to registrations or people. It reads the meal
 * ledger and counts as they are and records reviews of exceptions; it moves no money.
 */
export default async function MealCloseoutPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const requested = Array.isArray(params.event) ? params.event[0] : params.event;
  const { event, permissions } = await resolveEventContext(requested, { allowWithoutEventView: true });
  if (!permissions.includes("MANAGE_FINANCE")) {
    return <AccessRestricted title="The meal closeout is restricted" detail="Your event role does not include finance access." />;
  }
  const closeout = await loadMealCloseout(event.id);
  const base = `/api/events/${encodeURIComponent(event.id)}/exports/meals-closeout`;
  return (
    <section className="page-stack meal-closeout-page">
      <div className="page-intro">
        <div>
          <p className="eyebrow" translate="no">{event.name}</p>
          <h2>Meal closeout</h2>
          <p>
            Meal charges, credits, conference billing and walk-up orders beside what was ordered, served and prepared, with every difference listed.
            {permissions.includes("VIEW_REPORTS") && <> <Link href={`/more/kitchen-report?event=${encodeURIComponent(event.id)}`}>Back to the kitchen report</Link></>}
          </p>
        </div>
      </div>
      <MealCloseout eventId={event.id} closeout={closeout} csvHref={base} exceptionsCsvHref={`${base}?part=exceptions`} />
    </section>
  );
}
