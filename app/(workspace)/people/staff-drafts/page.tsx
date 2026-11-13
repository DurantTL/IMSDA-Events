import type { Metadata } from "next";
import { AccessRestricted } from "@/components/access-restricted";
import { NotAvailableForEvent } from "@/components/not-available-for-event";
import { StaffRegistrationDrafts } from "@/components/staff-registration-drafts";
import { resolveEventContext } from "@/modules/events/selection";
import { listStartableForms, listStaffDrafts } from "@/modules/staff-registration-drafts/repository";

export const metadata: Metadata = { title: "Phone and paper registrations" };

/**
 * Registrations staff start for someone by phone, on paper or at the door (#1510). A draft is not a registration: staff
 * enter what they know, check it with the public form's own rules, and send the registrant one private link to finish it.
 */
export default async function StaffDraftsPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const { event: requested } = await searchParams;
  const { event, permissions } = await resolveEventContext(requested);
  if (!permissions.includes("MANAGE_REGISTRATION")) {
    return (
      <AccessRestricted
        title="Phone and paper registrations are restricted"
        detail="Only event administrators and registration managers can start a registration for someone."
        whoToAsk="your event administrator"
      />
    );
  }
  if (event.audience !== "GENERAL") {
    return <NotAvailableForEvent reason="Phone and paper registrations are for events open to individuals, not club events." />;
  }
  const [drafts, forms] = await Promise.all([listStaffDrafts(event.id), listStartableForms(event.id)]);
  return (
    <section className="page-stack">
      <div className="page-intro">
        <div>
          <p className="eyebrow">Registration</p>
          <h2>Phone and paper registrations</h2>
          <p>
            Start a registration for someone who called, mailed a paper form or came to the door. The registrant finishes it, so
            their consents, signatures and health answers are theirs.
          </p>
        </div>
      </div>
      <StaffRegistrationDrafts eventId={event.id} eventName={event.name} initialDrafts={drafts} forms={forms} />
    </section>
  );
}
