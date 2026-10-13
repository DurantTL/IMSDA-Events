import type { Metadata } from "next";
import { AccessRestricted } from "@/components/access-restricted";
import { IssuedAssetsWorkspace } from "@/components/issued-assets-workspace";
import { staffPageTitles } from "@/components/staff-navigation";
import { resolveEventContext } from "@/modules/events/selection";
import { getCatalogView } from "@/modules/issued-assets/view";

export const metadata: Metadata = { title: staffPageTitles.issuedAssets, robots: { index: false, follow: false, nocache: true } };

export default async function IssuedAssetsPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const { event: requested } = await searchParams;
  const { event, permissions } = await resolveEventContext(requested);
  // Authorization is decided here on the server, and again by every API route the screen calls.
  if (!permissions.includes("CONFIGURE_EVENT")) {
    return <AccessRestricted title="Issued assets are restricted" detail="Event administrators can set up the keys, keycards and other items this event hands out." />;
  }
  return <IssuedAssetsWorkspace eventId={event.id} eventName={event.name} initialCatalog={await getCatalogView(event.id)} />;
}
