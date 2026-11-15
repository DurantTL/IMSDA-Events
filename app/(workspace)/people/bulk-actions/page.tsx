import type { Metadata } from "next";
import { AccessRestricted } from "@/components/access-restricted";
import { AdminPageHeader } from "@/components/admin-page-header";
import { BulkActionsPanel } from "@/components/bulk-actions-panel";
import { BulkMessageApprovals } from "@/components/bulk-message-approvals";
import { PageHeader } from "@/components/page-header";
import { BULK_ACTION_CATALOG, EXPORT_FIELDS, canonicalBulkQuery, describeQueryFilters } from "@/modules/bulk-actions/domain";
import { listMessageApprovals } from "@/modules/bulk-actions/message-approvals";
import { listRecentBulkActions } from "@/modules/bulk-actions/repository";
import { selectedAudienceTemplateKeys, selectedAudienceTemplateLabels } from "@/modules/communications/selected-audience-templates";
import { resolveEventContext } from "@/modules/events/selection";
import { pickSearchParams } from "@/modules/registrations/operations-search-domain";
import { enumerateOperationsRegistrationIds } from "@/modules/registrations/operations-search-repository";
import { listActiveTags, listTags } from "@/modules/tags/repository";

export const metadata: Metadata = { title: "Bulk actions" };
export const dynamic = "force-dynamic";

/**
 * Bulk actions on the registrations the People list is showing (#182). The scope is the whole current filter, counted
 * here by the same search the list uses; a page selection is never widened to it. Nothing changes on this page until a
 * preview has been read and confirmed, and the server checks every permission again at that point.
 */
export default async function BulkActionsPage({ searchParams }: { searchParams: Promise<{ event?: string; [key: string]: string | string[] | undefined }> }) {
  const rawParams = await searchParams;
  const { event, permissions } = await resolveEventContext(rawParams.event as string | undefined);
  if (!permissions.includes("VIEW_SENSITIVE_DATA")) {
    return <AccessRestricted title="Bulk actions are restricted" detail="Your event role does not include access to registration records." whoToAsk="your event administrator" />;
  }
  const { queryString, issues } = canonicalBulkQuery(pickSearchParams(rawParams).toString());
  const found = await enumerateOperationsRegistrationIds({ eventId: event.id, permissions }, new URLSearchParams(queryString), undefined, issues);
  const canTag = permissions.includes("MANAGE_REGISTRATION");
  const canExport = permissions.includes("VIEW_REPORTS") && permissions.includes("VIEW_SENSITIVE_DATA");
  const canMessage = permissions.includes("MANAGE_COMMUNICATIONS");
  const [tags, removableTags, recent, approvals] = await Promise.all([
    canTag ? listActiveTags(event.id) : Promise.resolve([]),
    canTag ? listTags(event.id) : Promise.resolve([]),
    listRecentBulkActions(event.id, 10),
    canMessage ? listMessageApprovals({ eventId: event.id, userId: "", permissions }) : Promise.resolve(null),
  ]);
  const carryNotes = String(Array.isArray(rawParams.notCarried) ? rawParams.notCarried[0] : rawParams.notCarried ?? "").split(",").filter((note) => note === "quick filter" || note === "form answer filter");
  const exportFields = EXPORT_FIELDS.filter((field) => field.permissions.some((needed) => permissions.includes(needed))).map((field) => ({ key: field.key, label: field.label, personal: field.personal }));
  const peopleHref = `/people${queryString ? `?${queryString}&` : "?"}event=${encodeURIComponent(event.id)}`;
  return <>
    <AdminPageHeader path="/people/bulk-actions" eventId={event.id} />
    <section className="page-stack">
      <PageHeader
        title="Bulk actions"
        description="Apply or remove a tag, export chosen fields, or queue a message or an information request for the registrations in the current filter. You review a preview first, then confirm. A message is never sent when you confirm: someone with communications access approves it first."
        actions={<li><a href={peopleHref}>Back to registrations</a></li>}
      />
      <BulkActionsPanel
        eventId={event.id}
        queryString={queryString}
        total={found.ok ? found.total : null}
        scopeProblem={found.ok ? null : (found.issues[0]?.message ?? "This filter cannot be used for a bulk action.")}
        filters={describeQueryFilters(queryString, { showText: true })}
        tags={tags.map((tag) => ({ id: tag.id, name: tag.name }))}
        removableTags={removableTags.map((tag) => ({ id: tag.id, name: tag.name, isActive: tag.isActive }))}
        peopleHref={peopleHref}
        notCarried={carryNotes}
        canTag={canTag}
        canExport={canExport}
        canMessage={canMessage}
        templateChoices={selectedAudienceTemplateKeys.map((key) => ({ key, label: selectedAudienceTemplateLabels[key] }))}
        selectionTicked={String(Array.isArray(rawParams.selection) ? rawParams.selection[0] : rawParams.selection ?? "") === "ticked"}
        exportFields={exportFields}
        hiddenFieldCount={EXPORT_FIELDS.length - exportFields.length}
        limits={{ tag: BULK_ACTION_CATALOG.APPLY_TAG.maxRecords, export: BULK_ACTION_CATALOG.EXPORT_FIELDS.maxRecords, message: BULK_ACTION_CATALOG.QUEUE_MESSAGE.maxRecords }}
        recent={recent}
      />
      {approvals && <BulkMessageApprovals eventId={event.id} pending={approvals.pending} decided={approvals.decided} />}
    </section>
  </>;
}
