import { redirect } from "next/navigation";
import { AdminHub } from "@/components/admin-hub";
import { hasClubsAdministration } from "@/modules/access/admin-roles";
import { getCurrentSession } from "@/modules/access/current-session";
import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { canManageSiteContent } from "@/modules/access/site-content-editor";
import { loadHubMetrics } from "@/modules/system-admin/admin-hubs-repository";
import { buildHubView, canOpenHub, type AdminHubKey, type HubViewer } from "@/modules/system-admin/admin-hubs-model";

/**
 * Shared body of the five Admin hub pages (#1569). A viewer who cannot open the hub gets the no-access page like every
 * other admin page; the numbers are read only for the cards and numbers that viewer sees.
 */
export async function AdminHubPage({ hub }: { hub: AdminHubKey }) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  const isSystemAdmin = user.globalRole === "SYSTEM_ADMIN";
  const viewer: HubViewer = {
    isSystemAdmin,
    clubsAdmin: await hasClubsAdministration(user),
    siteContentEditor: await canManageSiteContent(user),
  };
  if (!canOpenHub(hub, viewer)) redirect("/no-access");
  const values = await loadHubMetrics(hub, viewer);
  return <AdminHub view={buildHubView(hub, viewer, values)} />;
}
