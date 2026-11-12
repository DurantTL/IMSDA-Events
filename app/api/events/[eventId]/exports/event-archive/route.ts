import { AccessDeniedError, effectivePermissions, requireEventMembership } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { findEventArchiveFacts } from "@/modules/events/archive-download-facts";
import { findActiveMembership } from "@/modules/events/repository";
import { effectiveLifecycleState } from "@/modules/events/lifecycle-state";
import { resolveLocationFilter } from "@/modules/event-locations/filter";
import { InformationFormError } from "@/modules/information-forms/errors";
import { listInformationForms } from "@/modules/information-forms/repository";
import { buildInformationFormResponsesCsv } from "@/modules/information-forms/responses";
import { buildAttendeeListingRows, attendeeListingCsv, filterAttendeeListing, parseAttendeeListingQuery } from "@/modules/registrations/attendee-listing";
import { listRegistrations } from "@/modules/registrations/repository";
import { registrationsExportRows } from "@/modules/registrations/registrations-export-rows";
import { toCsv } from "@/modules/reporting/csv";
import { buildArchiveContents, eventAllowsArchiveDownload, sha256Hex, type ArchiveFile, type ArchiveSkip } from "@/modules/reporting/event-archive";
import { exportFileName, zipDownloadResponse } from "@/modules/reporting/export-response";
import { eventFileScope } from "@/modules/reporting/export-scope";
import { buildZip } from "@/modules/reporting/zip";
import { logError } from "@/lib/logger";
import { CORRELATION_HEADER, currentCorrelationId, withRequestContext } from "@/lib/request-context";
import { GET as invoicesExport } from "@/app/api/events/[eventId]/exports/invoices/route";
import { GET as billingResponsibilityExport } from "@/app/api/events/[eventId]/exports/billing-responsibility/route";
import { GET as churchOwedExport } from "@/app/api/events/[eventId]/exports/church-owed/route";
import { GET as scholarshipFundExport } from "@/app/api/events/[eventId]/exports/scholarship-fund/route";
import { GET as attendanceReconciliationExport } from "@/app/api/events/[eventId]/exports/attendance-reconciliation/route";

/**
 * Download event archive (#175, first slice): one zip of the event's existing exports for a closed or archived event.
 * Each file is in only when the signed-in person could download that export today, by the export's own rule; nothing
 * is loosened. Health records are never included: no staff notes, no dietary detail, no medical or lodging files. The
 * download is written to the audit log (names and a checksum, no personal data). No reimport.
 *
 * The finance files come from the existing export routes called in place, so their rule and content cannot drift.
 * 200 includes the file, 401 or 403 lists it as not allowed, 400 or 404 as nothing to export, and anything else fails
 * the whole download rather than giving a partial archive.
 */

const BOM = "﻿";
const text = (csv: string) => new TextEncoder().encode(csv.startsWith(BOM) ? csv : BOM + csv);

type FinanceExport = { name: string; segment: string; handler: typeof invoicesExport; sectioned?: boolean };
const financeExports: readonly FinanceExport[] = [
  { name: "finalized-invoices.csv", segment: "invoices", handler: invoicesExport },
  { name: "billing-responsibility.csv", segment: "billing-responsibility", handler: billingResponsibilityExport },
  { name: "church-owed.csv", segment: "church-owed", handler: churchOwedExport, sectioned: true },
  { name: "scholarship-fund.csv", segment: "scholarship-fund", handler: scholarshipFundExport, sectioned: true },
  { name: "attendance-reconciliation.csv", segment: "attendance-reconciliation", handler: attendanceReconciliationExport },
];

