import type { Metadata } from "next";
import { BackLink } from "@/components/back-link";
import { ClubRosterWorkspace } from "@/components/club-roster-workspace";
import { NextYearRosterOffer } from "@/components/club-next-year-offer";
import { ClubTransfersPanel, RequestTransferButton } from "@/components/club-transfers-panel";
import { clubPortalComplianceStatuses } from "@/modules/background-checks/repository";
import { COMPLIANCE_FILTER_VALUES, type ComplianceFilterValue } from "@/modules/background-checks/domain";
import { getRosterAccessStateForPage } from "@/modules/club-rosters/access";
import { registrationReturnTo } from "@/modules/club-registrations/roster-return";
import { getCarryForwardOffer } from "@/modules/club-rosters/carry-forward";
import { carryForwardOversightOpen } from "@/modules/club-rosters/carry-forward-domain";
import { rosterYearView } from "@/modules/club-rosters/domain";
import { rosterGuardiansForAccess } from "@/modules/club-rosters/guardians-access";
import { ROSTER_DETAILS_NEEDED_FILTER } from "@/modules/club-rosters/roster-view";
import { listRoster } from "@/modules/club-rosters/repository";
import { listTransferClubOptions } from "@/modules/club-transfers/repository";
import { personIdsMovedToOtherClubs } from "@/modules/earned-awards/order-source";
import { requireHealthViewerForClub } from "@/modules/health-records/access";
import { healthRecordsEnabled } from "@/modules/health-records/flag";
import { HealthRecordError } from "@/modules/health-records/errors";
import { healthEntryStatusesForMembers, healthRecordFlagsForRoster, healthSummariesForMembers } from "@/modules/health-records/repository";

export const metadata: Metadata = { title: "Club roster" };
export const dynamic = "force-dynamic";

function complianceFilterFrom(value: string | undefined): ComplianceFilterValue | null {
  return COMPLIANCE_FILTER_VALUES.find((allowed) => allowed === value) ?? null;
}

