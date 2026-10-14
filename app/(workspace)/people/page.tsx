import type { Metadata } from "next";
import { AccessRestricted } from "@/components/access-restricted";
import { LocationFilter } from "@/components/location-filter";
import { PeopleWorkspace } from "@/components/people-workspace";
import { resolveLocationFilter } from "@/modules/event-locations/filter";
import { resolveEventContext } from "@/modules/events/selection";
import { listRegistrations } from "@/modules/registrations/repository";
import { OperationsSearchBar } from "@/components/operations-search-bar";
import {
  activeFilterKeys,
  parseOperationsSearchParams,
  pickSearchParams,
  serializeOperationsSearchQuery,
} from "@/modules/registrations/operations-search-domain";
import { describeOperationsSearch, searchOperationsRegistrations } from "@/modules/registrations/operations-search-repository";
import {
  CHOICE_FILTER_QUESTION_PARAM,
  CHOICE_FILTER_VALUE_PARAM,
  choiceAnswerCounts,
  filterRegistrationsByChoice,
  listChoiceQuestions,
  matchesForChoice,
  resolveChoiceFilter,
} from "@/modules/registrations/choice-answer-filter";
import { ChoiceAnswerFilter, type ChoiceFilterView } from "@/components/choice-answer-filter";
import { listEventAnnouncementOptOuts } from "@/modules/communications/email-preferences-repository";
import { backgroundFlaggedAttendeeIds } from "@/modules/background-checks/repository";
import { getResponsibleAdultsByAttendee } from "@/modules/guardian-authority/repository";
import { staffPageTitles } from "@/components/staff-navigation";

export const metadata: Metadata = { title: staffPageTitles.registrations };

