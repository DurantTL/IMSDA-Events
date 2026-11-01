import type { Metadata } from "next";
import { AccessRestricted } from "@/components/access-restricted";
import { ScholarshipFundWorkspace } from "@/components/scholarship-fund-workspace";
import { resolveEventContext } from "@/modules/events/selection";
import { getFundView, listSponsorDirectory } from "@/modules/scholarship-funds/repository";

export const metadata: Metadata = { title: "Scholarship fund" };

export default async function ScholarshipFundPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const { event: requested } = await searchParams;
  const { event, permissions } = await resolveEventContext(requested);
  if (!permissions.includes("MANAGE_FINANCE")) {
    return <AccessRestricted title="Finance is restricted" detail="Only event administrators and finance managers can view or change the scholarship fund." whoToAsk="your event administrator" />;
  }
  const [fund, directory] = await Promise.all([getFundView(event.id), listSponsorDirectory()]);
  return <ScholarshipFundWorkspace key={event.id} eventId={event.id} eventName={event.name} initialFund={fund} directory={directory} />;
}
