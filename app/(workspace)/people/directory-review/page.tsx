import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck, Users } from "lucide-react";
import { AccessRestricted } from "@/components/access-restricted";
import { resolveEventContext } from "@/modules/events/selection";
import { listDirectoryReviewEntries } from "@/modules/forms/directory-review";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Directory review" };

const sourceLabel = { CLUBS_DIRECTORY: "Club", CHURCHES_DIRECTORY: "Church", SCHOOLS_DIRECTORY: "School" } as const;

export default async function DirectoryReviewPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const { event: requested } = await searchParams;
  const { event, permissions } = await resolveEventContext(requested);
  if (!permissions.includes("MANAGE_REGISTRATION")) {
    return (
      <>
        <PageHeader title="Directory review" />
        <AccessRestricted
        title="Directory review is restricted"
        detail="Only event administrators and registration managers can review clubs and churches that weren't found in the directory."
        whoToAsk="your event administrator"
      />
      </>
    );
  }

  const entries = await listDirectoryReviewEntries(event.id);

  return (
    <section className="page-stack">
      <PageHeader
        title="Directory review"
        description={<>Clubs and churches typed in as &ldquo;Not listed&rdquo; for {event.name} because they were not in the directory; nothing was blocked from registering.</>}
      />
      {entries.length === 0 ? (
        <EmptyState className="panel empty-state" hint="Nothing to do here. New answers that are not in the directory will be listed as people register." icon={<ShieldCheck aria-hidden="true" size={24} />} title="Nothing to review">Every club and church answer for this event matched the live directory.</EmptyState>
      ) : (
        <section className="panel finance-list" aria-label="Not listed club and church answers">
          <div className="finance-row finance-head"><span>Confirmation</span><span>Field</span><span>Typed name</span><span /></div>
          {entries.map((entry, index) => (
            <div className="finance-row" key={`${entry.registrationId}-${entry.fieldLabel}-${index}`}>
              <span><strong>{entry.confirmationCode}</strong></span>
              <span>{sourceLabel[entry.source]} · {entry.fieldLabel}</span>
              <span>{entry.freeText || <em>No name entered</em>}</span>
              <span>
                <Link className="text-button" href={`/people?event=${encodeURIComponent(event.id)}&registration=${encodeURIComponent(entry.registrationId)}`}>
                  <Users aria-hidden="true" size={14} /> Open registration
                </Link>
              </span>
            </div>
          ))}
        </section>
      )}
    </section>
  );
}
