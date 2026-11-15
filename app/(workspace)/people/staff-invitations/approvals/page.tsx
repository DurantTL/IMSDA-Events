import type { Metadata } from "next";
import Link from "next/link";
import { AccessRestricted } from "@/components/access-restricted";
import { StaffApprovalQueue } from "@/components/staff-approval-queue";
import { resolveEventContext } from "@/modules/events/selection";
import { listApprovals } from "@/modules/staff-invitations/repository";
import { NotAvailableForEvent } from "@/components/not-available-for-event";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Staff approvals" };

/**
 * The registrations made through personal staff, pastor and volunteer links (#804). They arrive waiting for the office and are
 * approved or declined together, normally when housing is assigned.
 */
export default async function StaffApprovalsPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const { event: requested } = await searchParams;
  const { event, permissions } = await resolveEventContext(requested);
  if (!permissions.includes("MANAGE_REGISTRATION")) {
    return (
      <AccessRestricted
        title="Staff registrations are restricted"
        detail="Only event administrators and registration managers can approve staff, pastor and volunteer registrations."
        whoToAsk="your event administrator"
      />
    );
  }
  if (event.audience !== "GENERAL") {
    return (
      <NotAvailableForEvent reason="Personal staff, pastor and volunteer links are for events that are open to everyone." />
    );
  }
  const approvals = await listApprovals(event.id);
  return (
    <section className="page-stack">
      <PageHeader
        title="Staff approvals"
        description={<>People who registered for {event.name} through their personal link; until you approve a registration it is not confirmed and is in no count, report or room list.</>}
        secondary={<Link className="secondary-button" href={`/people/staff-invitations?event=${encodeURIComponent(event.id)}`}>Back to the invite list</Link>}
      />
      <p className="quiet-copy">
        Approve them together when you assign housing. Their price is $0, and approving covers every person&rsquo;s meals under the
        conference-paid plan.
      </p>
      <StaffApprovalQueue counts={approvals.counts} eventId={event.id} rows={approvals.rows} />
    </section>
  );
}
