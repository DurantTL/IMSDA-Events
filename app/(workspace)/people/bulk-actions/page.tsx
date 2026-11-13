import type { Metadata } from "next";
import { AccessRestricted } from "@/components/access-restricted";
import { AdminPageHeader } from "@/components/admin-page-header";
import { BulkActionsPanel } from "@/components/bulk-actions-panel";
import { PageHeader } from "@/components/page-header";
import { BULK_ACTION_CATALOG, EXPORT_FIELDS, canonicalBulkQuery, describeQueryFilters } from "@/modules/bulk-actions/domain";
import { listRecentBulkActions } from "@/modules/bulk-actions/repository";
import { resolveEventContext } from "@/modules/events/selection";
import { pickSearchParams } from "@/modules/registrations/operations-search-domain";
import { enumerateOperationsRegistrationIds } from "@/modules/registrations/operations-search-repository";
import { listActiveTags } from "@/modules/tags/repository";

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
  const [tags, recent] = await Promise.all([canTag ? listActiveTags(event.id) : Promise.resolve([]), listRecentBulkActions(event.id, 10)]);
  const exportFields = EXPORT_FIELDS.filter((field) => field.permissions.some((needed) => permissions.includes(needed))).map((field) => ({ key: field.key, label: field.label, personal: field.personal }));
  const peopleHref = `/people${queryString ? `?${queryString}&` : "?"}event=${encodeURIComponent(event.id)}`;
  return <>
    <AdminPageHeader path="/people/bulk-actions" eventId={event.id} />
    <section className="page-stack">
      <PageHeader
        title="Bulk actions"
        description="Apply or remove a tag, or export chosen fields, for the registrations in the current filter. You review a preview first, then confirm."
        actions={<li><a href={peopleHref}>Back to registrations</a></li>}
      />
      <BulkActionsPanel
        eventId={event.id}
        queryString={queryString}
        total={found.ok ? found.total : null}
        scopeProblem={found.ok ? null : (found.issues[0]?.message ?? "This filter cannot be used for a bulk action.")}
        filters={describeQueryFilters(queryString, { showText: true })}
        tags={tags.map((tag) => ({ id: tag.id, name: tag.name }))}
        canTag={canTag}
        canExport={canExport}
        exportFields={exportFields}
        hiddenFieldCount={EXPORT_FIELDS.length - exportFields.length}
        limits={{ tag: BULK_ACTION_CATALOG.APPLY_TAG.maxRecords, export: BULK_ACTION_CATALOG.EXPORT_FIELDS.maxRecords }}
        recent={recent}
      />
    </section>
  </>;
}
