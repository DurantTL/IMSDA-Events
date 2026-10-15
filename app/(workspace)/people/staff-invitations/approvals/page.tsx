import type { Metadata } from "next";
import Link from "next/link";
import { AccessRestricted } from "@/components/access-restricted";
import { StaffApprovalQueue } from "@/components/staff-approval-queue";
import { resolveEventContext } from "@/modules/events/selection";
import { listApprovals } from "@/modules/staff-invitations/repository";

export const metadata: Metadata = { title: "Staff registrations waiting for approval" };

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
      />
    );
  }
  if (event.audience !== "GENERAL") {
    return (
      <AccessRestricted
        title="Staff invitations aren't used for club events"
        detail="Personal staff, pastor and volunteer links are for events that are open to everyone."
      />
    );
  }
  const approvals = await listApprovals(event.id);
  return (
    <section className="page-stack">
      <div className="page-intro">
        <div>
          <p className="eyebrow">Registration</p>
          <h2>Staff registrations waiting for approval</h2>
          <p>
            People who registered for {event.name} through their personal link. Until you approve a registration it is not confirmed and is
            in no count, report or room list. Approve them together when you assign housing. Their price is $0, and approving covers every
            person&rsquo;s meals under the conference-paid plan.
          </p>
        </div>
        <div className="page-intro-actions">
          <Link className="secondary-button" href={`/people/staff-invitations?event=${encodeURIComponent(event.id)}`}>Back to the invite list</Link>
        </div>
      </div>
      <StaffApprovalQueue counts={approvals.counts} eventId={event.id} rows={approvals.rows} />
    </section>
  );
}
