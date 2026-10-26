import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CircleAlert } from "lucide-react";
import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { getCurrentSession } from "@/modules/access/current-session";
import { logError } from "@/lib/logger";
import { ModuleRequestQueue } from "@/components/module-request-queue";
import { formatRequestDate } from "@/modules/event-modules/request-domain";
import { listPendingModuleRequests } from "@/modules/event-modules/requests";
import styles from "../system-admin.module.css";

export const metadata: Metadata = { title: "Feature requests" };

/** The feature-request review queue, moved off the System home (#1228) so the home changes nothing. System administrators only. */
export default async function FeatureRequestsPage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access");

  let requests: Awaited<ReturnType<typeof listPendingModuleRequests>> | null = null;
  try {
    requests = await listPendingModuleRequests();
  } catch (error) {
    logError("Feature requests page could not load the queue", error);
  }

  return (
    <section className={`page-stack ${styles.workspace}`}>
      <section className="panel module-requests" id="module-requests" aria-labelledby="module-requests-heading">
        <div className={styles.sectionHeading}>
          <div><p className="eyebrow">Event modules</p><h2 id="module-requests-heading" tabIndex={-1}>Feature requests</h2><p>Event admins asking for a feature to be turned on. Approving turns it on for that event; declining needs a reason. Only the buttons in this list decide a request.</p></div>
          <span>{requests ? `${requests.length} waiting` : "Unavailable"}</span>
        </div>
        {requests === null
          ? <p className={styles.unavailable} role="status"><CircleAlert aria-hidden="true" size={16} /><span><strong>Unavailable.</strong> The feature-request list could not be read just now. This is not zero. Reload to try again.</span></p>
          : requests.length === 0
            ? <p className="quiet-copy">No requests are waiting.</p>
            : <ModuleRequestQueue requests={requests.map((request) => ({
                id: request.id,
                eventId: request.eventId,
                eventName: request.eventName,
                moduleTitle: request.moduleTitle,
                requesterName: request.requesterName,
                reason: request.reason,
                createdLabel: formatRequestDate(request.createdAt),
              }))} />}
      </section>
    </section>
  );
}
