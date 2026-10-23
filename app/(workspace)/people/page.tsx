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
  conflictIssue,
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
import { listEventSuppressionMarks } from "@/modules/communications/email-suppression";
import { backgroundFlaggedAttendeeIds } from "@/modules/background-checks/repository";
import { getResponsibleAdultsByAttendee } from "@/modules/guardian-authority/repository";
import { countPendingTeams } from "@/modules/general-link-registrations/repository";
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
  const parsedSearch = parseOperationsSearchParams(picked);
  // The location is the page's own, already checked against the event's sites: a stale or unknown one means all
  // locations here, exactly as it does on the plain list, rather than a search that finds nothing.
  const searchQuery = { ...parsedSearch.query, location: locationId ? [locationId] : [] };
  const searchParseIssues = parsedSearch.issues.filter((issue) => issue.filter !== "location");
  const searchViewer = { eventId: event.id, permissions };
  const { catalog: searchCatalog, filters: searchFilters } = await describeOperationsSearch(searchViewer);
  const serverSearch = activeFilterKeys(searchQuery).some((key) => key !== "location") || picked.has("sort") || picked.has("page") || searchParseIssues.length > 0;
  // The retired single-answer parameters cannot ride along with a server search: say so instead of ignoring them.
  const retiredAnswerParams = serverSearch && Boolean(answerQuestion || answerValue) ? [conflictIssue(CHOICE_FILTER_QUESTION_PARAM)] : [];
  const searchResult = serverSearch ? await searchOperationsRegistrations(searchViewer, searchQuery, searchCatalog, [...searchParseIssues, ...retiredAnswerParams]) : null;
  // A registration opened by link (?registration=) is shown even when it is not on this page of results.
  const offPageRegistrationId = searchResult && registration && !searchResult.registrationIds.includes(registration) ? [registration] : [];
  // Teams from the general registration link that wait for a club (#931): said at the top, for someone who can resolve them.
  const pendingTeamCount = permissions.includes("MANAGE_REGISTRATION") ? await countPendingTeams(event.id) : 0;
  const [loaded, flagged, responsibleByAttendee, optOutRows, suppressionMarks] = await Promise.all([
    searchResult
      ? ([...searchResult.registrationIds, ...offPageRegistrationId].length > 0 ? listRegistrations(event.id, { registrationIds: [...searchResult.registrationIds, ...offPageRegistrationId] }) : Promise.resolve([]))
      : listRegistrations(event.id, { locationId }),
    backgroundFlaggedAttendeeIds(event.id), getResponsibleAdultsByAttendee(event.id), listEventAnnouncementOptOuts(event.id), listEventSuppressionMarks(event.id),
  ]);
  // The service's canonical order, not the loader's.
  const allRegistrations = searchResult
    ? searchResult.registrationIds.flatMap((id) => loaded.filter((candidate) => candidate.id === id))
    : loaded;
  // Only opens the detail: it is not a row of the list, its count, or Select all.
  const openOnlyRegistration = offPageRegistrationId.length > 0 ? loaded.find((candidate) => candidate.id === registration) ?? null : null;
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
  // Links that change the location keep the whole search, including repeated parameters such as several answers.
  const searchParamsForLinks = new URLSearchParams(serializeOperationsSearchQuery(searchQuery));
  searchParamsForLinks.set("event", event.id);
  if (filter) searchParamsForLinks.set("filter", filter);
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
    <PeopleWorkspace key={`${event.id}:${choice?.question.id ?? ""}:${choice?.value ?? ""}:${searchResult?.queryString ?? ""}`} eventId={event.id} eventSlug={event.slug} eventTimezone={event.timezone} waitlistEnabled={event.waitlistEnabled} initialRegistrations={registrations} canEdit={permissions.includes("MANAGE_REGISTRATION")} canEmail={permissions.includes("MANAGE_COMMUNICATIONS")} canImport={permissions.includes("MANAGE_IMPORTS")} initialFilter={filter} initialRegistrationId={registration} backgroundFlaggedAttendeeIds={[...flagged]} announcementOptOuts={announcementOptOuts} emailSuppressions={suppressionMarks} responsibleAdults={responsibleAdults} matchingPersonFilter={Boolean(choice?.value)} locationId={locationId} pageScoped={Boolean(searchResult)} openOnlyRegistration={openOnlyRegistration} pendingTeamCount={pendingTeamCount} />
  </>;
}
