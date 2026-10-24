"use client";

import { useState } from "react";
import { Mail } from "lucide-react";
import { SelectedAudienceDialog } from "@/components/selected-audience-dialog";
import { boundRegistrationSelection, selectionLimitSummary } from "@/modules/communications/selected-audience-limit";
import type { ChoiceEmailDraft } from "@/modules/registrations/choice-answer-email";

/**
 * Opens the chosen-registrations email dialog for a report's list, e.g. the
 * volunteers who said yes (WR26), or the people a Filter by answer result
 * lists (#783). Nothing sends until staff preview and confirm in the dialog;
 * mail goes to each registration's contact. One batch holds at most 250
 * registrations; when a report has more, the button and the dialog say how many
 * are reviewed and how many are left out (#1103).
 */
export function EmailRegistrationsButton({
  eventId,
  registrationIds,
  label,
  initialDraft,
}: {
  eventId: string;
  registrationIds: string[];
  label: string;
  /** Optional starting subject and message for the composer; staff can edit it. */
  initialDraft?: ChoiceEmailDraft | null;
}) {
  const [open, setOpen] = useState(false);
  const selection = boundRegistrationSelection(registrationIds);
  if (selection.matchedCount === 0) return null;
  const limited = selection.omittedCount > 0;
  return (
    <>
      <button className="secondary-button report-download" onClick={() => setOpen(true)} type="button">
        <Mail aria-hidden="true" size={15} /> {label}{limited ? ` (first ${selection.selectedCount} of ${selection.matchedCount})` : ""}
      </button>
      {limited && <small className="choice-filter-note" role="note">{selectionLimitSummary(selection)}</small>}
      {open && (
        <SelectedAudienceDialog
          eventId={eventId}
          initialDraft={initialDraft ?? undefined}
          matchedCount={selection.matchedCount}
          onClose={() => setOpen(false)}
          registrationIds={selection.registrationIds}
        />
      )}
    </>
  );
}
