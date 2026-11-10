import type { Metadata } from "next";
import { AccessRestricted } from "@/components/access-restricted";
import { MealCloseout } from "@/components/meal-closeout";
import { MealsViewsStrip } from "@/components/meals-views-strip";
import { StaffPageHeader } from "@/components/staff-page-header";
import { staffPageTitles } from "@/components/staff-navigation";
import { resolveEventContext } from "@/modules/events/selection";
import { loadMealCloseout } from "@/modules/meals/closeout-repository";
import { firstParam } from "@/lib/search-params";

export const metadata: Metadata = { title: staffPageTitles.mealCloseout };

/**
 * Meal money closeout (#212). MANAGE_FINANCE only, checked on the server: it holds amounts, so the Kitchen staff role and
 * report-only roles cannot open it, and nothing on the page links out to registrations or people. It reads the meal
 * ledger and counts as they are and records reviews of exceptions; it moves no money.
 */
export default async function MealCloseoutPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const requested = firstParam(params.event);
  const { event, permissions } = await resolveEventContext(requested, { allowWithoutEventView: true });
  // The strip lists only the pages this viewer passes the same check for (#1579).
  const strip = <MealsViewsStrip current="closeout" eventId={event.id} permissions={permissions} />;
  if (!permissions.includes("MANAGE_FINANCE")) {
    return <>{strip}<AccessRestricted title="The meal closeout is restricted" detail="Your event role does not include finance access." whoToAsk="your event administrator" /></>;
  }
  const closeout = await loadMealCloseout(event.id);
  const base = `/api/events/${encodeURIComponent(event.id)}/exports/meals-closeout`;
  return (
    <>
      {strip}
      <section className="page-stack meal-closeout-page">
      <StaffPageHeader description="Meal charges, credits, conference billing and walk-up orders beside what was ordered, served and prepared, with every difference listed." />
      <MealCloseout eventId={event.id} closeout={closeout} csvHref={base} exceptionsCsvHref={`${base}?part=exceptions`} />
      </section>
    </>
  );
}
