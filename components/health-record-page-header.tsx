import type { ReactNode } from "react";
import { RestrictedPageHeader } from "@/components/restricted-page-header";

export const HEALTH_RECORD_PURPOSE = "Confidential · view only. Opening this page is recorded.";

/**
 * The header frame of the staff health record page (#1584), shared by every state of it: the record, the privacy notice,
 * break-glass and the restricted notices. The shell draws the page's `h1`. The back link goes to the event's health
 * information only when the page was opened from an event (`?event=`), and carries nothing but that event id. The
 * subject is passed by the page only once a record is open.
 */
export function HealthRecordPageHeader({ eventId, subject }: { eventId?: string; subject?: ReactNode }) {
  return (
    <RestrictedPageHeader
      back={eventId ? { href: `/more/event-health?event=${encodeURIComponent(eventId)}`, label: "Back to event health information" } : undefined}
      purpose={HEALTH_RECORD_PURPOSE}
      printSubject={Boolean(subject)}
      subject={subject}
    />
  );
}
