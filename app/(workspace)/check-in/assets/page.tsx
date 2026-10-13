import type { Metadata } from "next";
import { AccessRestricted } from "@/components/access-restricted";
import { AssetIssueDesk } from "@/components/asset-issue-desk";
import { resolveEventContext } from "@/modules/events/selection";
import { getAssigneeOptions, getDeskLots, getDeskPerson, getDeskTypes, listOutNow } from "@/modules/issued-assets/view";

export const metadata: Metadata = {
  title: "Issue keys and items",
  robots: { index: false, follow: false, nocache: true },
};

export default async function IssueAssetsPage({ searchParams }: { searchParams: Promise<{ event?: string; attendee?: string }> }) {
  const { event: requested, attendee } = await searchParams;
  const { event, permissions } = await resolveEventContext(requested);
  // Decided here on the server, and again by every API route the desk calls.
  if (!permissions.includes("MANAGE_CHECK_IN")) {
    return <AccessRestricted title="Issuing is restricted" detail="Event administrators and check-in staff can issue keys and other items." />;
  }
  const [types, lots, options, person] = await Promise.all([
    getDeskTypes(event.id),
    getDeskLots(event.id),
    getAssigneeOptions(event.id),
    attendee ? getDeskPerson(event.id, attendee) : Promise.resolve(null),
  ]);
  const outNow = person ? [] : await listOutNow(event.id, { limit: 100 });
  return <AssetIssueDesk key={`${event.id}:${person?.attendeeId ?? ""}`} eventId={event.id} types={types} lots={lots} options={options} person={person} outNow={outNow} />;
}
