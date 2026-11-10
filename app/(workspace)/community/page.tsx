import type { Metadata } from "next";
import Link from "next/link";
import { MessagesSquare } from "lucide-react";
import { AccessRestricted } from "@/components/access-restricted";
import { PageHeader } from "@/components/page-header";
import { CommunityModerationWorkspace } from "@/components/community-moderation-workspace";
import { getStaffCommunity } from "@/modules/community/repository";
import { resolveEventContext } from "@/modules/events/selection";
import { NotAvailableForEvent } from "@/components/not-available-for-event";

export const metadata: Metadata = { title: "Attendee community" };

export default async function CommunityPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string }>;
}) {
  const requested = (await searchParams).event;
  const { event, permissions } = await resolveEventContext(requested);
  if (!permissions.includes("MANAGE_COMMUNICATIONS")) {
    // The page draws its own title (#1772), so the restricted state keeps the page's one h1 too.
    return (
      <>
        <PageHeader title="Attendee community" />
        <AccessRestricted
          title="Community moderation is restricted"
          detail="Only event administrators and communications managers can enable or moderate attendee discussion."
          whoToAsk="your event administrator"
        />
      </>
    );
  }
  const community = await getStaffCommunity(event.id);
  if (!community) {
    return (
      <>
        <PageHeader title="Attendee community" />
        <NotAvailableForEvent reason="The selected event could not be loaded." />
      </>
    );
  }
  return (
    <section className="page-stack community-workspace">
      <PageHeader
        title="Attendee community"
        description={`Open, pause and moderate the private attendee discussion for ${event.name}.`}
        secondary={(
          <Link className="secondary-button" href={`/account/events/${encodeURIComponent(event.slug)}?preview=staff`}>
            <MessagesSquare size={16} aria-hidden="true" /> Attendee preview
          </Link>
        )}
      />
      <CommunityModerationWorkspace community={community} />
    </section>
  );
}
