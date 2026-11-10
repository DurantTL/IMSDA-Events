import type { Metadata } from "next";
import { AccessRestricted } from "@/components/access-restricted";
import { KitchenCountsEntry, type KitchenEntryService } from "@/components/kitchen-counts-entry";
import { KitchenCountsTable } from "@/components/kitchen-counts-table";
import { MealsViewsStrip } from "@/components/meals-views-strip";
import { StaffPageHeader } from "@/components/staff-page-header";
import { staffPageTitles } from "@/components/staff-navigation";
import { resolveEventContext } from "@/modules/events/selection";
import { kitchenCountKinds } from "@/modules/meals/kitchen-counts";
import { loadKitchenCountsReport } from "@/modules/meals/kitchen-counts-repository";
import { eventLocalDateTime } from "@/modules/meals/scanner-import";
import { firstParam } from "@/lib/search-params";

export const metadata: Metadata = { title: staffPageTitles.kitchenCounts };

/**
 * Kitchen counts (#1029). MANAGE_KITCHEN_COUNTS enters and corrects counts; report viewers (VIEW_REPORTS) may read the table.
 * The page holds counts and staff names only, no registrations or people, which is why the Kitchen staff role can open it.
 */
export default async function KitchenCountsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const requested = firstParam(params.event);
  const { event, permissions } = await resolveEventContext(requested, { allowWithoutEventView: true });
  const canEnter = permissions.includes("MANAGE_KITCHEN_COUNTS");
  // The strip lists only the pages this viewer passes the same check for (#1579); kitchen-only staff get one view, so no strip.
  const strip = <MealsViewsStrip current="counts" eventId={event.id} permissions={permissions} />;
  if (!canEnter && !permissions.includes("VIEW_REPORTS")) {
    return <>{strip}<AccessRestricted title="Kitchen counts are restricted" detail="Your event role does not include kitchen counts." whoToAsk="your event administrator" /></>;
  }
  const report = await loadKitchenCountsReport(event.id);
  const services: KitchenEntryService[] = report.rows.map((row) => ({
    key: row.key, label: row.label, ordered: row.ordered, served: row.served,
    cells: Object.fromEntries(kitchenCountKinds.flatMap((kind) => {
      const cell = row.counts[kind];
      return cell ? [[kind, {
        quantity: cell.quantity, note: cell.note ?? "", entryId: cell.entryId,
        byline: `Entered by ${cell.enteredBy}, ${eventLocalDateTime(new Date(cell.enteredAt), report.timeZone)}.`,
      }]] : [];
    })),
  }));
  return (
    <>
      {strip}
      <section className="page-stack kitchen-counts-page">
      <StaffPageHeader description={canEnter ? "Enter what the kitchen prepared, wasted, donated and transferred for each meal service." : "What the kitchen prepared, wasted, donated and transferred for each meal service."} />
      {firstParam(params.restricted) === "1" && (
        <div className="inline-notice" role="status">
          The page you opened is not part of the Kitchen staff role, so Kitchen counts opened instead. Ask your event administrator if you need access to more of this event.
        </div>
      )}
      {canEnter && <KitchenCountsEntry eventId={event.id} services={services} />}
      <KitchenCountsTable report={report} timeZone={report.timeZone} csvHref={`/api/events/${encodeURIComponent(event.id)}/exports/kitchen-counts`} />
      </section>
    </>
  );
}
