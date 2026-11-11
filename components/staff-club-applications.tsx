import Link from "next/link";
import { GuardedLink } from "@/components/guarded-link";
import {
  ApplicationDetails,
  ApplicationSummary,
  formatApplicationDate,
} from "@/components/new-club-application-details";
import { StaffApplicationDecision } from "@/components/staff-application-decision";
import { StaffPrivateLinks } from "@/components/staff-private-links";
import styles from "@/components/staff-club-applications.module.css";
import {
  APPLICATION_VIEWS,
  APPLICATION_VIEW_LABELS,
  applicationHref,
  applicationsHref,
  type ApplicationView,
} from "@/modules/club-applications/queue-model";
import type { NewClubApplicationRecord, NewClubInviteRecord } from "@/modules/club-applications/repository";

type Church = { id: string; name: string; type: string };

/** The staff queue's intro: what applying and approving do, and the two links that used to sit in the page header. */
export function StaffApplicationsIntro({ showSettingsLink }: { showSettingsLink: boolean }) {
  return (
    <div className={styles.introBlock}>
      <p className={styles.intro}>
        Directors apply from the public “Register a new club” page or a private link you send. Approving creates the club under its sponsoring church or company and emails the director the club invite. The Sterling Volunteers status is a flag to review, not a block.
      </p>
      <div className={styles.tools}>
        <Link className="secondary-button" href="/clubs/register">View the public form</Link>
        {/* Platform settings is for system administrators only (#1839): a Clubs Administrator would land on "no access". */}
        {showSettingsLink && <Link className="secondary-button" href="/admin/settings">Notification address</Link>}
      </div>
    </div>
  );
}

/** Waiting, Decided and Private links, as links so the view is in the address (B2) and Back undoes a change. */
export function StaffApplicationViews({ view, waitingCount }: { view: ApplicationView; waitingCount: number }) {
  return (
    <nav aria-label="Application views" className={styles.views}>
      {APPLICATION_VIEWS.map((value) => (
        <GuardedLink aria-current={value === view ? "page" : undefined} className={styles.view} href={applicationsHref(value)} key={value}>
          {value === "waiting" ? `${APPLICATION_VIEW_LABELS.waiting} (${waitingCount})` : APPLICATION_VIEW_LABELS[value]}
        </GuardedLink>
      ))}
    </nav>
  );
}

/** One compact card: who, what, flags, and a link to the whole application. Approve and Decline live on the application's own page. */
export function StaffApplicationCard({ application }: { application: NewClubApplicationRecord }) {
  return (
    <li className={styles.card} data-application={application.id} id={`application-${application.id}`}>
      <ApplicationSummary application={application} />
      <p className={styles.meta}>
        <span translate="no">{application.director.name}</span> · submitted {formatApplicationDate(application.submittedAt)}
      </p>
      <Link className={`secondary-button ${styles.open}`} href={applicationHref(application.id)}>
        Open application<span className="sr-only">{` for ${application.clubName}`}</span>
      </Link>
    </li>
  );
}

/** The Waiting or Decided list. */
export function StaffApplicationList({ applications, view }: { applications: NewClubApplicationRecord[]; view: "waiting" | "decided" }) {
  const heading = <h2 className={styles.listHeading}>{view === "waiting" ? "Waiting applications" : "Decided applications"}</h2>;
  if (applications.length === 0) {
    return (
      <>
        {heading}
        <div className="report-empty">
          <p>{view === "waiting" ? "No applications are waiting." : "No applications have been decided yet."}</p>
          <p>
            {view === "waiting"
              ? <Link href={applicationsHref("links")}>Send a private link</Link>
              : <Link href={applicationsHref("waiting")}>Back to waiting applications</Link>}
          </p>
        </div>
      </>
    );
  }
  return (
    <>
      {heading}
      <ul className={styles.list}>{applications.map((application) => <StaffApplicationCard application={application} key={application.id} />)}</ul>
    </>
  );
}

/** The Private links view. */
export function StaffApplicationLinks({ invites, emailConfigured }: { invites: NewClubInviteRecord[]; emailConfigured: boolean }) {
  return <StaffPrivateLinks emailConfigured={emailConfigured} invites={invites} />;
}

/** One application in full, under a link back to the view it belongs to, with the Decision section below the details. */
export function StaffApplicationRecord({ application, churches }: { application: NewClubApplicationRecord; churches: Church[] }) {
  return (
    <div className={styles.record}>
      <article className="nca-card" data-application={application.id} id={`application-${application.id}`}>
        <ApplicationSummary application={application} headingLevel="h2" />
        <ApplicationDetails application={application} clubHref={(id) => `/admin/organizations/${encodeURIComponent(id)}/profile`} />
      </article>
      <StaffApplicationDecision application={application} churches={churches} />
    </div>
  );
}

/** The back link for the page header: to the view an application belongs to. */
export function applicationBackLink(view: "waiting" | "decided") {
  return { href: applicationsHref(view), label: view === "waiting" ? "Back to waiting applications" : "Back to decided applications" };
}

/** An address that names no application: a plain notice (the page header carries the way back), never another record. */
export function StaffApplicationMissing() {
  return (
    <div className={styles.record}>
      <p className="report-empty" role="status">That application could not be found.</p>
    </div>
  );
}
