import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ClubTransferQueue } from "@/components/club-transfer-queue";
import { RegistrationMoveApprovals } from "@/components/registration-move-approvals";
import { hasClubsAdministration } from "@/modules/access/admin-roles";
import { getCurrentSession } from "@/modules/access/current-session";
import { parseStaffQueueView } from "@/modules/club-transfers/domain";
import { AdminPageHeader } from "@/components/admin-page-header";

export const metadata: Metadata = { title: "Club member transfers" };
export const dynamic = "force-dynamic";

/** Conference staff (#489): the transfer queue and the registration-move approval list. `?view=` picks the queue's filter (#1589). The queue is open to system administrators and Clubs Administrators (#1232); registration-move approvals stay with system administrators. */
export default async function ClubTransfersAdminPage({ searchParams }: { searchParams: Promise<{ view?: string | string[] }> }) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (!(await hasClubsAdministration(user))) redirect("/no-access");
  const { view } = await searchParams;
  return (
    <>
      <AdminPageHeader path="/admin/clubs/transfers" />
      <ClubTransferQueue filter={parseStaffQueueView(view)} />
      {user.globalRole === "SYSTEM_ADMIN" && <RegistrationMoveApprovals />}
    </>
  );
}
