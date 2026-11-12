import type { Metadata } from "next";
import Link from "next/link";
import { AccessRestricted } from "@/components/access-restricted";
import { NotAvailableForEvent } from "@/components/not-available-for-event";
import { PageHeader } from "@/components/page-header";
import { RecognitionsWorkspace } from "@/components/recognitions-workspace";
import { staffPageTitles } from "@/components/staff-navigation";
import { getPrisma } from "@/lib/prisma";
import { isModuleEnabled } from "@/modules/event-modules/service";
import { resolveEventContext } from "@/modules/events/selection";
import { RECOGNITION_MODULE_KEY } from "@/modules/recognitions/domain";
import { loadRecognitionSummary } from "@/modules/recognitions/repository";

export const metadata: Metadata = { title: staffPageTitles.recognitions };
export const dynamic = "force-dynamic";

/**
 * Staff screen for the optional Recognitions tool (#1683): mark who earned a pin, patch or star, undo, and see the totals and the
 * per-club hand-out list. Marking and reading need MANAGE_REGISTRATION (the attendee tag permission) and listing a recognition
 * needs CONFIGURE_EVENT, checked here and again by every API route. The module switch only decides whether the tool is shown.
 */
export default async function RecognitionsPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const { event: requested } = await searchParams;
  const { event, permissions, user } = await resolveEventContext(requested);
  if (!permissions.includes("MANAGE_REGISTRATION")) {
    return (
      <>
        <PageHeader title={staffPageTitles.recognitions} />
        <AccessRestricted title="Recognitions are restricted" detail="Registration staff and event administrators mark the pins, patches and stars a club event gives." whoToAsk="your event administrator" />
      </>
    );
  }
  const row = await getPrisma().event.findUnique({ where: { id: event.id }, select: { audience: true } });
  if (row?.audience !== "CLUB") {
    return (
      <>
        <PageHeader title={staffPageTitles.recognitions} />
        <NotAvailableForEvent reason="This event doesn't take club registrations. Choose a club event to mark recognitions." />
      </>
    );
  }
  const enabled = await isModuleEnabled(event.id, RECOGNITION_MODULE_KEY);
  if (!enabled) {
    return (
      <>
        <PageHeader description="An optional tool for club events." title={staffPageTitles.recognitions} />
        <section className="page-stack">
          <div className="panel page-stack">
            <p role="status">Recognitions are off for this event.{" "}
              {user.globalRole === "SYSTEM_ADMIN"
                ? <Link className="text-button" href={`/more/features?event=${encodeURIComponent(event.id)}`}>Turn them on from the event features page</Link>
                : "A system administrator can turn them on from the event features page."}
            </p>
          </div>
        </section>
      </>
    );
  }
  const initial = await loadRecognitionSummary(event.id);
  return (
    <>
      <PageHeader description="Mark who earned a pin, patch or star, undo a mark, and see what to hand out for each club." title={staffPageTitles.recognitions} />
      <RecognitionsWorkspace canDefine={permissions.includes("CONFIGURE_EVENT")} eventId={event.id} initial={initial} />
    </>
  );
}
