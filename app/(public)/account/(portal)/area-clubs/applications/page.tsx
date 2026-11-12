import type { Metadata } from "next";
import { CoordinatorSectionHeading } from "@/components/coordinator-section-heading";
import { notFound } from "next/navigation";
import { CoordinatorUnavailable } from "@/components/coordinator-overview";
import { EmptyState } from "@/components/empty-state";
import { NewClubApplicationsQueue } from "@/components/new-club-applications-queue";
import { logError } from "@/lib/logger";
import { listNewClubApplications } from "@/modules/club-applications/repository";
import { isVisibleToCoordinator } from "@/modules/club-applications/domain";
import { currentApplicationViewer } from "@/modules/club-applications/viewer";
import { NEW_CLUBS_DECISION_TEXT } from "@/modules/club-reports/coordinator-destinations-domain";

export const metadata: Metadata = { title: "New club applications", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

/**
 * New clubs (#817, #1187): the same list a system administrator reviews, view
 * only. The Approve and Decline controls are never rendered here (`canDecide`
 * is false), and the decision route refuses a coordinator on the server.
 */
export default async function AreaNewClubApplicationsPage() {
  // Layouts do not re-run on navigation, so every page checks for itself (#657).
  const viewer = await currentApplicationViewer();
  if (!viewer) notFound();
  // A cancelled application leaves a coordinator's list 30 days after it was cancelled (#1554); staff still see it.
  const now = new Date();
  const applications = await listNewClubApplications(viewer).then((rows) => rows.filter((row) => isVisibleToCoordinator(row, now))).catch((error: unknown) => {
    // A failed read is "unavailable", never "no applications".
    logError("Coordinator new club applications read failed", error);
    return null;
  });
  return (
    <section className="page-stack">
      <div className="public-manage-card">
        <CoordinatorSectionHeading eyebrow="Club coordination" title="New clubs" />
        <p className="field-help">
          People who applied to start a new club. {NEW_CLUBS_DECISION_TEXT} Contact details and attachments are for your review and are not to be shared.
        </p>
      </div>
      {applications === null ? (
        <CoordinatorUnavailable what="New club applications" />
      ) : applications.length === 0 ? (
        <div className="public-manage-card">
          <EmptyState title="No new club applications yet">
            When someone applies to start a club, the application appears here with its details. System administrators approve or decline each one; you can read it but not decide it.
          </EmptyState>
        </div>
      ) : (
        <NewClubApplicationsQueue applications={applications} collapseCancelled />
      )}
    </section>
  );
}
