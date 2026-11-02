import { ExportLink } from "@/components/export-link";
import { ExactValue } from "@/components/exact-value";
import { formatPersonName } from "@/lib/person-name";
import type { Metadata } from "next";
import { EventSetupHelp } from "@/components/event-setup-help";
import { StaffPageHeader } from "@/components/staff-page-header";
import Link from "next/link";
import {
  Award,
  BedDouble,
  Baby,
  CalendarCheck2,
  ClipboardCheck,
  Download,
  HandHeart,
  ListOrdered,
  PackageOpen,
  ShieldAlert,
  ShieldCheck,
  Tent,
  UsersRound,
  Utensils,
} from "lucide-react";
import { AccessRestricted } from "@/components/access-restricted";
import { BackgroundCheckList } from "@/components/background-check-flags";
import { EmailRegistrationsButton } from "@/components/email-registrations-button";
import { PrintReportButton } from "@/components/print-report-button";
import { resolveEventContext } from "@/modules/events/selection";
import type {
  OperationalCountField,
  OperationalReportKind,
  OperationalSeminarField,
} from "@/modules/reporting/operational-reports";
import { getOperationalReport } from "@/modules/reporting/repository";
import { getCurrentSession } from "@/modules/access/current-session";
import { canSeeIssuesText } from "@/modules/background-checks/notes-access";
import { listEventBackgroundFlags } from "@/modules/background-checks/repository";
import { staffPageTitles } from "@/components/staff-navigation";
import { cardCell } from "@/components/table-card-labels";
import { ColumnHeader } from "@/components/column-header";
import { SortOrderNote } from "@/components/list-sort";
import { serverSort, sortRows, type ServerSort } from "@/lib/list-sort";
import { REPORT_COUNTS_SORT_COLUMNS, REPORT_ROSTER_SORT_COLUMNS, REPORT_SEMINAR_SORT_COLUMNS, REPORT_TYPES_SORT_COLUMNS, REPORT_VOLUNTEER_SORT_COLUMNS, UNSORTED, sortLine } from "@/lib/staff-sort-columns";

export const metadata: Metadata = { title: staffPageTitles.operationalReports };

function reportDownloadHref(eventId: string, kind: OperationalReportKind) {
  return `/api/events/${encodeURIComponent(eventId)}/reports?report=${kind}`;
}

function scopeLabel(scope: "REGISTRATION" | "ATTENDEE") {
  return scope === "ATTENDEE" ? "Counted for each attendee" : "Counted once per registration";
}

