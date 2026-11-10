import type { Metadata } from "next";
import { AccessRestricted } from "@/components/access-restricted";
import { MealsViewsStrip } from "@/components/meals-views-strip";
import { MealsWorkspace } from "@/components/meals-workspace";
import { staffPageTitles } from "@/components/staff-navigation";
import { listMealPresetOptions } from "@/modules/event-content/repository";
import { resolveEventContext } from "@/modules/events/selection";
import { loadMealView } from "@/modules/meals/view-repository";

export const metadata: Metadata = { title: staffPageTitles.meals };

export default async function MealsPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const { event: requested } = await searchParams;
  const { event, permissions } = await resolveEventContext(requested);
  // Authorization is decided here on the server, and again by every API route the screen calls.
  const canConfigure = permissions.includes("CONFIGURE_EVENT");
  const canManageFinance = permissions.includes("MANAGE_FINANCE");
  const canExport = permissions.includes("VIEW_REPORTS");
  // The strip lists only the pages this viewer passes the same check for (#1579).
  const strip = <MealsViewsStrip current="meals" eventId={event.id} permissions={permissions} />;
  if (!canConfigure && !canManageFinance && !canExport) {
    return <>{strip}<AccessRestricted title="Meals are restricted" detail="Event administrators, finance staff and staff who view reports can open the meals screen for this event." whoToAsk="your event administrator" /></>;
  }
  const view = await loadMealView(event.id);
  // The seeded meal presets (#919) are described to everyone on an event with no meals; only finance staff get the button.
  const presets = view.services.length === 0 && view.plans.length === 0 ? await listMealPresetOptions() : [];
  return (
    <>
      {strip}
      <MealsWorkspace
        eventId={event.id}
        initialView={view}
        presets={presets}
        canConfigure={canConfigure}
        canManageFinance={canManageFinance}
        canExport={canExport}
      />
    </>
  );
}
