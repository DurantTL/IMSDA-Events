import type { Metadata } from "next";
import { AccessRestricted } from "@/components/access-restricted";
import { AdminHub } from "@/components/admin-hub";
import { staffPageTitles } from "@/components/staff-navigation";
import { resolveEventContext } from "@/modules/events/selection";
import { buildPrintoutsView } from "@/modules/reporting/printouts-model";
import { loadPrintoutAvailability } from "@/modules/reporting/printouts-repository";

export const metadata: Metadata = { title: staffPageTitles.printouts };
export const dynamic = "force-dynamic";

/**
 * The event's printouts and packets as grouped cards (#1583). VIEW_REPORTS is checked here on the server, like every report
 * page, and each card is shown only when the viewer passes the same check its own page makes. Everything on the page is a
 * link: nothing here prints, downloads or changes a record.
 */
export default async function PrintoutsPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const { event: requested } = await searchParams;
  const { event, permissions } = await resolveEventContext(requested);
  if (!permissions.includes("VIEW_REPORTS")) {
    return <AccessRestricted title="Printouts are restricted" detail="This page needs report access." whoToAsk="your event administrator" />;
  }
  const availability = await loadPrintoutAvailability(event.id);
  const viewer = { permissions, audience: event.audience, ...availability };
  return <AdminHub view={buildPrintoutsView(viewer, event.id)} />;
}
