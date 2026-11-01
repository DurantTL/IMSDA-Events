import type { Metadata } from "next";
import { NavigationLink as Link } from "@/components/navigation-link";
import { ArrowRight, FileText } from "lucide-react";
import { BackLink } from "@/components/back-link";
import {
  ClubHomeDeadlinesUnavailable,
  ClubHomeEvents,
  ClubHomeReadOnlyNotice,
  ClubHomeRoster,
  ClubHomeSummary,
  ClubHomeTasks,
  ClubHomeUsefulLinks,
} from "@/components/club-home";
import { SetupChecklistPanel } from "@/components/setup-checklist-panel";
import { UpcomingDeadlines } from "@/components/upcoming-deadlines";
import { clubPortalComplianceReminderCounts } from "@/modules/background-checks/repository";
import { complianceReminders } from "@/modules/background-checks/domain";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import { clubLeaderViewerFromAccess } from "@/modules/club-forms/access";
import { isClubFormsRole } from "@/modules/club-forms/domain";
import { listSubmissionsForViewer } from "@/modules/club-forms/submissions";
import { getRosterAccessStateForPage, type ClubActor } from "@/modules/club-rosters/access";
import { clubYearFor, rosterYearView } from "@/modules/club-rosters/domain";
import {
  clubHomeEventCards,
  clubHomeRosterPreview,
  clubHomeSummary,
  clubHomeUsefulLinks,
  formDraftSteps,
  monthlyRecordSteps,
  rosterSteps,
  type ClubHomeFormDrafts,
  type Loaded,
} from "@/modules/club-rosters/home-view";
import type { ClubHomeStep } from "@/modules/club-rosters/home-next-task";
import { listRoster } from "@/modules/club-rosters/repository";
import { formatCalendarDate } from "@/modules/club-registrations/domain";
import { clubEventRegistrationSteps, listClubEvents } from "@/modules/club-registrations/repository";
import { listUpcomingDeadlines } from "@/modules/calendar/deadline-list";
import { getClubReportYear } from "@/modules/club-reports/repository";
import { buildClubChecklist, CLUB_CHECKLIST_GUIDE_HREF } from "@/modules/setup-help/club-checklist";
import { listDirectedClubs } from "@/modules/organizations/director-access";
import { clubDirectorRoleLabels, clubRoleDescriptions } from "@/modules/organizations/director-grants-domain";

export const metadata: Metadata = { title: "Home" };
export const dynamic = "force-dynamic";

/** Only when there's somewhere else to go (#428): a single-club director has nowhere "all clubs" would take them. */
async function allMyClubsLink(actor: ClubActor | null) {
  // A staff "act as" director (#442) has one club and no attendee account to
  // list clubs for; an attendee cookie on the same browser isn't theirs to use.
  if (actor?.kind === "STAFF_ACTING") return null;
  const accountId = actor?.accountId ?? (await getCurrentAttendee()).account?.id;
  if (!accountId) return null;
  const clubs = await listDirectedClubs(accountId);
  return clubs.length > 1 ? <BackLink href="/account/clubs">All my clubs</BackLink> : null;
}

/** Runs one source's load so a failure marks only that section unavailable instead of crashing Home. */
async function load<T>(work: Promise<T>): Promise<Loaded<T>> {
  try {
    return await work;
  } catch {
    return "ERROR";
  }
}

/**
 * Saved club-form drafts for this club and year, as metadata only (no answers).
 * Club forms belong to the director and deputy; a failed load is reported as
 * unknown rather than as "no drafts".
 */
async function loadFormDrafts(access: Extract<Awaited<ReturnType<typeof getRosterAccessStateForPage>>, { state: "OPEN" }>, clubYear: string): Promise<ClubHomeFormDrafts> {
  if (!isClubFormsRole(access.club.role)) return null;
  try {
    // Filtered in the query (not from a capped list), and still limited to this club by the viewer.
    const rows = await listSubmissionsForViewer(clubLeaderViewerFromAccess(access), { status: "DRAFT", clubYear });
    return rows
      .map((row) => ({ id: row.id, templateName: row.templateName, updatedAt: row.updatedAt }));
  } catch {
    return "ERROR";
  }
}

