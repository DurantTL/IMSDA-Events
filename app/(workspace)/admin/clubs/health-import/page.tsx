import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { HealthImportWorkspace } from "@/components/health-import-workspace";
import { HealthPrivacyAcknowledgment } from "@/components/health-privacy-acknowledgment";
import { hasClubsAdministration } from "@/modules/access/admin-roles";
import { getCurrentSession } from "@/modules/access/current-session";
import { hasAcknowledgedHealthPrivacy } from "@/modules/health-records/acknowledgment";
import { healthRecordsEnabled } from "@/modules/health-records/flag";

export const metadata: Metadata = { title: "Import health records", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

/**
 * The Cognito health record import (#878). System administrators and Clubs Administrators (#1232); with
 * the Health Record feature off the page does not exist. The one-time privacy
 * notice comes first, as it does for every health surface.
 */
export default async function HealthImportPage() {
  if (!healthRecordsEnabled()) notFound();
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (!(await hasClubsAdministration(user))) redirect("/no-access");
  const acknowledged = await hasAcknowledgedHealthPrivacy({ kind: "SYSTEM_ADMIN", userId: user.id });
  return (
    <>
      <BackLink href={user.globalRole === "SYSTEM_ADMIN" ? "/admin/organizations" : "/admin/clubs/summary"} variant="staff">{user.globalRole === "SYSTEM_ADMIN" ? "Back to Clubs and churches" : "Back to Clubs"}</BackLink>
      {acknowledged ? <HealthImportWorkspace /> : <HealthPrivacyAcknowledgment as="STAFF" />}
    </>
  );
}
