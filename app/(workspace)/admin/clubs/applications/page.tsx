import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { StaffPageHeader } from "@/components/staff-page-header";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NewClubApplicationsQueue } from "@/components/new-club-applications-queue";
import { hasClubsAdministration } from "@/modules/access/admin-roles";
import { getCurrentSession } from "@/modules/access/current-session";
import { listNewClubApplications, listNewClubInvites, listPublicSponsorOptions } from "@/modules/club-applications/repository";
import { isAccountEmailConfigured } from "@/modules/communications/account-email";
import { AdminPageHeader } from "@/components/admin-page-header";

export const metadata: Metadata = { title: "New club applications" };
export const dynamic = "force-dynamic";

/**
 * The new club application queue (#817) for system administrators and Clubs Administrators,
 * who approve and decline. Area Coordinators read the same list, view only, from their
 * Clubs menu.
 */
export default async function NewClubApplicationsAdminPage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (!(await hasClubsAdministration(user))) redirect("/no-access");
  const viewer = user.globalRole === "SYSTEM_ADMIN" ? "SYSTEM_ADMIN" : "CLUBS_ADMIN";
  const [applications, invites, churches] = await Promise.all([
    listNewClubApplications(viewer),
    listNewClubInvites(viewer),
    listPublicSponsorOptions(),
  ]);
  return (
    <>
      <AdminPageHeader path="/admin/clubs/applications" />
      <StaffPageHeader
        description="Directors apply from the public “Register a new club” page or a private link you send. Approving creates the club under its sponsoring church or company and emails the director the club invite. The Sterling Volunteers status is a flag to review, not a block."
        tools={[
          { href: "/clubs/register", label: "View the public form" },
          { href: "/admin/settings", label: "Notification address" },
        ]}
      />
      <NewClubApplicationsQueue
        applications={applications}
        canDecide
        churches={churches}
        emailConfigured={isAccountEmailConfigured()}
        invites={invites}
      />
    </>
  );
}
