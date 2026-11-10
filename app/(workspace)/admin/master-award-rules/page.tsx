import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CatalogActionProvider, CatalogHeaderButton } from "@/components/catalog-header-action";
import { ListPage } from "@/components/page-templates/list-page";
import { MasterAwardRulesWorkspace } from "@/components/master-award-rules-workspace";
import { getCurrentSession } from "@/modules/access/current-session";
import { listMasterAwardRules, listRuleChoices } from "@/modules/earned-awards/rules-repository";
import { AdminSectionHeaderFor } from "@/components/admin-section-header";

export const metadata: Metadata = { title: "Master Award rules" };

/** Master Award rules (#532): system administrators import, review, edit and activate them. */
export default async function MasterAwardRulesPage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access?from=system");

  const [rules, choices] = await Promise.all([listMasterAwardRules(), listRuleChoices()]);
  return (
    <>
      <AdminSectionHeaderFor path="/admin/master-award-rules" section="system" />
      <CatalogActionProvider>
      <ListPage header={{ title: "Master Award rules", description: "Each rule has honor groups with a minimum, and clubs see progress only for the rules you have activated.", primary: <CatalogHeaderButton busyLabel="Reading…" icon="upload" label="Upload rules file" /> }}>
        <MasterAwardRulesWorkspace choices={choices} initialRules={rules} />
      </ListPage>
      </CatalogActionProvider>
    </>
  );
}
