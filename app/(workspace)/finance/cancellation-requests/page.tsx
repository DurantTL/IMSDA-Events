import type { Metadata } from "next";
import { AccessRestricted } from "@/components/access-restricted";
import { CancellationRequestsWorkspace } from "@/components/cancellation-requests-workspace";
import { getCarryOutPanel } from "@/modules/cancellation-execution/repository";
import { statusFilterSchema } from "@/modules/cancellation-requests/domain";
import { getCancellationRequestDetail, listCancellationRequests } from "@/modules/cancellation-requests/repository";
import { resolveEventContext } from "@/modules/events/selection";

export const metadata: Metadata = { title: "Cancellation requests" };

/**
 * The staff queue for registrants' cancellation requests (#170). MANAGE_FINANCE on the event, like the rules page. It
 * loads nothing for anyone without it. Deciding a request records the decision only; it cancels and refunds nothing.
 * Carrying an approved request out (#171) is a separate, named staff action in the workspace.
 */
export default async function CancellationRequestsPage({ searchParams }: { searchParams: Promise<{ event?: string; status?: string; request?: string }> }) {
  const { event: requested, status, request: requestId } = await searchParams;
  const { event, permissions } = await resolveEventContext(requested);
  if (!permissions.includes("MANAGE_FINANCE")) {
    return <AccessRestricted title="Finance is restricted" detail="Only event administrators and finance managers can review cancellation requests." />;
  }
  const filter = statusFilterSchema.catch("OPEN").parse(status);
  const [rows, detail] = await Promise.all([
    listCancellationRequests(event.id, filter),
    requestId ? getCancellationRequestDetail(event.id, requestId) : Promise.resolve(null),
  ]);
  // Only an approved request can be carried out; the panel is read-only and carries nothing out.
  const carryOut = detail?.status === "APPROVED" ? await getCarryOutPanel(event.id, detail.id) : null;
  return (
    <CancellationRequestsWorkspace
      carryOut={carryOut}
      detail={detail}
      eventId={event.id}
      eventName={event.name}
      filter={filter}
      rows={rows}
      timezone={event.timezone}
    />
  );
}