/** The club's working screen: a short summary, the work that is really waiting, a roster preview and the club's event registration. */
export default async function ClubHomePage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams?: Promise<{ year?: string | string[] }>;
}) {
  const [{ organizationId }, query] = await Promise.all([params, searchParams ?? Promise.resolve({} as { year?: string })]);
  const access = await getRosterAccessStateForPage(organizationId);
  const now = new Date();
  if (access.state === "NO_ROSTER") {
    // A reporter (#375): no roster, no registrations, just monthly reports (#377). Deadlines are for every club role (#910).
    const base = `/account/clubs/${organizationId}`;
    const clubYear = clubYearFor(now);
    const [reporterDeadlines, reportYear] = await Promise.all([
      load(listUpcomingDeadlines()),
      access.capabilities.submitReports ? load(getClubReportYear(organizationId, clubYear)) : Promise.resolve(null),
    ]);
    const { steps, deadlines } = reportYear && reportYear !== "ERROR" ? monthlyRecordSteps(reportYear.reports, clubYear, base, now, reportYear.joinedOn) : { steps: [], deadlines: {} };
    const reportsFailed = reportYear === "ERROR";
    const reporterChecklist = buildClubChecklist({
      base,
      role: access.club.role,
      capabilities: access.capabilities,
      staffActing: false,
      rosterCount: null,
      registeredEventCount: null,
      hasOpenEvents: false,
      recordsDueNow: reportYear && reportYear !== "ERROR" ? steps.length : null,
      sterlingReminders: null,
    });
    return (
      <>
        {await allMyClubsLink(null)}
        <SetupChecklistPanel
          checklist={reporterChecklist}
          eyebrow="Getting started"
          guide={{ href: CLUB_CHECKLIST_GUIDE_HREF, label: "Read the Getting started guide" }}
          headingId="club-getting-started"
          storageKey={`imsda-events:getting-started-collapsed:club:${organizationId}`}
          title="Get set up"
        />
        <section className="public-manage-card" aria-labelledby="club-role-heading">
          <div className="public-manage-card-heading">
            <p className="public-registration-eyebrow">Your role: {clubDirectorRoleLabels[access.club.role]}</p>
            <h2 id="club-role-heading">Monthly Records</h2>
          </div>
          <p className="public-manage-empty">
            <FileText size={17} aria-hidden="true" /> {clubRoleDescriptions[access.club.role]}
          </p>
          {/* The one filled button is the first due task when there is one; otherwise this link, also when the report year failed to load. */}
          <Link className={`${steps.length > 0 ? "secondary-button" : "primary-button"} club-event-action`} href={`${base}/records`}>
            Open Monthly Records <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </section>
        {(steps.length > 0 || reportsFailed) && (
          <ClubHomeTasks
            deadlines={deadlines}
            emptyNote="Open Monthly Records to see what is due."
            steps={steps}
            unavailable={reportsFailed ? ["Monthly Records"] : []}
          />
        )}
        {reporterDeadlines === "ERROR" ? <ClubHomeDeadlinesUnavailable /> : <UpcomingDeadlines deadlines={reporterDeadlines} />}
      </>
    );
  }
  if (access.state !== "OPEN") return null;

  const base = `/account/clubs/${organizationId}`;
  const { clubYear, currentClubYear, readOnly, contactsEditable } = rosterYearView(query.year, now);
  // Each source loads on its own: one that fails marks only its own section "unavailable" and never takes the page down.
  const [members, events, reportYear, clubsLink, compliance, deadlineList, formDrafts] = await Promise.all([
    load(listRoster(organizationId, clubYear)),
    readOnly ? Promise.resolve(null) : load(listClubEvents(organizationId)),
    !readOnly && access.capabilities.submitReports ? load(getClubReportYear(organizationId, clubYear)) : Promise.resolve(null),
    allMyClubsLink(access.actor),
    // Only for roles that already see the roster's Sterling Volunteers column (#479).
    readOnly ? Promise.resolve(null) : load(clubPortalComplianceReminderCounts(organizationId, clubYear, access.capabilities)),
    // The conference's deadlines (#910): the same list for every club.
    readOnly ? Promise.resolve([]) : load(listUpcomingDeadlines(now)),
    loadFormDrafts(access, clubYear),
  ]);

  const summary = clubHomeSummary({ clubYear, members, formDrafts, events });
  const roster = clubHomeRosterPreview(members === "ERROR" ? [] : members);
  const links = clubHomeUsefulLinks({ base, capabilities: access.capabilities, formsRole: isClubFormsRole(access.club.role) });
  // Only what this role can actually have waiting: a registrar has no club forms or Monthly Records to wait for.
  const waitingFor = [
    ...(isClubFormsRole(access.club.role) ? ["a saved form draft"] : []),
    ...(access.capabilities.submitReports ? ["a due Monthly Record"] : []),
    "an open club event",
  ].join(", ").replace(/, ([^,]*)$/, " or $1").replace(/^./, (letter) => letter.toUpperCase());
  const rosterHref = readOnly ? `${base}/roster?year=${clubYear}` : `${base}/roster`;

  // Tasks exist only for the current year, and only when real data backs them. A source that failed adds none and is named.
  const steps: ClubHomeStep[] = [];
  const deadlines: Record<string, string> = {};
  const unavailable: string[] = [];
  if (!readOnly) {
    if (formDrafts === "ERROR") unavailable.push("Saved club form drafts");
    steps.push(...formDraftSteps(formDrafts, base));
    if (members === "ERROR") unavailable.push("The roster");
    else steps.push(...rosterSteps(members, base));
    if (reportYear === "ERROR") unavailable.push("Monthly Records");
    else if (reportYear) {
      const records = monthlyRecordSteps(reportYear.reports, clubYear, base, now, reportYear.joinedOn);
      steps.push(...records.steps);
      Object.assign(deadlines, records.deadlines);
    }
    if (events === "ERROR") unavailable.push("Club events");
    else if (events) {
      steps.push(...clubEventRegistrationSteps(events, base));
      for (const event of events) {
        if (event.registrationClosesOn) deadlines[event.id] = `Register by ${formatCalendarDate(event.registrationClosesOn)}`;
      }
    }
    // Flags only, never blocks registration (#405, #479).
    if (compliance === "ERROR") unavailable.push("Sterling Volunteers reminders");
    else if (compliance) {
      for (const reminder of complianceReminders(compliance, `${base}/roster`)) {
        steps.push({ key: reminder.key, text: reminder.text, href: reminder.href, action: "Open roster", danger: true });
      }
    }
  }

  const checklist = readOnly
    ? null
    : buildClubChecklist({
        base,
        role: access.club.role,
        capabilities: access.capabilities,
        staffActing: access.actor?.kind === "STAFF_ACTING",
        rosterCount: members === "ERROR" ? null : members.filter((member) => member.status === "ACTIVE").length,
        registeredEventCount: events === "ERROR" || !events ? null : events.filter((event) => event.registration).length,
        hasOpenEvents: events !== "ERROR" && Boolean(events) && events!.some((event) => event.available && event.phase === "OPEN"),
        recordsDueNow: reportYear === "ERROR" || !reportYear ? null : steps.filter((step) => step.key.startsWith("report-")).length,
        sterlingReminders: compliance === "ERROR" || !compliance ? null : complianceReminders(compliance, `${base}/roster`).length,
      });

  return (
    <>
      {clubsLink}
      {readOnly && (
        <ClubHomeReadOnlyNotice
          clubYear={clubYear}
          contactsEditable={contactsEditable && access.capabilities.guardians}
          currentClubYear={currentClubYear}
          currentHref={base}
        />
      )}
      <ClubHomeSummary clubYear={clubYear} summary={summary} />
      {checklist && (
        <SetupChecklistPanel
          checklist={checklist}
          eyebrow="Getting started"
          guide={{ href: CLUB_CHECKLIST_GUIDE_HREF, label: "Read the Getting started guide" }}
          headingId="club-getting-started"
          storageKey={`imsda-events:getting-started-collapsed:club:${organizationId}`}
          title="Get your club set up"
        />
      )}
      {!readOnly && (
        <ClubHomeTasks
          deadlines={deadlines}
          emptyNote={`Nothing is saved or due for this club year. ${waitingFor} will appear here.`}
          steps={steps}
          unavailable={unavailable}
        />
      )}
      <ClubHomeRoster setupBase={base} clubYear={clubYear} preview={roster} readOnly={readOnly} rosterHref={rosterHref} unavailable={members === "ERROR"} />
      {events && (
        <ClubHomeEvents
          setupBase={base}
          cards={events === "ERROR" ? [] : clubHomeEventCards(events, { base, sponsoringChurch: access.club.sponsoringChurch, clubYear })}
          eventsHref={`${base}/events`}
          hasOpenEvents={events !== "ERROR" && events.some((event) => event.available && event.phase === "OPEN")}
          unavailable={events === "ERROR"}
        />
      )}
      {!readOnly && (deadlineList === "ERROR" ? <ClubHomeDeadlinesUnavailable /> : <UpcomingDeadlines deadlines={deadlineList} />)}
      <ClubHomeUsefulLinks links={links} />
    </>
  );
}
