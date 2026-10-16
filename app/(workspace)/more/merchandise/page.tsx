import type { Metadata } from "next";
import { AccessRestricted } from "@/components/access-restricted";
import { MerchandiseAdminWorkspace } from "@/components/merchandise-admin-workspace";
import { resolveEventContext } from "@/modules/events/selection";
import { staffPageTitles } from "@/components/staff-navigation";

export const metadata: Metadata = { title: staffPageTitles.merchandise };

export default async function MerchandisePage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string }>;
}) {
  const requested = (await searchParams).event;
  const { event, permissions } = await resolveEventContext(requested);
  if (!permissions.includes("CONFIGURE_EVENT")) {
    return <AccessRestricted title="Merchandise catalog access is restricted" detail="Ask an event administrator for configuration access before changing products, artwork, or availability." />;
  }
  return (
    <>
      <MerchandiseAdminWorkspace eventId={event.id} />
    </>
  );
}
