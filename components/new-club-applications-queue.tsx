import styles from "@/components/new-club-applications-queue.module.css";
import { ApplicationDetails, ApplicationSummary, applicationStatusTone, formatApplicationDate } from "@/components/new-club-application-details";
import { newClubApplicationStatusLabels } from "@/modules/club-applications/domain";
import type { NewClubApplicationRecord } from "@/modules/club-applications/repository";

type Props = {
  applications: NewClubApplicationRecord[];
  /** Area Coordinator view (#1554): a cancelled application shows as one line that opens to the full card. */
  collapseCancelled?: boolean;
};

/**
 * The Area Coordinator's new club application list (#817, #1187): every application in full, view only. A coordinator
 * has no admin pages, so the new club's link opens its view-only workspace. Staff review applications in the queue
 * under /admin/clubs/applications (`components/staff-club-applications.tsx`), which also decides them.
 */
export function NewClubApplicationsQueue({ applications, collapseCancelled = false }: Props) {
  const waiting = applications.filter((application) => application.status === "PENDING");
  const decided = applications.filter((application) => application.status !== "PENDING");

  function renderApplication(application: NewClubApplicationRecord) {
    return (
      <article className="nca-card" data-application={application.id} id={`application-${application.id}`} key={application.id}>
        <ApplicationSummary application={application} />
        <ApplicationDetails application={application} clubHref={(id) => `/account/area/${encodeURIComponent(id)}`} />
      </article>
    );
  }

  function renderDecided(application: NewClubApplicationRecord) {
    if (!collapseCancelled || application.status !== "DECLINED") return renderApplication(application);
    return (
      <details className={styles.cancelled} data-application-collapsed={application.id} key={application.id}>
        <summary className={styles.summary}>
          <span className={styles.name} translate="no">{application.clubName}</span>
          <span className={`status-chip ${applicationStatusTone.DECLINED}`}>{newClubApplicationStatusLabels.DECLINED}</span>
          {application.decidedAt && <span className={styles.date}>{formatApplicationDate(application.decidedAt)}</span>}
        </summary>
        {renderApplication(application)}
      </details>
    );
  }

  return (
    <section className="page-stack nca-queue">
      <div className="panel">
        <div className="section-heading"><div><h2>{`Pending approval (${waiting.length})`}</h2></div></div>
        {waiting.length === 0 ? <p className="report-empty">No applications are waiting.</p> : <div className="nca-list">{waiting.map(renderApplication)}</div>}
      </div>

      {decided.length > 0 && (
        <div className="panel">
          <div className="section-heading"><div><h2>Recently decided</h2></div></div>
          <div className="nca-list">{decided.map(renderDecided)}</div>
        </div>
      )}
    </section>
  );
}
