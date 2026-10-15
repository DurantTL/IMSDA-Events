import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { HealthImportWorkspace } from "@/components/health-import-workspace";
import { HealthPrivacyAcknowledgment } from "@/components/health-privacy-acknowledgment";
import { getCurrentSession } from "@/modules/access/current-session";
import { hasAcknowledgedHealthPrivacy } from "@/modules/health-records/acknowledgment";
import { healthRecordsEnabled } from "@/modules/health-records/flag";

export const metadata: Metadata = { title: "Import health records", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

/**
 * The Cognito health record import (#878). System administrators only; with
 * the Health Record feature off the page does not exist. The one-time privacy
 * notice comes first, as it does for every health surface.
 */
export default async function HealthImportPage() {
  if (!healthRecordsEnabled()) notFound();
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access");
  const acknowledged = await hasAcknowledgedHealthPrivacy({ kind: "SYSTEM_ADMIN", userId: user.id });
  return (
    <>
      <BackLink href="/admin/organizations" variant="staff">Back to Clubs and churches</BackLink>
      {acknowledged ? <HealthImportWorkspace /> : <HealthPrivacyAcknowledgment as="STAFF" />}
    </>
  );
}
