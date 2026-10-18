"use client";

import { X } from "lucide-react";
import {
  type CurrentMemberHonor,
  honorSummaryCounts,
  memberHonorStatusLabels,
} from "@/modules/honors/member-honor-domain";
import { useAccessibleDialog } from "@/components/use-accessible-dialog";

/**
 * The club Honors page's Honors column (#1012): the person's total with a
 * smaller completed / in-progress line, and a View button that opens the full
 * list. Every row is the same height however many honors a person has. With
 * no honors it says "None yet" and offers no View button.
 */
export function HonorsSummaryCell({
  honors,
  person,
  onView,
}: {
  honors: readonly CurrentMemberHonor[];
  person: string;
  onView: () => void;
}) {
  const counts = honorSummaryCounts(honors);
  if (counts.total === 0) return <span className="honors-summary-none">None yet</span>;
  const noun = counts.total === 1 ? "honor" : "honors";
  return (
    <div className="honors-summary">
      <div className="honors-summary-text">
        <strong>{counts.total} {noun}</strong>
        <small>{counts.completed} completed · {counts.inProgress} in progress</small>
      </div>
      <button aria-haspopup="dialog" aria-label={`View ${noun} for ${person}`} className="secondary-button honors-summary-view" onClick={onView} type="button">View</button>
    </div>
  );
}

/** A read-only list of one person's current honors with their status, in the standard modal. */
export function MemberHonorsViewDialog({
  honors,
  person,
  onClose,
}: {
  honors: readonly CurrentMemberHonor[];
  person: string;
  onClose: () => void;
}) {
  const dialogRef = useAccessibleDialog<HTMLElement>(true, onClose);
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} role="presentation">
      <section aria-labelledby="honors-view-title" aria-modal="true" className="modal-card member-honors-dialog" ref={dialogRef} role="dialog" tabIndex={-1}>
        <div className="modal-head">
          <div>
            <p className="public-registration-eyebrow">Honors</p>
            <h2 id="honors-view-title" translate="no">{person}</h2>
          </div>
          <button aria-label="Close" className="icon-button modal-close-button" onClick={onClose} type="button"><X aria-hidden="true" size={18} /></button>
        </div>
        {honors.length === 0 ? (
          <p className="public-manage-empty">No honors recorded yet.</p>
        ) : (
          <ul aria-label="Recorded honors" className="public-manage-club-list member-honors-list">
            {honors.map((entry) => (
              <li key={entry.honorId}>
                <span>
                  <strong translate="no">{entry.honorName}</strong>
                  <small>
                    <span className="member-honor-status">{memberHonorStatusLabels[entry.status]}</span>{entry.completionDate ? ` · ${entry.completionDate}` : ""}
                  </small>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="form-actions">
          <button className="secondary-button" onClick={onClose} type="button">Close</button>
        </div>
      </section>
    </div>
  );
}
