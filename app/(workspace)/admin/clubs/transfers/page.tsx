import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ClubTransferQueue } from "@/components/club-transfer-queue";
import { RegistrationMoveApprovals } from "@/components/registration-move-approvals";
import { hasClubsAdministration } from "@/modules/access/admin-roles";
import { getCurrentSession } from "@/modules/access/current-session";

export const metadata: Metadata = { title: "Club member transfers" };
export const dynamic = "force-dynamic";

/** Conference staff (#489): the transfer queue and the registration-move approval list. System administrators and Clubs Administrators (#1232). */
export default async function ClubTransfersAdminPage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (!(await hasClubsAdministration(user))) redirect("/no-access");
  return (
    <>
      <ClubTransferQueue />
      <RegistrationMoveApprovals />
    </>
  );
}
