import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CoordinatorSectionHeading } from "@/components/coordinator-section-heading";
import { NavigationLink as Link } from "@/components/navigation-link";
import { TltStaffing } from "@/components/tlt-staffing";
import { logError } from "@/lib/logger";
import { StaffingError, assertStaffingAccess, requireTltDirectorStaffingActor } from "@/modules/event-staffing/access";
import { loadStaffingSheet } from "@/modules/event-staffing/repository";
import { listEventTlts } from "@/modules/event-staffing/tlt-director";
import { currentTltDirector } from "@/modules/tlt-directory/access";

export const metadata: Metadata = { title: "Assign TLTs", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

/**
 * One event's activities with the TLTs each needs, and the registered TLTs to choose from (#1678). The TLT director only; the
 * same "not found" for everyone else, for an event without the sheet, and for one she cannot see. Activities, leads and helpers
 * are not changed here: that stays with the event's Area Coordinators and administrators.
 */
export default async function TltStaffingEventPage({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!(await currentTltDirector())) notFound();
  const { eventId } = await params;
  const query = await searchParams;
  const one = (value: string | string[] | undefined) => (typeof value === "string" ? value.slice(0, 64) : Array.isArray(value) ? (value[0] ?? "").slice(0, 64) : "");
  const year = one(query.year);
  const filters = { tag: one(query.tag), club: one(query.club), year: ["1", "2", "3", "4"].includes(year) ? year : "" };
  const loaded = await (async () => {
    const actor = await requireTltDirectorStaffingActor();
    const event = await assertStaffingAccess(actor, eventId, "read");
    const [activities, options] = await Promise.all([loadStaffingSheet(eventId), listEventTlts(eventId)]);
    return { event, activities, options };
  })().catch((error: unknown) => {
    if (error instanceof StaffingError && ["EVENT_NOT_FOUND", "NOT_AVAILABLE", "MODULE_OFF"].includes(error.code)) return "missing" as const;
    logError("TLT staffing event read failed", error, { eventId });
    return null;
  });
  if (loaded === "missing") notFound();
  return (
    <section className="public-manage-card page-stack">
      <CoordinatorSectionHeading eyebrow="TLT staffing" title={loaded?.event.name ?? "Assign TLTs"}>
        <p>Put registered TLTs on this event&apos;s activities. Only TLTs registered for the event are listed. You can take a TLT off again.</p>
      </CoordinatorSectionHeading>
      <p><Link className="secondary-button" href="/account/area-clubs/tlt/staffing">Back to events</Link></p>
      {loaded === null ? (
        <p className="inline-notice error" role="alert">This event could not be loaded. Try again.</p>
      ) : (
        <TltStaffing basePath={`/account/area-clubs/tlt/staffing/${encodeURIComponent(eventId)}`} endpoint={`/api/attendee/area-clubs/tlt-staffing/${encodeURIComponent(eventId)}/assignments`} filters={filters} initialActivities={loaded.activities} options={loaded.options} />
      )}
    </section>
  );
}
