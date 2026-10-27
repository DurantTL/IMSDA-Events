import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MasterAwardRulesWorkspace } from "@/components/master-award-rules-workspace";
import { getCurrentSession } from "@/modules/access/current-session";
import { listMasterAwardRules, listRuleChoices } from "@/modules/earned-awards/rules-repository";
import { AdminSectionHeaderFor } from "@/components/admin-section-header";

export const metadata: Metadata = { title: "Master Award rules" };

/** Master Award rules (#532): system administrators import, review, edit and activate them. */
export default async function MasterAwardRulesPage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access");

  const [rules, choices] = await Promise.all([listMasterAwardRules(), listRuleChoices()]);
  return (
    <>
      <AdminSectionHeaderFor path="/admin/master-award-rules" section="system" />
      <MasterAwardRulesWorkspace choices={choices} initialRules={rules} />
    </>
  );
}