export default async function ClubRosterPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ compliance?: string; filter?: string | string[]; year?: string | string[]; returnTo?: string | string[] }>;
}) {
  const [{ organizationId }, { compliance: complianceParam, filter: filterParam, year: yearParam, returnTo: returnToParam }] = await Promise.all([params, searchParams]);
  const access = await getRosterAccessStateForPage(organizationId);
  if (access.state !== "OPEN") return null;
  // The previous or next club year can be opened with ?year= (#541), read-only:
  // every roster write, the birth-date reveal, and transfers work on the
  // current year, so none of them is offered for another year.
  const { clubYear, currentClubYear, readOnly, contactsEditable } = rosterYearView(yearParam);
  // Status only, never the note, and only for a director or deputy: this is the club's own page (#427).
  // Transfers (#489) are the same leader-only capability that manages the club's team.
  const canTransfer = access.capabilities.manageTeam && !readOnly;
  const [members, complianceStatuses, clubOptions, guardians] = await Promise.all([
    listRoster(organizationId, clubYear),
    clubPortalComplianceStatuses(organizationId, clubYear, access.capabilities),
    canTransfer ? listTransferClubOptions(organizationId) : Promise.resolve([]),
    // Guardian contacts (#510): the club's director and deputy only, and only on the current and next year, where they can be edited (#959).
    contactsEditable ? rosterGuardiansForAccess(access, organizationId, clubYear) : Promise.resolve(undefined),
  ]);
  // No class history link for someone who has moved to another club (#791); the page would 404 for them. One query for the whole roster.
  const movedAway = await personIdsMovedToOtherClubs(organizationId, members.flatMap((member) => (member.personId ? [member.personId] : [])));
  const linkableMembers = members.map((member) => (member.personId && movedAway.has(member.personId) ? { ...member, personId: undefined } : member));
  // The Health tab (#611): only with the feature on, for the current year, and
  // for the club's own director or deputy. Status and a plain flag, never text.
  // A club Registrar (#923) gets an entry link with the status only: no clinical-note flag, nothing to read.
  // Until the one-time privacy acknowledgment is made, the link is shown without a status, so the person can reach the prompt.
  const memberIds = members.map((member) => member.id);
  const healthViewer = healthRecordsEnabled() && !readOnly ? await requireHealthViewerForClub(organizationId).catch(() => null) : null;
  const healthEntryOnly = healthViewer?.kind === "CLUB_REGISTRAR";
  const healthTab = healthViewer
    ? await (async () => {
      if (healthViewer.kind === "CLUB_LEADER") return healthSummariesForMembers(healthViewer, organizationId, memberIds);
      if (healthViewer.kind !== "CLUB_REGISTRAR") return undefined;
      const statuses = await healthEntryStatusesForMembers(healthViewer, organizationId, memberIds);
      return Object.fromEntries(Object.entries(statuses).map(([id, { status }]) => [id, { status, hasHealthNote: false }]));
    })().catch((error: unknown) => (error instanceof HealthRecordError && error.code === "ACKNOWLEDGMENT_REQUIRED"
      ? Object.fromEntries(memberIds.map((id) => [id, { status: "LOCKED" as const, hasHealthNote: false }]))
      : undefined))
    : undefined;
  // Anyone who can see these rows, with no health access, still sees a neutral
  // "Has a health record" marker: one boolean saying a record exists, no text (#611).
  const healthRecordFlags = readOnly ? undefined : await healthRecordFlagsForRoster(organizationId, members.map((member) => member.id)).catch(() => undefined);
  const registrationHref = registrationReturnTo(organizationId, returnToParam);
  const nextYearOffer = access.capabilities.manageTeam && !readOnly && carryForwardOversightOpen(new Date())
    ? await getCarryForwardOffer(organizationId)
    : null;
  return (
    <>
      {registrationHref && <BackLink href={registrationHref}>Back to registration</BackLink>}
      <p className="quiet-copy">
        <a href={`/account/clubs/${organizationId}/roster/export`}>Build a roster export</a> for an outside camporee.
      </p>
      {/* From August a director is offered next year's roster (#414); nothing rolls over until they confirm it. */}
      <NextYearRosterOffer offer={nextYearOffer} organizationId={organizationId} />
      {readOnly && (
        <p className="inline-notice" role="status">
          Showing the {clubYear} roster, read-only. {contactsEditable && guardians ? "A director or deputy can still edit emergency contacts here. " : ""}
          <a href={`/account/clubs/${organizationId}/roster`}>Back to {currentClubYear}</a> to
          add, edit, or remove people.
        </p>
      )}
      {/* Keyed by year, so a client-side year change never keeps the other year's people in the table. */}
      <ClubRosterWorkspace
        key={clubYear}
        classHistoryBase={`/account/clubs/${organizationId}/class-tracking`}
        canSeeBirthDates={access.capabilities.seeBirthDates && !readOnly}
        clubYear={clubYear}
        complianceFilter={complianceFilterFrom(complianceParam)}
        // `?filter=details-needed` (the club Home "Review roster" task) opens the roster already on that list; anything else is the whole roster (#1167).
        detailsNeededFirst={filterParam === ROSTER_DETAILS_NEEDED_FILTER}
        complianceStatuses={complianceStatuses}
        headingActions={canTransfer ? <RequestTransferButton clubOptions={clubOptions} organizationId={organizationId} /> : undefined}
        guardians={guardians}
        guardiansOnly={readOnly && contactsEditable}
        healthRecordFlags={healthRecordFlags}
        healthTab={healthTab}
        healthEntryOnly={healthEntryOnly}
        honorsPopup={{ canRecord: !readOnly }}
        initialMembers={linkableMembers}
        organizationId={organizationId}
        readOnly={readOnly}
      />
      {canTransfer && <ClubTransfersPanel organizationId={organizationId} />}
    </>
  );
}
