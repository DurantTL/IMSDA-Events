import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccessRestricted } from "@/components/access-restricted";
import { InformationFormResponsesView } from "@/components/information-form-responses-view";
import { resolveEventContext } from "@/modules/events/selection";
import { loadInformationFormResponsesPage } from "@/modules/information-forms/responses-page";

export const metadata: Metadata = { title: "Form responses" };
export const dynamic = "force-dynamic";

/** The responses of an event's information form (#1150): MANAGE_FORMS on the event, like the event form APIs. */
export default async function EventInformationFormResponsesPage({ searchParams }: {
  searchParams: Promise<{ event?: string; form?: string; response?: string; cursor?: string }>;
}) {
  const { event: requested, form: formId, response, cursor } = await searchParams;
  const { event, permissions } = await resolveEventContext(requested);
  if (!permissions.includes("MANAGE_FORMS")) {
    return <AccessRestricted title="Form responses are restricted" detail="Event administrators and registration managers can see the answers sent through an event's information forms." />;
  }
  if (!formId) notFound();
  const data = await loadInformationFormResponsesPage({ scope: "EVENT", eventId: event.id }, formId, { responseId: response, cursor });
  if (!data) notFound();
  const base = `/information-forms/responses?event=${encodeURIComponent(event.id)}&form=${encodeURIComponent(formId)}`;
  return (
    <InformationFormResponsesView
      closeHref={base}
      exportHref={`/api/events/${encodeURIComponent(event.id)}/information-forms/${encodeURIComponent(formId)}/responses/export`}
      formName={data.name}
      nextHref={data.nextCursor ? `${base}&cursor=${encodeURIComponent(data.nextCursor)}` : null}
      rowHref={(id) => `${base}&response=${encodeURIComponent(id)}`}
      rows={data.rows}
      selected={data.selected}
      total={data.total}
    />
  );
}
