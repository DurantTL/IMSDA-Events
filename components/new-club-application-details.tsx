import { ExactValue } from "@/components/exact-value";
import { Paperclip } from "lucide-react";
import { sponsorOptionLabel } from "@/modules/organizations/domain";
import {
  directorBackgroundLabels,
  newClubApplicationStatusLabels,
  newClubTypeLabels,
  type DirectorBackgroundState,
} from "@/modules/club-applications/domain";
import type { NewClubApplicationRecord } from "@/modules/club-applications/repository";

/**
 * The read-only parts of a new club application (#817, #1589), shared by the staff queue's cards and record page and the
 * Area Coordinator's list, so an application reads the same wherever it shows. Presentation only: no decision controls.
 */

const sterlingTone: Record<DirectorBackgroundState, string> = { CLEAR: "green", FLAGGED: "gold", NOT_COMPLIANT: "coral", NO_RECORD: "neutral" };
export const applicationStatusTone = { PENDING: "gold", APPROVED: "green", DECLINED: "coral" } as const;

export function formatApplicationDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", { dateStyle: "medium" });
}

function formatSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Club name, type and sponsor, the status chip, the Sterling and other flag chips, and the possible duplicates. */
export function ApplicationSummary({ application, headingLevel = "h3" }: { application: NewClubApplicationRecord; headingLevel?: "h2" | "h3" }) {
  const Heading = headingLevel;
  return (
    <>
      <header className="nca-head">
        <div>
          <Heading translate="no">{application.clubName}</Heading>
          <p>
            {newClubTypeLabels[application.clubType]} · sponsored by{" "}
            {application.church.unavailable && !application.church.name
              ? <em>the church is no longer in the directory</em>
              : <span translate="no">{application.church.type ? sponsorOptionLabel({ name: application.church.name, type: application.church.type }) : application.church.name}</span>}
            {application.church.isOther && " (typed by the applicant, not in the directory)"}
            {application.church.unavailable && application.church.name && " (no longer an active church in the directory)"}
          </p>
        </div>
        <span className={`status-chip ${applicationStatusTone[application.status]}`}>{newClubApplicationStatusLabels[application.status]}</span>
      </header>

      <div className="nca-flags">
        <span className={`status-chip ${sterlingTone[application.sterling]}`} title="Sterling Volunteers status of the applying director. A flag to review, not a block.">
          Sterling Volunteers: {directorBackgroundLabels[application.sterling]}
        </span>
        {application.sterlingAmbiguous && (
          <span className="status-chip gold" title="The director's email matches more than one person; the least favorable status is shown.">Email matches more than one person</span>
        )}
        {application.sterlingNameMismatch && (
          <span className="status-chip gold" title="A person was found by the director's email, but with a different name. Check before relying on the status.">Matched by email to a different name</span>
        )}
        {application.source === "INVITE" && (
          <span className="status-chip purple">
            {application.invitedEmail ? <>Came by private link sent to <span translate="no">{application.invitedEmail}</span></> : "Came from a private link"}
          </span>
        )}
        {application.invitedEmailDiffers && <span className="status-chip gold">Director email differs from the invited address</span>}
      </div>
      {application.duplicates.length > 0 && (
        <ul className="nca-duplicates" aria-label="Possible duplicates">
          {application.duplicates.map((flag) => <li key={flag.kind}>{`Possible duplicate: ${flag.message}`}</li>)}
        </ul>
      )}
    </>
  );
}

/** Every detail the applicant gave, the attachment, who decided, and a link to the club once it exists. `clubHref` is where "Open the new club" goes for this viewer. */
export function ApplicationDetails({ application, clubHref }: { application: NewClubApplicationRecord; clubHref: (organizationId: string) => string }) {
  return (
    <dl className="nca-details">
      <div><dt>Director</dt><dd translate="no">{application.director.name}</dd></div>
      <div><dt>Email</dt><dd translate="no">{application.director.email}</dd></div>
      <div><dt>Mailing address</dt><dd translate="no">{application.director.address}</dd></div>
      <div><dt>Home phone</dt><dd translate={application.director.homePhone ? "no" : undefined}>{application.director.homePhone ?? "Not given"}</dd></div>
      <div><dt>Work phone</dt><dd translate={application.director.workPhone ? "no" : undefined}>{application.director.workPhone ?? "Not given"}</dd></div>
      <div><dt>Pastor</dt><dd translate="no">{application.pastorName}</dd></div>
      <div>
        <dt>Typed signatures</dt>
        <dd>
          Pastor <ExactValue>{application.signatures.pastor}</ExactValue>; Head elder <ExactValue>{application.signatures.headElder}</ExactValue>; Clerk <ExactValue>{application.signatures.clerk}</ExactValue>; Director <ExactValue>{application.signatures.director}</ExactValue>
        </dd>
      </div>
      {application.otherBoardMembers.length > 0 && (
        <div><dt>Other church board members</dt><dd translate="no">{application.otherBoardMembers.join(", ")}</dd></div>
      )}
      {application.note && <div><dt>Note</dt><dd translate="no">{application.note}</dd></div>}
      <div><dt>Submitted</dt><dd>{`${formatApplicationDate(application.submittedAt)} (application dated ${application.applicationDate})`}</dd></div>
      {application.attachment && (
        <div>
          <dt>Attachment</dt>
          <dd>
            <a href={`/api/admin/club-applications/${encodeURIComponent(application.id)}/attachment`}>
              <Paperclip aria-hidden="true" size={13} /> {application.attachment.name}
            </a>{" "}
            <small>({formatSize(application.attachment.byteSize)})</small>
          </dd>
        </div>
      )}
      {application.status === "DECLINED" && application.declineReason && <div><dt>Reason given</dt><dd translate="no">{application.declineReason}</dd></div>}
      {application.decidedAt && <div><dt>Decided</dt><dd>{formatApplicationDate(application.decidedAt)}{application.decidedByName ? ` by ${application.decidedByName}` : ""}</dd></div>}
      {application.createdOrganizationId && (
        <div><dt>Club</dt><dd><a href={clubHref(application.createdOrganizationId)}>Open the new club</a></dd></div>
      )}
    </dl>
  );
}
