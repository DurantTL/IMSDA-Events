import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CircleAlert } from "lucide-react";
import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { getCurrentSession } from "@/modules/access/current-session";
import { logError } from "@/lib/logger";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";
import { problemReportStatusLabel } from "@/modules/support/problem-report-domain";
import { listProblemReports } from "@/modules/support/problem-reports";
import { ProblemReportResolveButton } from "@/components/problem-report-resolve-button";
import { AdminSectionHeaderFor } from "@/components/admin-section-header";
import systemStyles from "../system-admin.module.css";
import styles from "./problem-reports.module.css";

export const metadata: Metadata = { title: "Problem reports" };

const stamp = (date: Date) => formatInConferenceTime(date, { dateStyle: "medium", timeStyle: "short" });

/** Problems people sent from the Forms help popup (#1483), open ones first. System administrators only. */
export default async function ProblemReportsPage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access?from=system");

  let reports: Awaited<ReturnType<typeof listProblemReports>> | null = null;
  try {
    reports = await listProblemReports();
  } catch (error) {
    logError("Problem reports page could not load the list", error);
  }
  const open = reports?.filter((report) => report.status === "OPEN").length ?? 0;

  return (
    <section className={`page-stack ${systemStyles.workspace}`}>
      <AdminSectionHeaderFor path="/admin/problem-reports" section="system" />
      <section className="panel" aria-labelledby="problem-reports-heading">
        <div className={systemStyles.sectionHeading}>
          <div>
            <p className="eyebrow">Forms help</p>
            <h2 id="problem-reports-heading" tabIndex={-1}>Problem reports</h2>
            <p>What people sent from the Forms help popup. The email, when given, is for following up. Mark a report completed once it is dealt with.</p>
          </div>
          <span>{reports ? (open === 0 ? "Nothing open" : `${open} open`) : "Unavailable"}</span>
        </div>
        {reports === null ? (
          <p className={systemStyles.unavailable} role="status"><CircleAlert aria-hidden="true" size={16} /><span><strong>Unavailable.</strong> The reports could not be read just now. This is not zero. Reload to try again.</span></p>
        ) : reports.length === 0 ? (
          <p className="quiet-copy">No problem reports have been sent.</p>
        ) : (
          <ul className={styles.list}>
            {reports.map((report) => (
              <li className={styles.item} key={report.id}>
                <div className={styles.head}>
                  <span className={styles.reference} translate="no">{report.reference}</span>
                  <span className="status-chip">{problemReportStatusLabel[report.status]}</span>
                  <span className={styles.when}>Sent {stamp(report.createdAt)}{report.resolvedAt ? `, completed ${stamp(report.resolvedAt)}` : ""}</span>
                </div>
                <p className={styles.message}>{report.message}</p>
                <dl className={styles.facts}>
                  <dt>Email</dt><dd translate="no">{report.email ?? "Not given"}</dd>
                  {report.details ? (
                    <>
                      {report.details.path && <><dt>Page</dt><dd translate="no">{report.details.path}</dd></>}
                      {report.details.userAgent && <><dt>Browser</dt><dd translate="no">{report.details.userAgent}</dd></>}
                      {report.details.viewport && <><dt>Window</dt><dd>{report.details.viewport}</dd></>}
                      {report.details.language && <><dt>Language</dt><dd translate="no">{report.details.language}</dd></>}
                      <dt>Translation</dt><dd>{report.details.translation === "on" ? "On" : "Not detected"}</dd>
                      <dt>Security check</dt><dd>{report.details.securityCheckBlocked ? "Did not load" : "No problem seen"}</dd>
                      <dt>Card form</dt><dd>{report.details.squareBlocked ? "Did not load" : "No problem seen"}</dd>
                      {typeof report.appVersion === "string" && <><dt>Version</dt><dd translate="no">{report.appVersion}</dd></>}
                    </>
                  ) : (
                    <><dt>Details</dt><dd>Not included</dd></>
                  )}
                </dl>
                {report.status === "OPEN" && <div><ProblemReportResolveButton id={report.id} reference={report.reference} /></div>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
