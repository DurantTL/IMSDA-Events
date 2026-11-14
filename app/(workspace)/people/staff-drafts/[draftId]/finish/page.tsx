import type { Metadata } from "next";
import Link from "next/link";
import { AccessRestricted } from "@/components/access-restricted";
import { NotAvailableForEvent } from "@/components/not-available-for-event";
import { PublicRegistrationForm, type FormResponses } from "@/components/public-registration-form";
import { PAPER_LOCATION_HELP } from "@/modules/acknowledgments/domain";
import { resolveEventContext } from "@/modules/events/selection";
import { STAFF_DRAFT_SOURCE_LABELS } from "@/modules/staff-registration-drafts/domain";
import { getStaffFinishView } from "@/modules/staff-registration-drafts/repository";

export const metadata: Metadata = { title: "Finish a registration for someone" };
export const dynamic = "force-dynamic";

function serializeDate(value: Date | string) {
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * Staff finish a phone, paper or walk-in registration themselves (#1510): the ordinary public form, prefilled from the draft,
 * submitted through the staff endpoint. Acknowledgments are recorded as entered by staff or from the paper form, never as the
 * registrant's own online consent. A closed, not-yet-open or full event needs the override permission and a reason.
 */
export default async function FinishStaffDraftPage({
  params,
  searchParams,
}: {
  params: Promise<{ draftId: string }>;
  searchParams: Promise<{ event?: string }>;
}) {
  const [{ draftId }, { event: requested }] = await Promise.all([params, searchParams]);
  const { event, permissions } = await resolveEventContext(requested);
  if (!permissions.includes("MANAGE_REGISTRATION")) {
    return (
      <AccessRestricted
        title="Phone and paper registrations are restricted"
        detail="Only event administrators and registration managers can send a registration for someone."
        whoToAsk="your event administrator"
      />
    );
  }
  if (event.audience !== "GENERAL") {
    return <NotAvailableForEvent reason="Phone and paper registrations are for events open to individuals, not club events." />;
  }
  const returnHref = `/people/staff-drafts?event=${encodeURIComponent(event.id)}`;
  const canOverride = permissions.includes("OVERRIDE_REGISTRATION_RULES");
  const view = await getStaffFinishView(event.id, draftId, canOverride);
  if (view.kind === "MESSAGE") {
    return (
      <section className="page-stack">
        <div className="page-intro">
          <div>
            <p className="eyebrow">Registration</p>
            <h2>Finish a registration for someone</h2>
            <p role="status">{view.message}</p>
            <p><Link className="text-button" href={returnHref}>Phone and paper registrations</Link></p>
          </div>
        </div>
      </section>
    );
  }
  const { experience } = view;
  return (
    <section className="page-stack">
      <PublicRegistrationForm
        event={{
          ...experience.event,
          startsAt: serializeDate(experience.event.startsAt),
          endsAt: serializeDate(experience.event.endsAt),
        }}
        form={experience.form}
        choiceUsage={experience.choiceUsage}
        pricingDate={experience.pricingDate}
        lifecycle={experience.lifecycle}
        lodging={experience.lodging}
        merchandise={experience.merchandise}
        initialResponses={view.responses as FormResponses}
        initialAttendeeResponses={{}}
        disableDrafts
        staffSubmit={{
          submitUrl: `/api/events/${encodeURIComponent(event.id)}/staff-registration-drafts/${encodeURIComponent(draftId)}/submit`,
          sourceLabel: STAFF_DRAFT_SOURCE_LABELS[view.draft.source],
          source: view.draft.source,
          paperLocationHelp: PAPER_LOCATION_HELP,
          canOverride,
          overrideRule: view.overrideRule,
          returnHref,
          returnLabel: "Phone and paper registrations",
        }}
      />
    </section>
  );
}