export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ event?: string; filter?: string; registration?: string; location?: string; answerQuestion?: string; answerValue?: string; [key: string]: string | string[] | undefined }> }) {
  const rawParams = await searchParams;
  const { event: requested, filter, registration, location: requestedLocation, [CHOICE_FILTER_QUESTION_PARAM]: answerQuestion, [CHOICE_FILTER_VALUE_PARAM]: answerValue } = rawParams as { event?: string; filter?: string; registration?: string; location?: string; answerQuestion?: string; answerValue?: string };
  const { event, permissions } = await resolveEventContext(requested);
  if (!permissions.includes("VIEW_SENSITIVE_DATA")) {
    return <AccessRestricted title="People records are restricted" detail="Your event role does not include access to attendee names, contact details, or registration records." />;
  }
  // Each location on its own, or all combined (#413).
  const { locations, locationId } = await resolveLocationFilter(event.id, requestedLocation);
  // Structured search (#180) runs on the server when the URL carries a filter beyond the location, a sort, or a page.
  // A plain visit keeps the list as it was: everything loaded, found with the box below.
  const picked = pickSearchParams(rawParams);
  const { query: searchQuery, issues: searchParseIssues } = parseOperationsSearchParams(picked);
  const searchViewer = { eventId: event.id, permissions };
  const { catalog: searchCatalog, filters: searchFilters } = await describeOperationsSearch(searchViewer);
  const serverSearch = activeFilterKeys(searchQuery).some((key) => key !== "location") || picked.has("sort") || picked.has("page") || searchParseIssues.length > 0;
  const searchResult = serverSearch ? await searchOperationsRegistrations(searchViewer, picked, searchCatalog) : null;
  const [loaded, flagged, responsibleByAttendee, optOutRows] = await Promise.all([
    searchResult
      ? (searchResult.registrationIds.length > 0 ? listRegistrations(event.id, { registrationIds: searchResult.registrationIds }) : Promise.resolve([]))
      : listRegistrations(event.id, { locationId }),
    backgroundFlaggedAttendeeIds(event.id), getResponsibleAdultsByAttendee(event.id), listEventAnnouncementOptOuts(event.id),
  ]);
  // The service's canonical order, not the loader's.
  const allRegistrations = searchResult
    ? searchResult.registrationIds.flatMap((id) => loaded.filter((registration) => registration.id === id))
    : loaded;
  // Who opted out of announcements (#838), marked on the registration: the kind only, never a reason.
  const announcementOptOuts = Object.fromEntries(optOutRows.map((row) => [row.registrationId, row.scope]));
  // Who is responsible for each minor (#131): names only, shown beside the minor.
  const responsibleAdults = Object.fromEntries([...responsibleByAttendee].map(([attendeeId, minor]) => [attendeeId, {
    adultName: minor.responsibleAdult?.name ?? null,
    noneOfUs: minor.noneOfUs,
    ageUnknown: minor.status === "UNKNOWN",
  }]));
  // Filter by a choice answer (#739), on the server: only choice questions flagged "Show as a filter" (#743)
  // resolve here, whatever the URL says. This page already requires VIEW_SENSITIVE_DATA, so sensitive ones are offered.
  const viewer = { canViewSensitive: permissions.includes("VIEW_SENSITIVE_DATA") };
  const choice = searchResult ? null : resolveChoiceFilter(allRegistrations, { question: answerQuestion, value: answerValue }, viewer);
  const registrations = choice ? filterRegistrationsByChoice(allRegistrations, choice) : allRegistrations;
  const choiceView: ChoiceFilterView = {
    questions: listChoiceQuestions(allRegistrations, viewer).map((question) => ({ id: question.id, label: question.label })),
    selected: choice ? {
      id: choice.question.id,
      label: choice.question.label,
      scope: choice.question.scope,
      value: choice.value,
      ...choiceAnswerCounts(allRegistrations, choice.question),
      matches: choice.value ? matchesForChoice(allRegistrations, choice.question, choice.value) : [],
    } : null,
  };
  const searchParamsForLinks: Record<string, string | undefined> = { ...Object.fromEntries(serializeOperationsSearchQuery(searchQuery) ? new URLSearchParams(serializeOperationsSearchQuery(searchQuery)) : []), event: event.id, filter, [CHOICE_FILTER_QUESTION_PARAM]: choice?.question.id, [CHOICE_FILTER_VALUE_PARAM]: choice?.value ?? undefined };
  return <>
    <OperationsSearchBar
      basePath="/people"
      carry={{ filter }}
      eventId={event.id}
      filters={searchFilters}
      query={searchQuery}
      summary={searchResult ? { total: searchResult.total, page: searchResult.page, pageCount: searchResult.pageCount, issues: searchResult.issues } : null}
    />
    <LocationFilter basePath="/people" locations={locations} params={searchResult ? searchParamsForLinks : { event: event.id, filter, [CHOICE_FILTER_QUESTION_PARAM]: choice?.question.id, [CHOICE_FILTER_VALUE_PARAM]: choice?.value ?? undefined }} selectedId={locationId} />
    <ChoiceAnswerFilter eventId={event.id} view={choiceView} carry={{ filter, location: locationId ?? undefined }} canEmail={permissions.includes("MANAGE_COMMUNICATIONS")} canExport={permissions.includes("VIEW_REPORTS") && permissions.includes("VIEW_SENSITIVE_DATA")} />
    <PeopleWorkspace key={`${event.id}:${choice?.question.id ?? ""}:${choice?.value ?? ""}:${searchResult?.queryString ?? ""}`} eventId={event.id} eventSlug={event.slug} eventTimezone={event.timezone} waitlistEnabled={event.waitlistEnabled} initialRegistrations={registrations} canEdit={permissions.includes("MANAGE_REGISTRATION")} canEmail={permissions.includes("MANAGE_COMMUNICATIONS")} initialFilter={filter} initialRegistrationId={registration} backgroundFlaggedAttendeeIds={[...flagged]} announcementOptOuts={announcementOptOuts} responsibleAdults={responsibleAdults} matchingPersonFilter={Boolean(choice?.value)} locationId={locationId} />
  </>;
}
