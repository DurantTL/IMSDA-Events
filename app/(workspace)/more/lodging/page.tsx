import type { Metadata } from "next";
import { AccessRestricted } from "@/components/access-restricted";
import { LodgingViewsStrip } from "@/components/lodging-views-strip";
import { LodgingWorkspace } from "@/components/lodging-workspace";
import { staffPageTitles } from "@/components/staff-navigation";
import { resolveEventContext } from "@/modules/events/selection";
import { lodgingViewAccess } from "@/modules/lodging/lodging-views-model";
import { getLodgingView } from "@/modules/lodging/service";

export const metadata: Metadata = { title: staffPageTitles.lodging };

export default async function LodgingPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const { event: requested } = await searchParams;
  const { event, permissions } = await resolveEventContext(requested);
  // The strip lists only the pages this viewer passes the same check for (#1578).
  const strip = <LodgingViewsStrip access={lodgingViewAccess(permissions)} current="inventory" eventId={event.id} />;
  // Authorization is decided here on the server, and again by every API route the screen calls.
  if (!permissions.includes("CONFIGURE_EVENT")) {
    return <>{strip}<AccessRestricted title="Lodging is restricted" detail="Event administrators can review and set up lodging inventory for this event." whoToAsk="your event administrator" /></>;
  }
  const view = await getLodgingView(event.id);
  return <>{strip}<LodgingWorkspace eventName={event.name} initialView={view} canSetRates={permissions.includes("MANAGE_FINANCE")} canSeeRegistrationPages={permissions.includes("MANAGE_REGISTRATION")} /></>;
}
