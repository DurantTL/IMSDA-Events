import Link from "next/link";
import { formatApplicationDate } from "@/components/new-club-application-details";
import { StaffVisitingLinks } from "@/components/staff-visiting-links";
import { StaffVisitingDecision } from "@/components/staff-visiting-decision";
import styles from "@/components/staff-visiting-clubs.module.css";
import { VISITING_PATH, visitingClubTypeLabels, visitingRequestHref } from "@/modules/visiting-clubs/domain";
import type { VisitingEventOption, VisitingInviteRecord, VisitingRequestRecord } from "@/modules/visiting-clubs/repository";

const statusLabels = { PENDING: "Pending approval", APPROVED: "Confirmed", DECLINED: "Cancelled" } as const;
const statusTone = { PENDING: "gold", APPROVED: "green", DECLINED: "coral" } as const;

/** The Visiting clubs tab's own short intro: what a visiting club is, in the staff's terms. */
export function StaffVisitingIntro() {
  return (
    <p className={styles.help}>
      A visiting club comes from outside the conference for one event. Send its director a private link, then approve their request here. The club is a guest for that event only, at the same prices, billed to itself. The director confirms their own conference&apos;s adult screening.
    </p>
  );
}

/** The Visiting clubs view (#835): the link form and list, then the requests with the waiting ones first. */
export function StaffVisitingView({
  events,
  invites,
  requests,
  emailConfigured,
  canOpenSetup,
}: {
  events: VisitingEventOption[];
  invites: VisitingInviteRecord[];
  requests: VisitingRequestRecord[];
  emailConfigured: boolean;
  canOpenSetup: boolean;
}) {
  return (
    <div className={styles.stack}>
      <StaffVisitingLinks canOpenSetup={canOpenSetup} emailConfigured={emailConfigured} events={events} invites={invites} />
      <h2 className={styles.heading}>Visiting club requests</h2>
      {requests.length === 0 ? (
        <div className="report-empty"><p>No visiting club has asked to register yet.</p></div>
      ) : (
        <ul className={styles.list}>
          {requests.map((request) => (
            <li className={styles.requestRow} data-request={request.id} key={request.id}>
              <div className={styles.cardHead}>
                <span className={styles.rowText}>
                  <strong translate="no">{request.clubName}</strong>
                  <small>{visitingClubTypeLabels[request.clubType]} for <span translate="no">{request.event.name}</span></small>
                </span>
                <span className={`status-chip ${statusTone[request.status]}`}>{statusLabels[request.status]}</span>
              </div>
              <p className={styles.meta}>
                <span translate="no">{request.director.name}</span> · submitted {formatApplicationDate(request.submittedAt)}
              </p>
              <Link className={`secondary-button ${styles.open}`} href={visitingRequestHref(request.id)}>
                Open request<span className="sr-only">{` for ${request.clubName}`}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** One request in full, with the Decision section below the details. */
export function StaffVisitingRecord({ request }: { request: VisitingRequestRecord }) {
  return (
    <div className={styles.record}>
      <article className={styles.card} data-request={request.id}>
        <header className={styles.cardHead}>
          <div>
            <h2 translate="no">{request.clubName}</h2>
            <p className={styles.meta}>{visitingClubTypeLabels[request.clubType]} for <span translate="no">{request.event.name}</span></p>
          </div>
          <span className={`status-chip ${statusTone[request.status]}`}>{statusLabels[request.status]}</span>
        </header>
        <dl className={styles.facts}>
          <div><dt>Home conference</dt><dd translate="no">{request.homeConference}</dd></div>
          <div><dt>Home church</dt><dd translate="no">{request.homeChurch}</dd></div>
          <div><dt>Director</dt><dd translate="no">{request.director.name}</dd></div>
          <div><dt>Director email</dt><dd translate="no">{request.director.email}</dd></div>
          <div><dt>Director phone</dt><dd translate="no">{request.director.phone}</dd></div>
          <div>
            <dt>Adult screening</dt>
            <dd>The director confirmed their own conference&apos;s adult screening on {formatApplicationDate(request.screeningConfirmedAt)}.</dd>
          </div>
          <div><dt>Submitted</dt><dd>{formatApplicationDate(request.submittedAt)}</dd></div>
          {request.decidedAt && (
            <div><dt>Decided</dt><dd>{formatApplicationDate(request.decidedAt)}{request.decidedByName ? ` by ${request.decidedByName}` : ""}</dd></div>
          )}
          {request.declineReason && <div><dt>Reason given</dt><dd>{request.declineReason}</dd></div>}
          {request.createdOrganizationId && (
            <div>
              <dt>Guest club</dt>
              <dd><Link href={`/admin/organizations/${encodeURIComponent(request.createdOrganizationId)}/profile`}>Open the club</Link></dd>
            </div>
          )}
        </dl>
      </article>
      <StaffVisitingDecision request={request} />
    </div>
  );
}

export function StaffVisitingMissing() {
  return (
    <div className={styles.record}>
      <p className="report-empty" role="status">That request could not be found.</p>
    </div>
  );
}

/** The back link for the page header: to the Visiting clubs view. */
export const visitingBackLink = { href: VISITING_PATH, label: "Back to visiting clubs" };
