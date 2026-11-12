import { AccessDeniedError, effectivePermissions, requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { findActiveMembership } from "@/modules/events/repository";
import { locationParam, resolveLocationFilter } from "@/modules/event-locations/filter";
import { listRegistrations } from "@/modules/registrations/repository";
import { registrationsExportRows } from "@/modules/registrations/registrations-export-rows";
import { toCsv } from "@/modules/reporting/csv";
import {
  CHOICE_FILTER_QUESTION_PARAM,
  CHOICE_FILTER_VALUE_PARAM,
  choiceExportRows,
  resolveChoiceFilter,
} from "@/modules/registrations/choice-answer-filter";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";
import { csvDownloadResponse, exportFileName } from "@/modules/reporting/export-response";
import { eventFileScope } from "@/modules/reporting/export-scope";

async function getHandler(
  request: Request,
  context: { params: Promise<{ eventId: string }> },
) {
  try {
    const { eventId } = await context.params;
    const access = await requirePermission(await getCurrentSession(), eventId, "VIEW_REPORTS", findActiveMembership);
    // A general export is read with only the exporting user's own
    // permissions: a note restricted to a permission this user does not hold
    // must not surface here even though the export otherwise covers everyone.
    const actorPermissions = new Set(effectivePermissions(access.user, access.membership));
    // ?answerQuestion=&answerValue= exports exactly the people the filtered list shows (#739).
    // A question that cannot be filtered on (free text, sensitive, unknown) is not exported.
    const searchParams = new URL(request.url).searchParams;
    const choiceQuestion = searchParams.get(CHOICE_FILTER_QUESTION_PARAM);
    // The People page needs VIEW_SENSITIVE_DATA to see attendee names; the filtered list is names and answers.
    // Refused before anything is read.
    if (choiceQuestion && !actorPermissions.has("VIEW_SENSITIVE_DATA")) {
      throw new AccessDeniedError("Your event role does not include access to attendee names and answers.", 403, "PERMISSION_DENIED");
    }
    // ?location= narrows the export to one location; without it every location is combined,
    // each row naming its location (#413). The column exists only for events with locations.
    const { locationId, locations } = await resolveLocationFilter(eventId, locationParam(request));
    const registrations = await listRegistrations(eventId, { locationId });
    if (choiceQuestion) {
      const choice = resolveChoiceFilter(registrations, { question: choiceQuestion, value: searchParams.get(CHOICE_FILTER_VALUE_PARAM) }, { canViewSensitive: actorPermissions.has("VIEW_SENSITIVE_DATA") });
      if (!choice || !choice.value) {
        return Response.json({ error: "CHOICE_FILTER_UNAVAILABLE", message: "That question cannot be used to filter an export." }, { status: 400 });
      }
      return csvDownloadResponse(toCsv(choiceExportRows(registrations, { ...choice, value: choice.value })), exportFileName({ scope: await eventFileScope(eventId), kind: "registrations-by-answer" }));
    }
    const showLocation = locations.length > 0;
    const rows = await registrationsExportRows(eventId, registrations, { showLocation, staffNotes: actorPermissions });
    return csvDownloadResponse(toCsv(rows), exportFileName({ scope: await eventFileScope(eventId), kind: "registrations" }));
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return Response.json({ error: error.code, message: error.message }, { status: error.status });
    }
    logError("Unable to export registrations", error);
    return Response.json({ error: "REGISTRATION_EXPORT_FAILED" }, { status: 500 });
  }
}

export const GET = withRequestContext(getHandler);