function displayCount(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function EmptyReport({ children, help }: { children: React.ReactNode; help?: React.ReactNode }) {
  return <><p className="report-empty">{children}</p>{help}</>;
}

function CountFields({
  fields,
  emptyCopy,
  help,
  sorting,
}: {
  fields: OperationalCountField[];
  emptyCopy: string;
  help?: React.ReactNode;
  sorting: ServerSort<typeof REPORT_COUNTS_SORT_COLUMNS[number]>;
}) {
  if (fields.length === 0) return <EmptyReport help={help}>{emptyCopy}</EmptyReport>;
  return (
    <div className="report-field-list">
      {sorting.order.key && <SortOrderNote>{sortLine(sorting.order)}</SortOrderNote>}
      {fields.map((field) => (
        <article className="report-field" key={field.id}>
          <div className="report-field-heading">
            <div>
              <h3>{field.label}</h3>
              <p>{scopeLabel(field.scope)}</p>
            </div>
            <span>{displayCount(field.total)} total</span>
          </div>
          <div className="report-table-wrap card-box">
            <table role="table" className="report-table table-cards table-cards-compact">
              <caption className="sr-only">{field.label} counts</caption>
              <thead role="rowgroup"><tr role="row"><ColumnHeader column="choice" label="Choice or quantity" sorting={sorting} /><ColumnHeader column="count" label="Count" sorting={sorting} /></tr></thead>
              <tbody role="rowgroup">
                {sortRows(field.counts, sorting.order.key, sorting.order.dir, { choice: (row) => row.label, count: (row) => row.count }).map((row) => (
                  <tr role="row" key={row.label}><th role="rowheader" scope="row">{row.label}</th><td {...cardCell("Count")}>{displayCount(row.count)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      ))}
    </div>
  );
}

function SeminarFields({ fields, sorting }: { fields: OperationalSeminarField[]; sorting: ServerSort<typeof REPORT_SEMINAR_SORT_COLUMNS[number]> }) {
  if (fields.length === 0) {
    return <EmptyReport>No ranked-choice fields are configured on an active registration form yet.</EmptyReport>;
  }
  return (
    <div className="report-field-list">
      {sorting.order.key && <SortOrderNote>{sortLine(sorting.order)}</SortOrderNote>}
      {fields.map((field) => (
        <article className="report-field" key={field.id}>
          <div className="report-field-heading">
            <div>
              <h3>{field.label}</h3>
              <p>{scopeLabel(field.scope)} · highest total interest first</p>
            </div>
            <span>{displayCount(field.totalInterest)} choices</span>
          </div>
          <div className="report-table-wrap card-box">
            <table role="table" className="report-table seminar-table table-cards table-cards-compact">
              <caption className="sr-only">{field.label} ranked interest</caption>
              <thead role="rowgroup">
                <tr role="row"><ColumnHeader column="option" label="Option" sorting={sorting} /><ColumnHeader column="first" label="1st" sorting={sorting} /><ColumnHeader column="second" label="2nd" sorting={sorting} /><ColumnHeader column="total" label="Total interest" sorting={sorting} /></tr>
              </thead>
              <tbody role="rowgroup">
                {sortRows(field.choices, sorting.order.key, sorting.order.dir, { option: (choice) => choice.label, first: (choice) => choice.firstChoice, second: (choice) => choice.secondChoice, total: (choice) => choice.totalInterest }).map((choice) => (
                  <tr role="row" key={choice.label}>
                    <th role="rowheader" scope="row">{choice.label}</th>
                    <td {...cardCell("1st")}>{choice.firstChoice}</td>
                    <td {...cardCell("2nd")}>{choice.secondChoice}</td>
                    <td {...cardCell("Total interest")}><strong>{choice.totalInterest}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      ))}
    </div>
  );
}

export default async function OperationalReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string; mealsSort?: string; mealsDir?: string; housingSort?: string; housingDir?: string; childcareSort?: string; childcareDir?: string; volunteerCountsSort?: string; volunteerCountsDir?: string; attendanceSort?: string; attendanceDir?: string; seminarSort?: string; seminarDir?: string; rosterSort?: string; rosterDir?: string; typeSort?: string; typeDir?: string; volunteerSort?: string; volunteerDir?: string }>;
}) {
  const query = await searchParams;
  const requested = query.event;
  const { event, permissions } = await resolveEventContext(requested, { allowWithoutEventView: true });
  if (!permissions.includes("VIEW_REPORTS")) {
    return (
      <AccessRestricted
        title="Reports are restricted"
        detail="Viewing attendee or event-choice totals needs report access."
        whoToAsk="your event administrator"
      />
    );
  }

  // The issues text is for system administrators only (#427, #544).
  const { user } = await getCurrentSession();
  const [report, backgroundFlags] = await Promise.all([
    getOperationalReport(event.id),
    listEventBackgroundFlags(event.id, { includeNotes: canSeeIssuesText(user), includeContact: true }),
  ]);
  // Each kind of table sorts from its own column headers (its own address pair), from a fixed list of columns; the order stays as is until one is chosen (#1458).
  const path = "/more/reports";
  // Each count section sorts on its own, so a click in one leaves the others alone.
  const countSorts = Object.fromEntries(([["meals", "meal-counts"], ["housing", "housing-counts"], ["childcare", "childcare-counts"], ["volunteerCounts", "volunteer-counts"], ["attendance", "attendance-counts"]] as const).map(([prefix, anchor]) => [prefix, serverSort(path, query, REPORT_COUNTS_SORT_COLUMNS, UNSORTED, { prefix, hash: `#${anchor}` })])) as Record<"meals" | "housing" | "childcare" | "volunteerCounts" | "attendance", ReturnType<typeof serverSort<typeof REPORT_COUNTS_SORT_COLUMNS[number]>>>;
  const seminarSorting = serverSort(path, query, REPORT_SEMINAR_SORT_COLUMNS, UNSORTED, { prefix: "seminar", hash: "#seminar-ranking" });
  const rosterSorting = serverSort(path, query, REPORT_ROSTER_SORT_COLUMNS, UNSORTED, { prefix: "roster", hash: "#attendee-roster" });
  const typeSorting = serverSort(path, query, REPORT_TYPES_SORT_COLUMNS, UNSORTED, { prefix: "type", hash: "#attendee-types" });
  const volunteerSorting = serverSort(path, query, REPORT_VOLUNTEER_SORT_COLUMNS, UNSORTED, { prefix: "volunteer", hash: "#volunteer-roster" });
  const peopleQuery = `?event=${encodeURIComponent(event.id)}`;
  // Sections with nothing configured collapse into one line (#981), instead of eight empty panels.
  const emptyCountSections = ([
    ["meal and dietary counts", report.meals],
    ["housing and lodging counts", report.housing],
    ["ranked seminar interest", report.seminars],
    ["childcare planning", report.childcare],
    ["optional-session attendance", report.attendance],
  ] as const).filter(([, fields]) => fields.length === 0).map(([label]) => label);
  const summaryCards = [
    {
      label: "Active registrations",
      value: report.summary.activeRegistrations,
      detail: `${report.summary.rosterGroups} named ${report.summary.rosterGroups === 1 ? "group" : "groups"}`,
      tone: "navy",
    },
    {
      label: "Expected people",
      value: report.summary.attendees,
      detail: "Submitted and confirmed only",
      tone: "purple",
    },
    {
      label: "Meal selections",
      value: displayCount(report.summary.mealSelections),
      detail: `${report.meals.length} structured ${report.meals.length === 1 ? "field" : "fields"}`,
      tone: "gold",
    },
    {
      label: "Housing selections",
      value: displayCount(report.summary.housingSelections),
      detail: `${report.housing.length} structured ${report.housing.length === 1 ? "field" : "fields"}`,
      tone: "green",
    },
    {
      label: "Ranked interests",
      value: report.summary.seminarInterests,
      detail: `${report.seminars.length} ranked ${report.seminars.length === 1 ? "field" : "fields"}`,
      tone: "purple",
    },
    {
      label: "Childcare responses",
      value: displayCount(report.summary.childcareSelections),
      detail: `${report.childcare.length} structured ${report.childcare.length === 1 ? "field" : "fields"}`,
      tone: "green",
    },
    {
      label: "Volunteer responses",
      value: displayCount(report.summary.volunteerSelections),
      detail: `${report.volunteers.length} structured ${report.volunteers.length === 1 ? "field" : "fields"}`,
      tone: "gold",
    },
    {
      label: "Attendance responses",
      value: displayCount(report.summary.attendanceSelections),
      detail: `${report.attendance.length} structured ${report.attendance.length === 1 ? "field" : "fields"}`,
      tone: "navy",
    },
  ];

  return (
    <section className="page-stack reports-workspace">
      <StaffPageHeader
        description={`Live planning totals for ${event.name}, organized so a staff member can print them or open each CSV in a spreadsheet.`}
        primary={<PrintReportButton />}
        actions={(
          <>
            <li><ExportLink href={`/api/events/${encodeURIComponent(event.id)}/exports/meal-tickets`}><Utensils aria-hidden="true" size={16} /> Meal tickets CSV</ExportLink></li>
            <li><ExportLink href={`/api/events/${encodeURIComponent(event.id)}/exports/meal-ticket-summary`}><Utensils aria-hidden="true" size={16} /> Meal ticket summary</ExportLink></li>
          </>
        )}
        tools={[
          { href: `/more/reports/packets${peopleQuery}`, label: "Group packets", icon: PackageOpen },
          { href: `/more/reports/clubs${peopleQuery}`, label: "Club event reports", icon: Tent },
          { href: `/more/reports/clubs/check-in-book${peopleQuery}`, label: "Check-in book", icon: ClipboardCheck },
          { href: `/more/honors/rosters${peopleQuery}`, label: "Honors rosters", icon: Award },
          { href: `/more/kitchen-report${peopleQuery}`, label: "Kitchen report", icon: Utensils },
        ]}
      />

      <div className="report-safety-note">
        <ShieldCheck aria-hidden="true" size={19} />
        <p><strong>Safe operational view.</strong> Draft, waitlisted, and cancelled registrations are excluded. Only configured choices and quantities are counted; medical, allergy, accessibility, and special-needs free text is never included.</p>
      </div>

      <section className="report-summary-grid" aria-label="Report summary">
        {summaryCards.map((card) => (
          <article className={`metric-card report-summary-card accent-${card.tone}`} key={card.label}>
            <strong>{card.value}</strong><p>{card.label}</p><small>{card.detail}</small>
          </article>
        ))}
      </section>

      {backgroundFlags && (
        <section className="panel report-panel" id="background-checks">
          <div className="section-heading report-section-heading">
            <div className="report-title">
              <span className="report-icon coral"><ShieldAlert aria-hidden="true" size={19} /></span>
              <div>
                <p className="eyebrow">Youth or children&apos;s event</p>
                <h2>Sterling Volunteers needed</h2>
                <p>
                  Adults registered: {backgroundFlags.adults}. Not in compliance with Sterling Volunteers through
                  {" "}{backgroundFlags.lastDay}: {backgroundFlags.people.length}. Registration stays open. At this event, adult and staff check-in is held until
                  Sterling Volunteers is current; a staff member with check-in permission can override with a recorded reason.
                  Follow up before the event. Clubs never see this list.
                </p>
              </div>
            </div>
            <ExportLink className="secondary-button report-download" href={`/api/events/${encodeURIComponent(event.id)}/background-checks`}><Download aria-hidden="true" size={15} /> Download CSV</ExportLink>
          </div>
          <BackgroundCheckList people={backgroundFlags.people} registrationHref={{ base: "/people", query: `event=${encodeURIComponent(event.id)}` }} />
        </section>
      )}

      <section className="panel report-panel" id="attendee-roster">
        <div className="section-heading report-section-heading">
          <div className="report-title">
            <span className="report-icon navy"><UsersRound aria-hidden="true" size={19} /></span>
            <div><p className="eyebrow">People</p><h2>Attendee roster by group</h2><p>Uses a club, group, church, congregation, organization, household, or family answer when the form has one.</p></div>
          </div>
          <ExportLink className="secondary-button report-download" href={reportDownloadHref(event.id, "roster")}><Download aria-hidden="true" size={15} /> Download roster CSV</ExportLink>
        </div>
        {report.rosterGroups.length === 0
          ? <EmptyReport help={<EventSetupHelp eventId={event.id} context="reports" id="reports-no-attendees" setupKey="reports-no-attendees" />}>No active attendees are available yet.</EmptyReport>
          : <div className="roster-report-groups">
              {rosterSorting.order.key && <SortOrderNote>{sortLine(rosterSorting.order)}</SortOrderNote>}
              {report.rosterGroups.map((group) => (
                <article className="roster-report-group" key={group.id}>
                  <header>
                    <div><h3>{group.label}</h3><p>{group.fieldLabel ? `Grouped by ${group.fieldLabel}` : "No group answer found"}</p></div>
                    <span>{group.attendees.length} {group.attendees.length === 1 ? "person" : "people"}</span>
                  </header>
                  <div className="report-table-wrap card-box">
                    <table role="table" className="report-table roster-table table-cards table-cards-compact">
                      <caption className="sr-only">Attendees in {group.label}</caption>
                      <thead role="rowgroup"><tr role="row"><ColumnHeader column="attendee" label="Attendee" sorting={rosterSorting} /><ColumnHeader column="type" label="Type" sorting={rosterSorting} /><ColumnHeader column="registration" label="Registration" sorting={rosterSorting} /><ColumnHeader column="holder" label="Account holder" sorting={rosterSorting} /></tr></thead>
                      <tbody role="rowgroup">
                        {sortRows(group.attendees, rosterSorting.order.key, rosterSorting.order.dir, {
                          attendee: (attendee) => formatPersonName(attendee, "sorted"),
                          type: (attendee) => attendee.attendeeType,
                          registration: (attendee) => attendee.confirmationCode,
                          holder: (attendee) => attendee.accountHolderName,
                        }).map((attendee) => (
                          <tr role="row" key={attendee.attendeeId}>
                            <th role="rowheader" scope="row">{attendee.lastName}, {attendee.firstName}</th>
                            <td {...cardCell("Type")}>{attendee.attendeeType}</td>
                            <td {...cardCell("Registration")}><Link className="report-record-link" href={`/people${peopleQuery}&registration=${encodeURIComponent(attendee.registrationId)}`}>{attendee.confirmationCode}</Link></td>
                            <td {...cardCell("Account holder")}>{attendee.accountHolderName}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </article>
              ))}
            </div>}
      </section>

      <section className="panel report-panel" id="attendee-types">
        <div className="section-heading report-section-heading">
          <div className="report-title">
            <span className="report-icon navy"><UsersRound aria-hidden="true" size={19} /></span>
            <div><p className="eyebrow">People</p><h2>Attendees by type</h2><p>One list per attendee type from the form, such as Adult, Teen, or Child. The Teen list is the Teen Program roster.</p></div>
          </div>
          <ExportLink className="secondary-button report-download" href={reportDownloadHref(event.id, "attendee-types")}><Download aria-hidden="true" size={15} /> Download CSV</ExportLink>
        </div>
        {report.attendeeTypeGroups.length === 0
          ? <EmptyReport help={<EventSetupHelp eventId={event.id} context="reports" id="reports-no-attendees" sameAs="reports-no-attendees" />}>No active attendees are available yet.</EmptyReport>
          : <div className="roster-report-groups">
              {typeSorting.order.key && <SortOrderNote>{sortLine(typeSorting.order)}</SortOrderNote>}
              {report.attendeeTypeGroups.map((group) => (
                <article className="roster-report-group" key={group.id}>
                  <header>
                    <div><h3>{group.label}</h3><p>{/teen/i.test(group.label) ? "Teen Program roster" : "Attendee type"}</p></div>
                    <span>{group.attendees.length} {group.attendees.length === 1 ? "person" : "people"}</span>
                  </header>
                  <div className="report-table-wrap card-box">
                    <table role="table" className="report-table roster-table table-cards table-cards-compact">
                      <caption className="sr-only">{group.label} attendees</caption>
                      <thead role="rowgroup"><tr role="row"><ColumnHeader column="attendee" label="Attendee" sorting={typeSorting} /><ColumnHeader column="group" label="Group" sorting={typeSorting} /><ColumnHeader column="registration" label="Registration" sorting={typeSorting} /><ColumnHeader column="holder" label="Account holder" sorting={typeSorting} /></tr></thead>
                      <tbody role="rowgroup">
                        {sortRows(group.attendees, typeSorting.order.key, typeSorting.order.dir, {
                          attendee: (attendee) => formatPersonName(attendee, "sorted"),
                          group: (attendee) => attendee.groupLabel,
                          registration: (attendee) => attendee.confirmationCode,
                          holder: (attendee) => attendee.accountHolderName,
                        }).map((attendee) => (
                          <tr role="row" key={attendee.attendeeId}>
                            <th role="rowheader" scope="row" translate="no">{attendee.lastName}, {attendee.firstName}</th>
                            <td {...cardCell("Group")}>{attendee.groupLabel ?? "—"}</td>
                            <td {...cardCell("Registration")}><Link className="report-record-link" href={`/people${peopleQuery}&registration=${encodeURIComponent(attendee.registrationId)}`}>{attendee.confirmationCode}</Link></td>
                            <td {...cardCell("Account holder")} translate="no">{attendee.accountHolderName}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </article>
              ))}
            </div>}
      </section>

      {report.meals.length > 0 && (
        <section className="panel report-panel" id="meal-counts">
          <div className="section-heading report-section-heading">
            <div className="report-title">
              <span className="report-icon gold"><Utensils aria-hidden="true" size={19} /></span>
              <div><p className="eyebrow">Food service</p><h2>Meal and dietary-choice counts</h2><p>Counts structured meal choices and ticket quantities. Free-text dietary and allergy notes stay private.</p></div>
            </div>
            <ExportLink className="secondary-button report-download" href={reportDownloadHref(event.id, "meals")}><Download aria-hidden="true" size={15} /> Download meal CSV</ExportLink>
          </div>
          <CountFields fields={report.meals} emptyCopy="No structured meal or dietary-choice fields are configured on an active registration form yet." sorting={countSorts.meals} />
        </section>
      )}

      {report.housing.length > 0 && (
        <section className="panel report-panel" id="housing-counts">
          <div className="section-heading report-section-heading">
            <div className="report-title">
              <span className="report-icon green"><BedDouble aria-hidden="true" size={19} /></span>
              <div><p className="eyebrow">Lodging</p><h2>Housing and lodging counts</h2><p>Shows configured room, cabin, campsite, overnight, and housing selections without exposing private notes.</p></div>
            </div>
            <ExportLink className="secondary-button report-download" href={reportDownloadHref(event.id, "housing")}><Download aria-hidden="true" size={15} /> Download housing CSV</ExportLink>
          </div>
          <CountFields fields={report.housing} sorting={countSorts.housing} emptyCopy="No structured housing or lodging fields are configured on an active registration form yet." help={<EventSetupHelp eventId={event.id} context="this report section" id="reports-no-fields" />} />
        </section>
      )}

      {report.seminars.length > 0 && (
        <section className="panel report-panel" id="seminar-ranking">
          <div className="section-heading report-section-heading">
            <div className="report-title">
              <span className="report-icon purple"><ListOrdered aria-hidden="true" size={19} /></span>
              <div><p className="eyebrow">Program planning</p><h2>Ranked seminar interest</h2><p>Compares first choices, second choices, and total interest for every ranked-choice field.</p></div>
            </div>
            <ExportLink className="secondary-button report-download" href={reportDownloadHref(event.id, "seminars")}><Download aria-hidden="true" size={15} /> Download ranking CSV</ExportLink>
          </div>
          <SeminarFields fields={report.seminars} sorting={seminarSorting} />
        </section>
      )}

      {report.childcare.length > 0 && (
        <section className="panel report-panel" id="childcare-counts">
          <div className="section-heading report-section-heading">
            <div className="report-title">
              <span className="report-icon green"><Baby aria-hidden="true" size={19} /></span>
              <div><p className="eyebrow">Family support</p><h2>Childcare planning</h2><p>Counts structured childcare requests and child quantities without exporting free-text ages or care notes.</p></div>
            </div>
            <ExportLink className="secondary-button report-download" href={reportDownloadHref(event.id, "childcare")}><Download aria-hidden="true" size={15} /> Download childcare CSV</ExportLink>
          </div>
          <CountFields fields={report.childcare} sorting={countSorts.childcare} emptyCopy="No structured childcare fields are configured on an active registration form yet." help={<EventSetupHelp eventId={event.id} context="this report section" id="reports-no-fields" />} />
        </section>
      )}

      <section className="panel report-panel" id="volunteer-counts">
        <div className="section-heading report-section-heading">
          <div className="report-title">
            <span className="report-icon gold"><HandHeart aria-hidden="true" size={19} /></span>
            <div><p className="eyebrow">Service team</p><h2>Volunteer responses</h2><p>Shows structured willingness-to-help choices for staff follow-up and shift planning.</p></div>
          </div>
          <span className="report-download-group">
            {permissions.includes("MANAGE_COMMUNICATIONS") && (
              <EmailRegistrationsButton
                eventId={event.id}
                label="Email volunteers"
                registrationIds={report.volunteerRoster.map((volunteer) => volunteer.registrationId)}
              />
            )}
            <ExportLink className="secondary-button report-download" href={reportDownloadHref(event.id, "volunteer-roster")}><Download aria-hidden="true" size={15} /> Volunteer list CSV</ExportLink>
            <ExportLink className="secondary-button report-download" href={reportDownloadHref(event.id, "volunteers")}><Download aria-hidden="true" size={15} /> Counts CSV</ExportLink>
          </span>
        </div>
        {report.volunteers.length > 0 && <CountFields fields={report.volunteers} emptyCopy="" sorting={countSorts.volunteerCounts} />}
        <article className="roster-report-group" id="volunteer-roster">
          <header>
            <div><h3>Who said yes</h3><p>Everyone who answered yes to a volunteer question, with a phone number to reach them. &ldquo;Email volunteers&rdquo; writes to each registration&rsquo;s contact after you preview it.</p></div>
            <span>{report.volunteerRoster.length} {report.volunteerRoster.length === 1 ? "person" : "people"}</span>
          </header>
          {report.volunteerRoster.length === 0
            ? <EmptyReport>No one has said yes to a volunteer question yet.</EmptyReport>
            : <div className="report-table-wrap card-box">
                {volunteerSorting.order.key && <SortOrderNote>{sortLine(volunteerSorting.order)}</SortOrderNote>}
                <table role="table" className="report-table roster-table table-cards table-cards-compact">
                  <caption className="sr-only">Volunteers</caption>
                  <thead role="rowgroup"><tr role="row"><ColumnHeader column="volunteer" label="Volunteer" sorting={volunteerSorting} /><ColumnHeader column="answer" label="Answer" sorting={volunteerSorting} /><ColumnHeader column="phone" label="Phone" sorting={volunteerSorting} /><ColumnHeader column="group" label="Group" sorting={volunteerSorting} /><ColumnHeader column="registration" label="Registration" sorting={volunteerSorting} /></tr></thead>
                  <tbody role="rowgroup">
                    {sortRows(report.volunteerRoster, volunteerSorting.order.key, volunteerSorting.order.dir, {
                      volunteer: (volunteer) => formatPersonName(volunteer, "sorted"),
                      answer: (volunteer) => volunteer.answer,
                      phone: (volunteer) => volunteer.phone,
                      group: (volunteer) => volunteer.groupLabel,
                      registration: (volunteer) => volunteer.confirmationCode,
                    }).map((volunteer) => (
                      <tr role="row" key={`${volunteer.attendeeId}-${volunteer.question}`}>
                        <th role="rowheader" scope="row"><ExactValue>{volunteer.lastName}, {volunteer.firstName}</ExactValue><small className="quiet-copy"> · {volunteer.attendeeType}</small></th>
                        <td {...cardCell("Answer")}>{volunteer.answer}{report.volunteers.length > 1 && <small className="quiet-copy"> · {volunteer.question}</small>}</td>
                        <td {...cardCell("Phone")} translate="no">{volunteer.phone || "—"}</td>
                        <td {...cardCell("Group")}>{volunteer.groupLabel ?? "—"}</td>
                        <td {...cardCell("Registration")}><Link className="report-record-link" href={`/people${peopleQuery}&registration=${encodeURIComponent(volunteer.registrationId)}`}>{volunteer.confirmationCode}</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>}
        </article>
      </section>

      {report.attendance.length > 0 && (
        <section className="panel report-panel" id="attendance-counts">
          <div className="section-heading report-section-heading">
            <div className="report-title">
              <span className="report-icon navy"><CalendarCheck2 aria-hidden="true" size={19} /></span>
              <div><p className="eyebrow">Programme planning</p><h2>Optional-session attendance</h2><p>Counts structured attendance intentions such as Sunday sessions without treating interest rankings as attendance.</p></div>
            </div>
            <ExportLink className="secondary-button report-download" href={reportDownloadHref(event.id, "attendance")}><Download aria-hidden="true" size={15} /> Download attendance CSV</ExportLink>
          </div>
          <CountFields fields={report.attendance} sorting={countSorts.attendance} emptyCopy="No structured attendance fields are configured on an active registration form yet." help={<EventSetupHelp eventId={event.id} context="this report section" id="reports-no-fields" />} />
        </section>
      )}
      {emptyCountSections.length > 0 && (
        <p className="report-empty" data-testid="empty-report-sections">
          Not shown, because the active registration form has no structured fields for them: {emptyCountSections.join(", ")}.
        </p>
      )}
    </section>
  );
}
