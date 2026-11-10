import type { Metadata } from "next";
import { AccessRestricted } from "@/components/access-restricted";
import { AssetCloseoutWorkspace } from "@/components/asset-closeout-workspace";
import { canOpenIssueDesk, closeoutPermissions } from "@/components/issued-assets-views-model";
import { IssuedAssetsViewsStrip } from "@/components/issued-assets-views-strip";
import { PageHeader } from "@/components/page-header";
import { resolveEventContext } from "@/modules/events/selection";
import { getCloseoutReport } from "@/modules/issued-assets/closeout";
import { getAssigneeOptions } from "@/modules/issued-assets/view";

export const metadata: Metadata = { title: "Issued asset closeout", robots: { index: false, follow: false, nocache: true } };

export default async function IssuedAssetsCloseoutPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const { event: requested } = await searchParams;
  const { event, permissions } = await resolveEventContext(requested);
  // Decided here on the server, and again by every API route the screen calls.
  const canRead = closeoutPermissions.some((permission) => permissions.includes(permission));
  if (!canRead) {
    return <>
      <PageHeader title="Issued asset closeout" />
      <AccessRestricted title="The closeout is restricted" detail="Check-in staff, finance, report viewers and event administrators can see what is still out, lost, charged or held." whoToAsk="your event administrator" />
    </>;
  }
  const [report, options] = await Promise.all([getCloseoutReport(event.id), getAssigneeOptions(event.id)]);
  return <AssetCloseoutWorkspace
    eventId={event.id} report={report} staff={options.staff}
    canManageMoney={permissions.includes("MANAGE_FINANCE") || permissions.includes("CONFIGURE_EVENT")}
    canConfigure={permissions.includes("CONFIGURE_EVENT")}
    canOpenDesk={canOpenIssueDesk(permissions)}
    canUpdateFacility={permissions.includes("MANAGE_CHECK_IN") || permissions.includes("CONFIGURE_EVENT")}
    strip={<IssuedAssetsViewsStrip current="closeout" eventId={event.id} permissions={permissions} />}
  />;
}
