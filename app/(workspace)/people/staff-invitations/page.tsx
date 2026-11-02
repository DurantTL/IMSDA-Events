import type { Metadata } from "next";
import Link from "next/link";
import { AccessRestricted } from "@/components/access-restricted";
import { StaffInvitationImport } from "@/components/staff-invitation-import";
import { StaffInvitationList } from "@/components/staff-invitation-list";
import { resolveEventContext } from "@/modules/events/selection";
import { parseInvitationQuery } from "@/modules/staff-invitations/list-query";
import { listInvitations } from "@/modules/staff-invitations/repository";
import { NotAvailableForEvent } from "@/components/not-available-for-event";

export const metadata: Metadata = { title: "Staff invitations" };

/**
 * Personal staff, pastor and volunteer links (#804): import a CSV of email addresses, see each person's status, and send, resend,
 * copy, reissue or revoke their personal links. Registrations made through the links are approved on the next page.
 */
export default async function StaffInvitationsPage({ searchParams }: { searchParams: Promise<{ event?: string; status?: string; group?: string; q?: string; sort?: string; dir?: string; page?: string }> }) {
  const params = await searchParams;
  const requested = params.event;
  const { event, permissions } = await resolveEventContext(requested);
  if (!permissions.includes("MANAGE_REGISTRATION")) {
    return (
      <AccessRestricted
        title="Staff invitations are restricted"
        detail="Only event administrators and registration managers can create and manage personal registration links."
        whoToAsk="your event administrator"
      />
    );
  }
  if (event.audience !== "GENERAL") {
    return (
      <NotAvailableForEvent reason="Personal staff, pastor and volunteer links are for events that are open to everyone." />
    );
  }
  // Searched, filtered, ordered and paged in the database from the address (#1492).
  const query = parseInvitationQuery(params);
  const list = await listInvitations(event.id, query);
  return (
    <section className="page-stack">
      <div className="page-intro">
        <div>
          <p className="eyebrow">Registration</p>
          <h2>Staff, pastor and volunteer invitations</h2>
          <p>
            Each person you invite gets one personal link for {event.name}. It lets them register themselves and their immediate family
            (a spouse, and children or dependants up to age 18) at no charge. Registrations wait for your approval, which you give in one
            batch when you assign housing. A person always sends the invitation emails: importing a file never emails anyone. Links open
            once the event is published and stop working when it ends.
          </p>
        </div>
        <div className="page-intro-actions">
          <Link className="primary-button" href={`/people/staff-invitations/approvals?event=${encodeURIComponent(event.id)}`}>Waiting for approval</Link>
        </div>
      </div>
      <StaffInvitationImport eventId={event.id} />
      <StaffInvitationList
        canSend={permissions.includes("MANAGE_COMMUNICATIONS")}
        counts={list.counts}
        eventId={event.id}
        page={list.page}
        pageSize={list.pageSize}
        query={query}
        rows={list.rows}
        total={list.total}
        totalAll={list.totalAll}
      />
    </section>
  );
}
