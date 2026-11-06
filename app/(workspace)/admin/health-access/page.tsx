import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminPageHeader } from "@/components/admin-page-header";
import { HealthAccessGrants } from "@/components/health-access-grants";
import { HealthAccessHolds, type HoldRow } from "@/components/health-access-holds";
import { HealthPrivacyAcknowledgment } from "@/components/health-privacy-acknowledgment";
import { AccessDeniedError } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { hasAcknowledgedHealthPrivacy } from "@/modules/health-records/acknowledgment";
import { HealthRecordError } from "@/modules/health-records/errors";
import { healthRecordsEnabled } from "@/modules/health-records/flag";
import { listSnapshotBreakGlassGrants, listSnapshotHolds, requireSnapshotAdminViewer } from "@/modules/health-records/snapshot-access-repository";

export const metadata: Metadata = { title: "Break-glass and legal holds", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

/**
 * Break-glass and legal holds (#1617), for system administrators only (a Clubs Administrator does not get this page:
 * holds are system-only and it sits in the System navigation, though two of the routes accept one). It reads through the same functions as the GET routes, so the checks and
 * audits are the routes'; every change posts to the existing routes from the client components.
 *
 * Privacy acknowledgment first, as the routes require it, but only while HEALTH_RECORDS_ENABLED is on. With the
 * switch off the acknowledgment cannot be recorded (its route answers 404) and the hold and review routes do not
 * require it, so the page skips the gate and still shows holds and the grant review: holds must work with the switch off.
 */
export default async function HealthAccessPage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  // The routes' own check, without the Clubs Administrator allowance (holds are system-only), so a signed-in
  // non-administrator's refusal is audited the same way. Whatever the refusal, the answer is the no-access page.
  const viewer = await requireSnapshotAdminViewer("LIST_BREAK_GLASS", null, { flagOptional: true }).catch(async (error: unknown) => {
    if (error instanceof AccessDeniedError && error.status === 401) redirect(await staffLoginRedirectPath());
    if (error instanceof HealthRecordError && (error.code === "FORBIDDEN" || error.code === "NOT_FOUND")) redirect("/no-access");
    throw error;
  });
  if (healthRecordsEnabled() && !(await hasAcknowledgedHealthPrivacy(viewer))) {
    return (
      <>
        <AdminPageHeader path="/admin/health-access" />
        <HealthPrivacyAcknowledgment as="STAFF" />
      </>
    );
  }
  const [grants, holds] = await Promise.all([listSnapshotBreakGlassGrants(viewer), listSnapshotHolds(viewer)]);
  const holdRows: HoldRow[] = holds.map((hold) => ({
    ...hold,
    placedAt: hold.placedAt.toISOString(),
    liftedAt: hold.liftedAt ? hold.liftedAt.toISOString() : null,
  }));
  return (
    <>
      <AdminPageHeader path="/admin/health-access" />
      <div className="page-stack">
        <HealthAccessGrants grants={grants} now={new Date()} />
        <HealthAccessHolds holds={holdRows} />
      </div>
    </>
  );
}
