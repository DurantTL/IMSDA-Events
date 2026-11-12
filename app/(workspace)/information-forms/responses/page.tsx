import { staffPageTitles } from "@/components/staff-navigation";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccessRestricted } from "@/components/access-restricted";
import { informationFormPageViews } from "@/components/form-page-views";
import { PageHeader } from "@/components/page-header";
import { eventInformationConfig, informationListHref } from "@/components/registration-builder/information-mode";
import { getCurrentSession } from "@/modules/access/current-session";
import { InformationFormResponsesView } from "@/components/information-form-responses-view";
import { resolveEventContext } from "@/modules/events/selection";
import { parseFormsHubReturn } from "@/modules/forms-hub/return";
import { loadInformationFormResponsesPage } from "@/modules/information-forms/responses-page";

export const metadata: Metadata = { title: staffPageTitles.formResponses };
export const dynamic = "force-dynamic";

/** The responses of an event's information form (#1150): MANAGE_FORMS on the event, like the event form APIs. */
export default async function EventInformationFormResponsesPage({ searchParams }: {
  searchParams: Promise<{ event?: string; form?: string; response?: string; cursor?: string; returnTo?: string }>;
}) {
  const { event: requested, form: formId, response, cursor, returnTo } = await searchParams;
  const { event, permissions } = await resolveEventContext(requested);
  if (!permissions.includes("MANAGE_FORMS")) {
    // The page draws its own title (#1572), so the restricted state keeps the page's one h1 too.
    return (
      <>
        <PageHeader title={staffPageTitles.formResponses} />
        <AccessRestricted title="Form responses are restricted" detail="Event administrators and registration managers can see the answers sent through an event's information forms." whoToAsk="your event administrator" />
      </>
    );
  }
  if (!formId) notFound();
  const data = await loadInformationFormResponsesPage({ scope: "EVENT", eventId: event.id }, formId, { responseId: response, cursor });
  if (!data) notFound();
  const { user } = await getCurrentSession();
  const config = eventInformationConfig(event, user?.globalRole === "SYSTEM_ADMIN");
  // "Back to All forms" only when the address came from the All forms list; it grants nothing (#1571).
  // Only a system administrator can open All forms, so only they get the link back to it (#1571).
  const hubBack = user?.globalRole === "SYSTEM_ADMIN" ? parseFormsHubReturn(returnTo) : null;
  const base = `/information-forms/responses?event=${encodeURIComponent(event.id)}&form=${encodeURIComponent(formId)}${hubBack ? `&returnTo=${encodeURIComponent(hubBack.href)}` : ""}`;
  return (
    <InformationFormResponsesView
      views={informationFormPageViews(config, formId, "responses")}
      back={hubBack ?? { href: informationListHref(config), label: "Back to information forms" }}
      closeHref={base}
      exportHref={`/api/events/${encodeURIComponent(event.id)}/information-forms/${encodeURIComponent(formId)}/responses/export`}
      membersExportHref={data.hasMemberList ? `/api/events/${encodeURIComponent(event.id)}/information-forms/${encodeURIComponent(formId)}/responses/export?format=members` : undefined}
      formName={data.name}
      nextHref={data.nextCursor ? `${base}&cursor=${encodeURIComponent(data.nextCursor)}` : null}
      rowHref={(id) => `${base}&response=${encodeURIComponent(id)}`}
      rows={data.rows}
      selected={data.selected}
      total={data.total}
    />
  );
}
