import type { Metadata } from "next";
import { AccessRestricted } from "@/components/access-restricted";
import { canOpenIssueDesk } from "@/components/issued-assets-views-model";
import { IssuedAssetsViewsStrip } from "@/components/issued-assets-views-strip";
import { IssuedAssetsWorkspace } from "@/components/issued-assets-workspace";
import { PageHeader } from "@/components/page-header";
import { staffPageTitles } from "@/components/staff-navigation";
import { resolveEventContext } from "@/modules/events/selection";
import { getCatalogView } from "@/modules/issued-assets/view";

export const metadata: Metadata = { title: staffPageTitles.issuedAssets, robots: { index: false, follow: false, nocache: true } };

export default async function IssuedAssetsPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const { event: requested } = await searchParams;
  const { event, permissions } = await resolveEventContext(requested);
  // Authorization is decided here on the server, and again by every API route the screen calls.
  if (!permissions.includes("CONFIGURE_EVENT")) {
    return <>
      <PageHeader title={staffPageTitles.issuedAssets} />
      <AccessRestricted title="Issued assets are restricted" detail="Event administrators can set up the keys, keycards and other items this event hands out." whoToAsk="your event administrator" />
    </>;
  }
  return <IssuedAssetsWorkspace
    eventId={event.id} initialCatalog={await getCatalogView(event.id)}
    canOpenDesk={canOpenIssueDesk(permissions)}
    strip={<IssuedAssetsViewsStrip current="inventory" eventId={event.id} permissions={permissions} />}
  />;
}