async function getHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await context.params;
    // Refused before anything else is read.
    const access = await requireEventMembership(await getCurrentSession(), eventId, findActiveMembership);
    const permissions = new Set<string>(effectivePermissions(access.user, access.membership));
    if (!permissions.has("VIEW_REPORTS") && !permissions.has("MANAGE_FINANCE")) {
      throw new AccessDeniedError("Your event role doesn't include this. Ask your event administrator if you need access.", 403, "PERMISSION_DENIED");
    }
    const facts = await findEventArchiveFacts(eventId);
    if (!facts) return Response.json({ error: "EVENT_NOT_FOUND", message: "That event was not found." }, { status: 404 });
    if (!eventAllowsArchiveDownload(facts)) {
      return Response.json({ error: "EVENT_NOT_CLOSED", message: "The event archive is available once the event is closed or archived." }, { status: 409 });
    }

    const files: ArchiveFile[] = [];
    const notIncluded: ArchiveSkip[] = [];
    const include = (name: string, csv: string, sectioned = false) => files.push({ name, data: text(csv), ...(sectioned ? { sectioned } : {}) });

    // Registrations: the registrations export's own gate and rows, without the staff notes column.
    if (permissions.has("VIEW_REPORTS")) {
      const { locations } = await resolveLocationFilter(eventId, null);
      const registrations = await listRegistrations(eventId, {});
      include("registrations.csv", toCsv(await registrationsExportRows(eventId, registrations, { showLocation: locations.length > 0, staffNotes: null })));
    } else {
      notIncluded.push({ name: "registrations.csv", reason: "FORBIDDEN" });
    }

    // Attendees: the attendees export's own gate, the default listing, dietary detail never shown.
    if (permissions.has("VIEW_REPORTS") && permissions.has("VIEW_SENSITIVE_DATA")) {
      const query = parseAttendeeListingQuery(new URLSearchParams());
      const registrations = await listRegistrations(eventId, { statuses: query.statuses });
      include("attendees.csv", attendeeListingCsv(filterAttendeeListing(buildAttendeeListingRows(registrations, { showDietaryDetails: false }), query), { omitDietaryColumns: true }));
    } else {
      notIncluded.push({ name: "attendees.csv", reason: "FORBIDDEN" });
    }

    const correlationId = currentCorrelationId();
    // Finance: each existing route, called in place with the same session.
    for (const item of financeExports) {
      const response = await item.handler(
        new Request(new URL(`/api/events/${encodeURIComponent(eventId)}/exports/${item.segment}`, request.url), {
          headers: correlationId ? { [CORRELATION_HEADER]: correlationId } : {},
        }),
        { params: Promise.resolve({ eventId }) },
      );
      if (response.status === 200) include(item.name, await response.text(), item.sectioned);
      else if (response.status === 401 || response.status === 403) notIncluded.push({ name: item.name, reason: "FORBIDDEN" });
      else if (response.status === 400 || response.status === 404) {
        // An export that says it does not apply to this event (not billed after the event) reads differently from an empty one.
        const code = ((await response.json().catch(() => null)) as { error?: unknown } | null)?.error;
        notIncluded.push({ name: item.name, reason: code === "NOT_DEFERRED_EVENT" ? "NOT_APPLICABLE" : "EMPTY" });
      }
      else throw new Error(`Archive export ${item.segment} answered ${response.status}.`);
    }

    // Forms: each information form's responses, for people who manage forms. The debrief and director
    // evaluation forms (a purpose) are the Debrief's own and are left out, as the Forms hub leaves them out.
    if (permissions.has("MANAGE_FORMS")) {
      const forms = (await listInformationForms({ scope: "EVENT", eventId })).filter((form) => !form.purpose);
      const used = new Set<string>();
      for (const form of forms) {
        const built = await buildInformationFormResponsesCsv({ scope: "EVENT", eventId }, form.id, access.user.id);
        let name = `forms/${built.filename}`;
        for (let n = 2; used.has(name); n += 1) name = `forms/${built.filename.replace(/\.csv$/, "")}-${n}.csv`;
        used.add(name);
        include(name, built.csv);
      }
    } else {
      notIncluded.push({ name: "forms/ (form responses)", reason: "FORBIDDEN" });
    }

    const generatedAt = new Date();
    const contents = buildArchiveContents({
      eventName: facts.name,
      eventId,
      lifecycleState: effectiveLifecycleState(facts),
      generatedBy: access.user.displayName,
      generatedAt,
      files,
      notIncluded,
    });
    const zip = buildZip([{ name: "CONTENTS.txt", data: new TextEncoder().encode(contents) }, ...files], generatedAt);
    await writeAuditLog({
      eventId,
      actorUserId: access.user.id,
      action: "EVENT_ARCHIVE_DOWNLOADED",
      entityType: "Event",
      entityId: eventId,
      summary: `Downloaded the event archive (${files.length} file${files.length === 1 ? "" : "s"}).`,
      metadata: { files: files.map((file) => file.name), notIncluded: notIncluded.map((skip) => skip.name), packageSha256: sha256Hex(zip) },
    });
    const fileName = exportFileName({ scope: await eventFileScope(eventId), kind: "event-archive", extension: "zip" });
    return zipDownloadResponse(new Uint8Array(zip), fileName);
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return Response.json({ error: error.code, message: error.message }, { status: error.status });
    }
    if (error instanceof InformationFormError && error.code === "EXPORT_TOO_LARGE") {
      return Response.json({ error: error.code, message: error.message }, { status: 409 });
    }
    logError("Unable to build the event archive", error);
    return Response.json({ error: "EVENT_ARCHIVE_DOWNLOAD_FAILED", message: "The archive could not be made. Nothing was downloaded; try again." }, { status: 500 });
  }
}

export const GET = withRequestContext(getHandler);
