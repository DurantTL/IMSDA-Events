import type { Metadata } from "next";
import { AccessRestricted } from "@/components/access-restricted";
import { MealsWorkspace } from "@/components/meals-workspace";
import { staffPageTitles } from "@/components/staff-navigation";
import { resolveEventContext } from "@/modules/events/selection";
import { loadMealView } from "@/modules/meals/view-repository";

export const metadata: Metadata = { title: staffPageTitles.meals };

export default async function MealsPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const { event: requested } = await searchParams;
  const { event, permissions } = await resolveEventContext(requested);
  // Authorization is decided here on the server, and again by every API route the screen calls.
  if (!permissions.includes("CONFIGURE_EVENT")) {
    return <AccessRestricted title="Meals are restricted" detail="Event administrators can set up meal services and plans for this event." />;
  }
  const view = await loadMealView(event.id);
  return (
    <MealsWorkspace
      eventId={event.id}
      eventName={event.name}
      initialView={view}
      canManageFinance={permissions.includes("MANAGE_FINANCE")}
      canExport={permissions.includes("VIEW_REPORTS")}
    />
  );
}
